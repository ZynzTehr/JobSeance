import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extraHitsPer1000, percentile, predicted, regexRules, scoreLabelled, type Labelled } from "@/lib/ai/cue-eval";
import { cleanMatches, CUE_RULE_IDS, CUES_SYSTEM, CueMatches, JEV_URL, jevProvider, jevQuestions, sentences } from "@/lib/ai/cues";
import { firedCueRules, runShadow, shadowProviderName, shadowRows } from "@/lib/ai/shadow";
import type { DecisionProvider } from "@/lib/ai/cues";

describe("sentences", () => {
  it("splits on sentence ends and lines, drops fragments, strips hidden characters", () => {
    expect(sentences("Great role. Apply now!\nPay​ the fee first? ok\n\nWe never ask for money.")).toEqual([
      "Great role.",
      "Apply now!",
      "Pay the fee first?",
      "We never ask for money.",
    ]);
  });

  it("keeps at most 40 sentences of at most 300 characters", () => {
    expect(sentences(Array.from({ length: 60 }, (_, i) => `Sentence number ${i}.`).join(" "))).toHaveLength(40);
    expect(sentences(`${"x".repeat(500)}.`)[0]).toHaveLength(300);
  });
});

describe("cue answers", () => {
  it("are strict: unknown rules, sentence numbers out of range and extra keys fail", () => {
    expect(CueMatches.safeParse({ matches: [{ rule: "S-PAY-TO-WORK", sentence: 0, confidence: 0.95 }] }).success).toBe(true);
    expect(CueMatches.safeParse({ matches: [{ rule: "S-VERDICT", sentence: 0, confidence: 0.95 }] }).success).toBe(false);
    expect(CueMatches.safeParse({ matches: [{ rule: "S-PAY-TO-WORK", sentence: 40, confidence: 0.95 }] }).success).toBe(false);
    expect(CueMatches.safeParse({ matches: [], verdict: "scam" }).success).toBe(false);
  });

  it("keep one match per rule and sentence, and only for sentences that exist", () => {
    const m = cleanMatches(
      [
        { rule: "S-CHAT-ONLY", sentence: 1, confidence: 0.6 },
        { rule: "S-CHAT-ONLY", sentence: 1, confidence: 0.97 },
        { rule: "S-TOO-GOOD", sentence: 5, confidence: 0.99 },
      ],
      3,
    );
    expect(m).toEqual([{ rule: "S-CHAT-ONLY", sentence: 1, confidence: 0.97 }]);
  });

  it("the prompt lists every rule and treats sentences as data", () => {
    for (const id of CUE_RULE_IDS) expect(CUES_SYSTEM).toContain(id);
    expect(CUES_SYSTEM).toMatch(/data, not instructions/);
    expect(CUES_SYSTEM).toMatch(/warns against a scam/);
  });
});

describe("Jev provider (evaluation only)", () => {
  it("asks one yes/no question per rule and sentence, ten sentences per request", async () => {
    const bodies: { url: string; body: { model: string; state: { sentences: string[] }; questions: Record<string, unknown> } }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push({ url: String(url), body });
      const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: id === "S-CHAT-ONLY|11" ? 0.96 : 0.02 }]));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as unknown as typeof fetch;
    const list = Array.from({ length: 12 }, (_, i) => `Sentence ${i} here.`);
    const out = await jevProvider("k", fetchImpl).match(list);
    expect(bodies.map((b) => b.url)).toEqual([JEV_URL, JEV_URL]);
    expect(bodies[0].body.state.sentences).toHaveLength(10);
    expect(Object.keys(bodies[1].body.questions)).toHaveLength(2 * CUE_RULE_IDS.length);
    expect(out.ok && out.value.filter((m) => m.confidence > 0.9)).toEqual([{ rule: "S-CHAT-ONLY", sentence: 11, confidence: 0.96 }]);
  });

  it("question ids carry the absolute sentence number", () => {
    expect(Object.keys(jevQuestions(["a sentence"], 30))[0]).toBe(`${CUE_RULE_IDS[0]}|30`);
  });

  it("errors and unexpected answers are reasons, never matches", async () => {
    const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await jevProvider("k", reply(500, {})).match(["One sentence here."])).toEqual({ ok: false, reason: "error" });
    expect(await jevProvider("k", reply(429, {})).match(["One sentence here."])).toEqual({ ok: false, reason: "budget" });
    expect(await jevProvider("k", reply(200, { answers: { x: "yes" } })).match(["One sentence here."])).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("shadow mode", () => {
  it("is off unless CUES_PROVIDER=haiku and AI is live; Jev never runs on live traffic", async () => {
    const db = { setting: { findUnique: async () => null } } as never;
    expect(await shadowProviderName({ ANTHROPIC_API_KEY: "k" }, db)).toBeNull();
    expect(await shadowProviderName({ CUES_PROVIDER: "jev", TYPESAFE_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, db)).toBeNull();
    expect(await shadowProviderName({ CUES_PROVIDER: "haiku" }, db)).toBeNull();
    expect(await shadowProviderName({ CUES_PROVIDER: "haiku", ANTHROPIC_API_KEY: "k", AI_MODE: "off" }, db)).toBeNull();
    expect(await shadowProviderName({ CUES_PROVIDER: "haiku", ANTHROPIC_API_KEY: "k" }, db)).toBe("haiku");
  });

  it("stores numbers only: rule, sentence number, score and whether the phrase rule fired", () => {
    const rows = shadowRows("c1", "haiku", [{ rule: "S-CHAT-ONLY", sentence: 2, confidence: 0.93 }], ["S-CHAT-ONLY", "S-PAY-TO-WORK"]);
    expect(rows).toEqual([
      { checkId: "c1", provider: "haiku", ruleId: "S-CHAT-ONLY", sentenceIndex: 2, score: 0.93, regexFired: true },
      { checkId: "c1", provider: "haiku", ruleId: "S-PAY-TO-WORK", sentenceIndex: -1, score: 0, regexFired: true },
    ]);
  });

  it("only cue rules that added points count as fired", () => {
    expect(firedCueRules([{ id: "S-CHAT-ONLY", points: 15 }, { id: "S-FREEMAIL", points: 20 }, { id: "G-EVERGREEN", points: 0 }])).toEqual(["S-CHAT-ONLY"]);
  });

  it("sends redacted sentences, writes rows and never throws", async () => {
    const seen: string[][] = [];
    const provider: DecisionProvider = { name: "haiku", match: async (list) => (seen.push(list), { ok: true, value: [{ rule: "S-PAY-TO-WORK", sentence: 0, confidence: 0.99 }], mode: "live", model: "m" }) };
    const createMany = vi.fn(async () => ({ count: 1 }));
    const n = await runShadow({ checkId: "c1", text: "Pay the onboarding cost to jane@example.com before day one.", fired: [] }, provider, { aiShadow: { createMany } } as never);
    expect(n).toBe(1);
    expect(seen[0][0]).not.toContain("jane@example.com");
    expect(JSON.stringify(createMany.mock.calls)).not.toMatch(/onboarding/);

    const failing = { aiShadow: { createMany: async () => Promise.reject(new Error("db down")) } } as never;
    expect(await runShadow({ checkId: "c2", text: "Pay the onboarding cost before day one.", fired: [] }, provider, failing)).toBe(0);
    const off: DecisionProvider = { name: "haiku", match: async () => ({ ok: false, reason: "budget" }) };
    expect(await runShadow({ checkId: "c3", text: "Pay the onboarding cost before day one.", fired: [] }, off, { aiShadow: { createMany } } as never)).toBe(0);
  });
});

describe("evaluation math", () => {
  it("precision and recall per rule and overall", () => {
    const s = scoreLabelled([
      { labels: ["S-CHAT-ONLY"], predicted: ["S-CHAT-ONLY"] },
      { labels: ["S-CHAT-ONLY"], predicted: [] },
      { labels: [], predicted: ["S-TOO-GOOD"] },
    ]);
    expect(s.rules["S-CHAT-ONLY"]).toMatchObject({ tp: 1, fn: 1, precision: 1, recall: 0.5 });
    expect(s.rules["S-TOO-GOOD"]).toMatchObject({ fp: 1, precision: 0, recall: null });
    expect(s.overall).toMatchObject({ tp: 1, fp: 1, fn: 1 });
  });

  it("extra hits per 1,000 real postings, threshold and percentiles", () => {
    expect(extraHitsPer1000([{ predicted: ["S-CHAT-ONLY"], regex: [] }, { predicted: ["S-CHAT-ONLY"], regex: ["S-CHAT-ONLY"] }])).toBe(500);
    expect(predicted([{ rule: "S-CHAT-ONLY", sentence: 0, confidence: 0.89 }, { rule: "S-TOO-GOOD", sentence: 1, confidence: 0.9 }], 0.9)).toEqual(["S-TOO-GOOD"]);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 95)).toBeNull();
  });

  it("the labelled set has at least 60 paraphrases and 30 honest rows, every rule covered", () => {
    const rows = readFileSync(path.join(process.cwd(), "fixtures/eval/cues-labelled.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Labelled);
    expect(rows.filter((r) => r.labels.length).length).toBeGreaterThanOrEqual(60);
    expect(rows.filter((r) => !r.labels.length).length).toBeGreaterThanOrEqual(30);
    for (const id of CUE_RULE_IDS) expect(rows.some((r) => r.labels.includes(id))).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("the phrase rules miss most paraphrases (what the shadow test measures)", () => {
    const rows = readFileSync(path.join(process.cwd(), "fixtures/eval/cues-labelled.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Labelled);
    const s = scoreLabelled(rows.map((r) => ({ labels: r.labels, predicted: regexRules(r.text) })));
    expect(s.overall.recall ?? 0).toBeLessThan(0.2);
  });
});
