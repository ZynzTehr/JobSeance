import { aiMode } from "@/lib/ai/client";
import { aiPaused, reserveAiCall, settleAiCall } from "@/lib/ai/budget";
import { modelFor, reserveMicros } from "@/lib/ai/config";
import { cleanMatches, CUE_RULES, cuesCall, sentences, type CueMatch, type DecisionProvider } from "@/lib/ai/cues";
import { redactForAi } from "@/lib/ai/sanitize";
import { getDb } from "@/lib/db";

// Phase 13 shadow mode. After a check's response is sent, a model marks which sentences
// express a warning sign; we store only rule ids, sentence numbers and scores (AiShadow),
// next to whether our phrase rule fired, to measure the model before anything is shown.
// Runs only when that check already sent the masked text to Anthropic, so no text leaves
// the server that wouldn't have anyway. Off unless CUES_PROVIDER=haiku.

type Env = Readonly<Record<string, string | undefined>>;
type Db = ReturnType<typeof getDb>;

/** "haiku" when shadow mode is switched on and AI is live; Jev never runs on live traffic (terms unverified). */
export async function shadowProviderName(env: Env = process.env, db?: Db): Promise<"haiku" | null> {
  if (env.CUES_PROVIDER?.trim().toLowerCase() !== "haiku") return null;
  if (aiMode(env) !== "live") return null;
  return aiMode(env, await aiPaused(db ?? getDb())) === "live" ? "haiku" : null;
}

/** Claude Haiku as a decision provider. Our own spend: global daily budget only, never an account's allowance. */
export function haikuProvider(env: Env = process.env, db: Db = getDb()): DecisionProvider {
  return {
    name: "haiku",
    async match(list, signal) {
      const model = modelFor("cues", env);
      const reserve = reserveMicros("cues", model);
      const reservation = await reserveAiCall(db, { userId: "shadow", micros: reserve, skipUser: true }).catch(() => ({ ok: false }) as const);
      if (!reservation.ok) return { ok: false, reason: "budget" };
      const r = await cuesCall(list, model, signal);
      await settleAiCall(db, { day: reservation.day, reservedMicros: reserve, actualMicros: r.micros, inputTokens: r.inputTokens, outputTokens: r.outputTokens, outcome: r.ok ? "ok" : r.reason });
      return r.ok ? { ok: true, value: cleanMatches(r.value.matches, list.length), mode: "live", model } : { ok: false, reason: r.reason };
    },
  };
}

/**
 * Whether a finished check may get a shadow run: only when Claude already read that check's
 * pasted text. A board search or presence check sends a company name or title, not the text,
 * so "AI was used" alone is not enough.
 */
export function shadowEligible(input: { kind: string; aiRead?: boolean }, result: { ai?: { textSent?: boolean } | null }): boolean {
  const kindAllows = input.kind === "posting_text" || (input.kind === "message" && input.aiRead === true);
  return kindAllows && result.ai?.textSent === true;
}

/** Rule ids our phrase rules fired on, among the ones a cue can express. */
export const firedCueRules = (signals: { id: string; points: number }[]) => [...new Set(signals.filter((s) => s.points > 0 && s.id in CUE_RULES).map((s) => s.id))];

export type ShadowRow = { checkId: string; provider: string; ruleId: string; sentenceIndex: number; score: number; regexFired: boolean };

/** Rows to store: every model match, plus a row for each phrase rule the model didn't match. */
export function shadowRows(checkId: string, provider: string, matches: CueMatch[], fired: string[]): ShadowRow[] {
  const firedSet = new Set(fired);
  const rows: ShadowRow[] = matches.map((m) => ({ checkId, provider, ruleId: m.rule, sentenceIndex: m.sentence, score: m.confidence, regexFired: firedSet.has(m.rule) }));
  for (const rule of firedSet) if (!matches.some((m) => m.rule === rule)) rows.push({ checkId, provider, ruleId: rule, sentenceIndex: -1, score: 0, regexFired: true });
  return rows;
}

/** One shadow run. Never throws; logs numbers only. */
export async function runShadow(
  { checkId, text, fired }: { checkId: string; text: string; fired: string[] },
  provider: DecisionProvider,
  db: Pick<Db, "aiShadow"> = getDb(),
): Promise<number> {
  try {
    const list = sentences(redactForAi(text));
    if (!list.length) return 0;
    const out = await provider.match(list);
    if (!out.ok) {
      console.info(`ai shadow provider=${provider.name} sentences=${list.length} outcome=${out.reason}`);
      return 0;
    }
    const rows = shadowRows(checkId, provider.name, out.value, fired);
    if (rows.length) await db.aiShadow.createMany({ data: rows });
    console.info(`ai shadow provider=${provider.name} sentences=${list.length} matches=${out.value.length} regexOnly=${rows.length - out.value.length} outcome=ok`);
    return rows.length;
  } catch (error) {
    console.info(`ai shadow provider=${provider.name} outcome=error err=${(error as Error)?.name ?? "Error"}`);
    return 0;
  }
}
