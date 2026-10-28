import { AI_LIMITS } from "@/lib/ai/config";
import type { getDb } from "@/lib/db";

// Spend guardrails, outermost first: the Anthropic console spend limit (outside code),
// AI_MODE=off, the admin pause row, a global daily dollar cap and a per-account daily
// cap. Reservations are atomic (conditional updateMany), so concurrent checks can't overshoot.

type Db = Pick<ReturnType<typeof getDb>, "aiUsage" | "aiUserUsage" | "setting">;

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

export function dailyCapMicros(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const usd = Number(env.AI_DAILY_USD);
  return Math.round((Number.isFinite(usd) && usd >= 0 && env.AI_DAILY_USD?.trim() ? usd : AI_LIMITS.dailyUsd) * 1_000_000);
}

let pauseCache: { value: boolean; at: number } | null = null;

/** True when an admin paused AI (Setting aiPaused = "1"). Cached for a minute. */
export async function aiPaused(db: Db, now = Date.now()): Promise<boolean> {
  if (pauseCache && now - pauseCache.at < AI_LIMITS.pauseCacheMs) return pauseCache.value;
  const row = await db.setting.findUnique({ where: { key: "aiPaused" } }).catch(() => null);
  pauseCache = { value: row?.value === "1", at: now };
  return pauseCache.value;
}

export function resetPauseCache() {
  pauseCache = null;
}

export type Reservation =
  | {
      ok: true;
      /** The UTC day the spend was reserved on: settle against it even if the call crosses midnight. */
      day: string;
      release: () => Promise<void>;
      /** Gives back only the account's allowance, for a call refused before anything was billed. */
      releaseUser: () => Promise<void>;
    }
  | { ok: false };

/**
 * Reserves `micros` of today's global budget and one call of the account's daily allowance.
 * A tool call (web search or page read) also takes one of the account's daily tool calls.
 */
export async function reserveAiCall(
  db: Db,
  {
    userId,
    micros,
    tool = false,
    skipUser = false,
    now = new Date(),
    capMicros = dailyCapMicros(),
    perUser = AI_LIMITS.perUserPerDay,
    toolsPerUser = AI_LIMITS.toolsPerUserPerDay,
  }: {
    userId: string;
    micros: number;
    tool?: boolean;
    /** Our own background calls (shadow mode): global budget only, never the account's allowance. */
    skipUser?: boolean;
    now?: Date;
    capMicros?: number;
    perUser?: number;
    toolsPerUser?: number;
  },
): Promise<Reservation> {
  const day = utcDay(now);
  await db.aiUsage.upsert({ where: { day }, update: {}, create: { day } });
  // Web searches and page reads may only use part of the cap, so reading pasted postings stays available.
  const ceiling = tool ? Math.floor(capMicros * AI_LIMITS.toolShareOfCap) : capMicros;
  const global = await db.aiUsage.updateMany({
    where: { day, spendMicros: { lte: ceiling - micros } },
    data: { spendMicros: { increment: micros }, calls: { increment: 1 } },
  });
  if (global.count === 0) return { ok: false };

  const refundGlobal = () =>
    db.aiUsage.updateMany({ where: { day }, data: { spendMicros: { decrement: micros }, calls: { decrement: 1 } } }).then(() => undefined);

  if (skipUser) return { ok: true, day, release: refundGlobal, releaseUser: async () => undefined };

  await db.aiUserUsage.upsert({ where: { userId_day: { userId, day } }, update: {}, create: { userId, day } });
  const user = await db.aiUserUsage.updateMany({
    where: { userId, day, calls: { lt: perUser }, ...(tool ? { toolCalls: { lt: toolsPerUser } } : {}) },
    data: { calls: { increment: 1 }, ...(tool ? { toolCalls: { increment: 1 } } : {}) },
  });
  if (user.count === 0) {
    await refundGlobal();
    return { ok: false };
  }
  const refundUser = () =>
    db.aiUserUsage.updateMany({ where: { userId, day }, data: { calls: { decrement: 1 }, ...(tool ? { toolCalls: { decrement: 1 } } : {}) } }).then(() => undefined);
  return {
    ok: true,
    day,
    release: async () => {
      await refundGlobal();
      await refundUser();
    },
    releaseUser: refundUser,
  };
}

/** Replaces the reserved estimate with the real cost and counts the outcome. Never throws. */
export async function settleAiCall(
  db: Db,
  {
    reservedMicros,
    actualMicros,
    inputTokens,
    outputTokens,
    outcome,
    searches = 0,
    fetches = 0,
    day,
    now = new Date(),
  }: {
    reservedMicros: number;
    actualMicros: number;
    inputTokens: number;
    outputTokens: number;
    outcome: string;
    searches?: number;
    fetches?: number;
    /** The day the call was reserved on (defaults to today). */
    day?: string;
    now?: Date;
  },
): Promise<void> {
  await db.aiUsage
    .updateMany({
      where: { day: day ?? utcDay(now) },
      data: {
        spendMicros: { increment: actualMicros - reservedMicros },
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        ...(searches ? { searches: { increment: searches } } : {}),
        ...(fetches ? { fetches: { increment: fetches } } : {}),
        ...(outcome === "refusal" ? { refusals: { increment: 1 } } : {}),
        ...(outcome === "max_tokens" ? { maxTokensStops: { increment: 1 } } : {}),
        ...(["error", "timeout", "invalid"].includes(outcome) ? { errors: { increment: 1 } } : {}),
      },
    })
    .catch(() => undefined);
}
