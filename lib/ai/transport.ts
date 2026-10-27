import { aiMode } from "@/lib/ai/client";
import { modelFor, PROMPT_VERSION, RESERVE_MICROS } from "@/lib/ai/config";
import { aiPaused, reserveAiCall, settleAiCall } from "@/lib/ai/budget";
import { cleanExtract, extractCall, PostingExtract } from "@/lib/ai/extract";
import { fixtureKey, readFixture } from "@/lib/ai/replay";
import type { AiOutcome } from "@/lib/ai/types";
import { getDb } from "@/lib/db";

type Env = Readonly<Record<string, string | undefined>>;

// The seam between checks and the AI. Checks call an AiTransport; tests pass a stub,
// USE_FIXTURES=1 replays recorded answers, and only the live transport spends money.

export type AiTransport = {
  /** Reads redacted posting text into lookup keys. */
  extract(redactedText: string, ctx: { userId: string; signal?: AbortSignal }): Promise<AiOutcome<PostingExtract>>;
};

export const offTransport: AiTransport = {
  extract: async () => ({ ok: false, reason: "off" }),
};

export function replayTransport(env: Env = process.env): AiTransport {
  return {
    async extract(redactedText) {
      const model = modelFor("extract", env);
      const found = await readFixture("extract", fixtureKey("extract", PROMPT_VERSION, model, redactedText), redactedText);
      if (!found) return { ok: false, reason: "no_fixture" };
      const parsed = PostingExtract.safeParse(found.value);
      return parsed.success ? { ok: true, value: cleanExtract(parsed.data), mode: "replay", model: found.model } : { ok: false, reason: "invalid" };
    },
  };
}

export function liveTransport(env: Env = process.env, db = getDb()): AiTransport {
  return {
    async extract(redactedText, { userId, signal }) {
      const model = modelFor("extract", env);
      const reservation = await reserveAiCall(db, { userId, micros: RESERVE_MICROS.extract }).catch(() => ({ ok: false }) as const);
      if (!reservation.ok) return { ok: false, reason: "budget" };
      const result = await extractCall(redactedText, model, signal);
      await settleAiCall(db, {
        reservedMicros: RESERVE_MICROS.extract,
        actualMicros: result.micros,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        outcome: result.ok ? "ok" : result.reason,
      });
      return result.ok ? { ok: true, value: cleanExtract(result.value), mode: "live", model } : { ok: false, reason: result.reason };
    },
  };
}

/** The transport for this request: replay, live, or off (no key, AI_MODE=off, admin pause). */
export async function currentTransport(env: Env = process.env): Promise<AiTransport> {
  const first = aiMode(env);
  if (first === "replay") return replayTransport(env);
  if (first === "off") return offTransport;
  const db = getDb();
  return aiMode(env, await aiPaused(db)) === "live" ? liveTransport(env, db) : offTransport;
}
