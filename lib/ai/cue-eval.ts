import { CUE_RULE_IDS, type CueMatch, type CueRule } from "@/lib/ai/cues";
import { firedCueRules } from "@/lib/ai/shadow";
import { scoreGhost } from "@/lib/scoring/ghost";
import { scoreScam } from "@/lib/scoring/scam";

// Phase 13 evaluation math (pure). scripts/eval-cues.mts gathers the inputs and writes the report.

export type Labelled = { id: string; kind: "paraphrase" | "notice" | "plain"; text: string; labels: CueRule[] };
export type Counts = { tp: number; fp: number; fn: number };
export type RuleScore = Counts & { precision: number | null; recall: number | null };

/** The phrase rules (our current regexes) that fire on a text, among those a cue can express. */
export function regexRules(text: string, now = new Date()): CueRule[] {
  const scam = scoreScam({ text, sender: null, claimed: null, namesEmployer: false, notOnBoard: null, now });
  const ghost = scoreGhost({ board: { kind: "no_board", companyName: "x" }, postedAt: null, description: text, community: [], now });
  return firedCueRules([...scam.signals, ...ghost.signals]) as CueRule[];
}

/** Rules predicted for a text: matches at or above the threshold, any sentence. */
export const predicted = (matches: CueMatch[], threshold: number) => [...new Set(matches.filter((m) => m.confidence >= threshold).map((m) => m.rule))];

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

/** Per-rule and overall (micro) precision and recall against the labels. */
export function scoreLabelled(items: { labels: string[]; predicted: string[] }[]): { rules: Record<CueRule, RuleScore>; overall: RuleScore } {
  const rules = Object.fromEntries(CUE_RULE_IDS.map((r) => [r, { tp: 0, fp: 0, fn: 0 }])) as Record<CueRule, Counts>;
  for (const { labels, predicted: p } of items) {
    for (const r of CUE_RULE_IDS) {
      const want = labels.includes(r);
      const got = p.includes(r);
      if (want && got) rules[r].tp++;
      else if (!want && got) rules[r].fp++;
      else if (want && !got) rules[r].fn++;
    }
  }
  const finish = (c: Counts): RuleScore => ({ ...c, precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn) });
  const total = Object.values(rules).reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }), { tp: 0, fp: 0, fn: 0 });
  return { rules: Object.fromEntries(CUE_RULE_IDS.map((r) => [r, finish(rules[r])])) as Record<CueRule, RuleScore>, overall: finish(total) };
}

/**
 * On real employer postings (assumed honest), hits the phrase rules didn't make, per 1,000
 * postings. These need a human look: some may be real finds, most would be false alarms.
 */
export function extraHitsPer1000(items: { predicted: string[]; regex: string[] }[]): number {
  if (!items.length) return 0;
  const extra = items.reduce((n, i) => n + i.predicted.filter((r) => !i.regex.includes(r)).length, 0);
  return Math.round((extra / items.length) * 1000 * 10) / 10;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Thresholds a later PR would need before showing (advisory) or counting cues. */
export const PROMOTION = { advisoryPrecision: 0.9, advisoryExtraPer1000: 2, countPrecision: 0.97 } as const;
