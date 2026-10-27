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

export type Reservation = { ok: true; release: () => Promise<void> } | { ok: false };

/** Reserves `micros` of today's global budget and one call of the account's daily allowance. */
export async function reserveAiCall(
  db: Db,
  { userId, micros, now = new Date(), capMicros = dailyCapMicros(), perUser = AI_LIMITS.perUserPerDay }: {
    userId: string;
    micros: number;
    now?: Date;
    capMicros?: number;
    perUser?: number;
  },
): Promise<Reservation> {
  const day = utcDay(now);
  await db.aiUsage.upsert({ where: { day }, update: {}, create: { day } });
  const global = await db.aiUsage.updateMany({
    where: { day, spendMicros: { lte: capMicros - micros } },
    data: { spendMicros: { increment: micros }, calls: { increment: 1 } },
  });
  if (global.count === 0) return { ok: false };

  const refundGlobal = () =>
    db.aiUsage.updateMany({ where: { day }, data: { spendMicros: { decrement: micros }, calls: { decrement: 1 } } }).then(() => undefined);

  await db.aiUserUsage.upsert({ where: { userId_day: { userId, day } }, update: {}, create: { userId, day } });
  const user = await db.aiUserUsage.updateMany({ where: { userId, day, calls: { lt: perUser } }, data: { calls: { increment: 1 } } });
  if (user.count === 0) {
    await refundGlobal();
    return { ok: false };
  }
  return {
    ok: true,
    release: async () => {
      await refundGlobal();
      await db.aiUserUsage.updateMany({ where: { userId, day }, data: { calls: { decrement: 1 } } });
    },
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
    now = new Date(),
  }: { reservedMicros: number; actualMicros: number; inputTokens: number; outputTokens: number; outcome: string; now?: Date },
): Promise<void> {
  await db.aiUsage
    .updateMany({
      where: { day: utcDay(now) },
      data: {
        spendMicros: { increment: actualMicros - reservedMicros },
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        ...(outcome === "refusal" ? { refusals: { increment: 1 } } : {}),
        ...(outcome === "max_tokens" ? { maxTokensStops: { increment: 1 } } : {}),
        ...(["error", "timeout", "invalid"].includes(outcome) ? { errors: { increment: 1 } } : {}),
      },
    })
    .catch(() => undefined);
}
