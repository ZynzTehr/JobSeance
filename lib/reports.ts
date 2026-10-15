import { getDb } from "@/lib/db";
import type { Outcome, Stage } from "@/app/generated/prisma/client";

// Public community aggregate for a company. Counts only; never a user, role
// title, date or note. Breakdown appears only once 3+ distinct users reported.

export const MIN_REPORTERS = 3;
const GHOSTED_AFTER_DAYS = 45;

export type CommunityAggregate = {
  reports: number;
  shown: boolean;
  reason?: string;
  byOutcome?: Partial<Record<Outcome, number>>;
  byStage?: Partial<Record<Stage, number>>;
  ghostedShare?: number; // 0..1, rounded to 2 places
};

export type AggregateRow = {
  userId: string;
  outcome: Outcome;
  stageReached: Stage;
  appliedAt: Date;
  lastInterviewAt: Date | null;
};

/** Pure: rows are the company's visible reports. */
export function aggregate(rows: AggregateRow[], now = new Date()): CommunityAggregate {
  const reporters = new Set(rows.map((r) => r.userId)).size;
  if (reporters < MIN_REPORTERS) {
    return { reports: rows.length, shown: false, reason: `Not rated: fewer than ${MIN_REPORTERS} people have reported` };
  }
  const byOutcome: Partial<Record<Outcome, number>> = {};
  const byStage: Partial<Record<Stage, number>> = {};
  let ghosted = 0;
  for (const r of rows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    byStage[r.stageReached] = (byStage[r.stageReached] ?? 0) + 1;
    const since = r.lastInterviewAt ?? r.appliedAt;
    if (r.outcome === "NO_RESPONSE" && now.getTime() - since.getTime() >= GHOSTED_AFTER_DAYS * 86_400_000) ghosted += 1;
  }
  return { reports: rows.length, shown: true, byOutcome, byStage, ghostedShare: Math.round((ghosted / rows.length) * 100) / 100 };
}

export async function companyAggregate(companyId: string, now = new Date()): Promise<CommunityAggregate> {
  const rows = await getDb().outcomeReport.findMany({
    where: { companyId, visibility: "VISIBLE" },
    select: { userId: true, outcome: true, stageReached: true, appliedAt: true, lastInterviewAt: true },
  });
  return aggregate(rows, now);
}
