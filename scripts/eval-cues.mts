// Phase 13 evaluation: how well does a model spot reworded warning signs, compared with our
// phrase rules? Writes docs/eval/cues-shadow-report.md. Spends real money, so it asks for --yes.
//
//   ANTHROPIC_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/eval-cues.mts --yes [--postings 100] [--threshold 0.9]
//   TYPESAFE_API_KEY=...  npx tsx --tsconfig tsconfig.json scripts/eval-cues.mts --yes --provider jev
//
// Inputs: fixtures/eval/cues-labelled.jsonl (hand-written paraphrases and anti-fraud notices)
// and a sample of real employer postings cached in the database (public job-board text).
// No user data is read. Only rule ids, counts and timings go into the report.
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extraHitsPer1000, percentile, predicted, PROMOTION, regexRules, scoreLabelled, type Labelled } from "@/lib/ai/cue-eval";
import { getAnthropic } from "@/lib/ai/client";
import { CUE_RULE_IDS, cuesCall, cleanMatches, jevProvider, MAX_SENTENCES, sentences, type CueMatch, type DecisionProvider } from "@/lib/ai/cues";
import { modelFor } from "@/lib/ai/config";
import { redactForAi } from "@/lib/ai/sanitize";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const providerName = arg("provider", "haiku");
const threshold = Number(arg("threshold", "0.9"));
const postingCount = Math.max(0, Math.min(1000, Number(arg("postings", "100"))));

if (process.env.USE_FIXTURES === "1") throw new Error("Unset USE_FIXTURES: this script calls a live model.");
if (providerName === "haiku" && !process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");
if (providerName === "jev" && !process.env.TYPESAFE_API_KEY) throw new Error("Set TYPESAFE_API_KEY.");
if (!["haiku", "jev"].includes(providerName)) throw new Error("--provider is haiku or jev.");

let micros = 0;
const latencies: number[] = [];
const model = modelFor("cues");
const provider: DecisionProvider =
  providerName === "jev"
    ? jevProvider(process.env.TYPESAFE_API_KEY!)
    : {
        name: "haiku",
        async match(list) {
          getAnthropic();
          const r = await cuesCall(list, model);
          micros += r.micros;
          return r.ok ? { ok: true, value: cleanMatches(r.value.matches, list.length), mode: "live", model } : { ok: false, reason: r.reason };
        },
      };

async function timed(list: string[]): Promise<CueMatch[] | null> {
  const t = Date.now();
  const out = await provider.match(list);
  latencies.push(Date.now() - t);
  if (!out.ok) {
    console.warn(`call failed: ${out.reason}`);
    return null;
  }
  return out.value;
}

// ---- Inputs ------------------------------------------------------------------------------

const labelled = (await readFile(path.join(process.cwd(), "fixtures/eval/cues-labelled.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Labelled);

type Sample = { ats: string; description: string };
let postings: Sample[] = [];
if (postingCount > 0) {
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  // Real employers' boards only: the fictional demo companies' postings are written to contain warning signs.
  const real = { description: { not: null }, ats: { not: "NONE" as const }, company: { isFictional: false } };
  const systems = (await db.posting.groupBy({ by: ["ats"], where: real })).map((g) => g.ats);
  const per = Math.ceil(postingCount / Math.max(1, systems.length));
  for (const ats of systems) {
    const rows = await db.posting.findMany({ where: { ...real, ats }, select: { description: true }, orderBy: { fetchedAt: "desc" }, take: per });
    postings.push(...rows.map((r) => ({ ats, description: r.description! })));
  }
  postings = postings.slice(0, postingCount);
}

const labelledCalls = Math.ceil(labelled.length / 20);
const estimate = providerName === "haiku" ? ((labelledCalls * 2_500 + postings.length * 3_000) * 0.1 + (labelledCalls + postings.length) * 400 * 0.5) / 1_000_000 : null;
console.log(`${labelled.length} labelled rows in ${labelledCalls} calls, ${postings.length} real postings, provider ${providerName}, threshold ${threshold}.`);
if (estimate !== null) console.log(`Estimated cost: about $${estimate.toFixed(2)}.`);
if (!process.argv.includes("--yes")) {
  console.log("Nothing sent. Re-run with --yes to spend it.");
  process.exit(0);
}

// ---- Labelled set: 20 one-sentence rows per call -----------------------------------------

const labelledResults: { labels: string[]; predicted: string[]; regex: string[]; kind: string }[] = [];
for (let i = 0; i < labelled.length; i += 20) {
  const chunk = labelled.slice(i, i + 20);
  const matches = await timed(chunk.map((r) => r.text));
  if (!matches) throw new Error("A labelled call failed; the report would be incomplete.");
  chunk.forEach((row, j) => {
    labelledResults.push({ labels: row.labels, predicted: predicted(matches.filter((m) => m.sentence === j), threshold), regex: regexRules(row.text), kind: row.kind });
  });
}
const model_ = scoreLabelled(labelledResults);
const regex_ = scoreLabelled(labelledResults.map((r) => ({ labels: r.labels, predicted: r.regex })));
const noticeHits = labelledResults.filter((r) => r.kind === "notice" && r.predicted.length).length;

// ---- Real postings: one call each ----------------------------------------------------------

const postingResults: { predicted: string[]; regex: string[] }[] = [];
const extraByRule = new Map<string, number>();
for (const p of postings) {
  const list = sentences(redactForAi(p.description)).slice(0, MAX_SENTENCES);
  if (!list.length) continue;
  const matches = await timed(list);
  if (!matches) continue;
  const got = predicted(matches, threshold);
  const regex = regexRules(p.description);
  postingResults.push({ predicted: got, regex });
  for (const r of got.filter((x) => !regex.includes(x))) extraByRule.set(r, (extraByRule.get(r) ?? 0) + 1);
}
const extra = extraHitsPer1000(postingResults);

// ---- Report -----------------------------------------------------------------------------------

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
const advisoryOk = (model_.overall.precision ?? 0) >= PROMOTION.advisoryPrecision && extra <= PROMOTION.advisoryExtraPer1000;
const lines = [
  "# Warning-sign cues: shadow evaluation",
  "",
  `Run ${new Date().toISOString().slice(0, 10)} with provider \`${providerName}\`${providerName === "haiku" ? ` (\`${model}\`)` : ""}, threshold ${threshold}. Generated by \`scripts/eval-cues.mts\`; contains no posting or user text.`,
  "",
  "## Labelled paraphrases and anti-fraud notices",
  "",
  `${labelled.length} hand-written rows (\`fixtures/eval/cues-labelled.jsonl\`): ${labelled.filter((l) => l.labels.length).length} reworded warning signs and ${labelled.filter((l) => !l.labels.length).length} honest sentences, ${labelled.filter((l) => l.kind === "notice").length} of them anti-fraud notices.`,
  "",
  "| | Precision | Recall | True hits | False hits | Misses |",
  "| --- | --- | --- | --- | --- | --- |",
  `| Model | ${pct(model_.overall.precision)} | ${pct(model_.overall.recall)} | ${model_.overall.tp} | ${model_.overall.fp} | ${model_.overall.fn} |`,
  `| Phrase rules today | ${pct(regex_.overall.precision)} | ${pct(regex_.overall.recall)} | ${regex_.overall.tp} | ${regex_.overall.fp} | ${regex_.overall.fn} |`,
  "",
  `Anti-fraud notices the model flagged: ${noticeHits}.`,
  "",
  "| Rule | Model precision | Model recall | Phrase-rule recall |",
  "| --- | --- | --- | --- |",
  ...CUE_RULE_IDS.map((r) => `| ${r} | ${pct(model_.rules[r].precision)} | ${pct(model_.rules[r].recall)} | ${pct(regex_.rules[r].recall)} |`),
  "",
  "## Real employer postings",
  "",
  `${postingResults.length} postings cached from public job boards, assumed honest. Hits the phrase rules didn't make: **${extra} per 1,000 postings**${extraByRule.size ? ` (${[...extraByRule].map(([r, n]) => `${r} ${n}`).join(", ")})` : ""}. These need a human look before they count as false alarms.`,
  "",
  "## Cost and speed",
  "",
  `${latencies.length} calls; latency p50 ${percentile(latencies, 50) ?? "n/a"} ms, p95 ${percentile(latencies, 95) ?? "n/a"} ms.${providerName === "haiku" ? ` Estimated spend $${(micros / 1_000_000).toFixed(4)}.` : ""}`,
  "",
  "## Promotion gate",
  "",
  `Showing cues as \"AI noticed (not counted)\" needs precision of at least ${PROMOTION.advisoryPrecision * 100}% and at most ${PROMOTION.advisoryExtraPer1000} extra hits per 1,000 real postings. Counting points needs ${PROMOTION.countPrecision * 100}% precision and a scoring-version change. This run: **${advisoryOk ? "meets the advisory gate" : "does not meet the advisory gate"}**. Nothing is shown until a later PR decides.`,
  "",
];
await mkdir(path.join(process.cwd(), "docs/eval"), { recursive: true });
await writeFile(path.join(process.cwd(), "docs/eval/cues-shadow-report.md"), lines.join("\n"));
console.log(`Wrote docs/eval/cues-shadow-report.md: model precision ${pct(model_.overall.precision)}, recall ${pct(model_.overall.recall)}, extra hits ${extra}/1,000.`);
process.exit(0);
