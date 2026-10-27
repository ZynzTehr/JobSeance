import { timingSafeEqual } from "node:crypto";
import type { getDb } from "@/lib/db";

// Retention cleanup (spec "Legal, privacy and disclaimers"). Runs daily from
// Vercel Cron at GET /api/v1/cron/cleanup.

type Db = ReturnType<typeof getDb>;

export const RETENTION = {
  checkDays: 30, // anonymous or unsaved checks
  excerptDays: 90, // ScamReport.redactedExcerpt, counted from the report's createdAt
  resolvedFlagDays: 90, // UPHELD or REJECTED flags, counted from resolvedAt
  aiUsageDays: 90, // AiUsage / AiUserUsage daily counters (numbers only)
  // BoardDiscovery rows carry their own expiresAt (found: 30 days, not found: 7 days).
} as const;

export type CleanupCounts = { checksDeleted: number; excerptsCleared: number; flagsDeleted: number; aiUsageDeleted: number; discoveriesDeleted: number };

const DAY_MS = 86_400_000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/** Deletes expired rows in one transaction and returns how many were touched. */
export async function runCleanup(db: Db, now: Date = new Date()): Promise<CleanupCounts> {
  const checkCutoff = daysBefore(now, RETENTION.checkDays);
  const excerptCutoff = daysBefore(now, RETENTION.excerptDays);
  const flagCutoff = daysBefore(now, RETENTION.resolvedFlagDays);
  const aiDayCutoff = daysBefore(now, RETENTION.aiUsageDays).toISOString().slice(0, 10);

  const [checks, excerpts, flags, aiDays, aiUserDays, discoveries] = await db.$transaction([
    // Saved checks are kept; everything else expires.
    db.check.deleteMany({
      where: { createdAt: { lt: checkCutoff }, OR: [{ userId: null }, { saved: false }] },
    }),
    db.scamReport.updateMany({
      where: { createdAt: { lt: excerptCutoff }, redactedExcerpt: { not: null } },
      data: { redactedExcerpt: null },
    }),
    db.flag.deleteMany({
      where: { status: { in: ["UPHELD", "REJECTED"] }, resolvedAt: { lt: flagCutoff } },
    }),
    db.aiUsage.deleteMany({ where: { day: { lt: aiDayCutoff } } }),
    db.aiUserUsage.deleteMany({ where: { day: { lt: aiDayCutoff } } }),
    db.boardDiscovery.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  return {
    checksDeleted: checks.count,
    excerptsCleared: excerpts.count,
    flagsDeleted: flags.count,
    aiUsageDeleted: aiDays.count + aiUserDays.count,
    discoveriesDeleted: discoveries.count,
  };
}

/** True only when the secret is set and the header is exactly `Bearer <secret>` (constant-time). */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || authorization === null) return false;
  const given = Buffer.from(authorization, "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
