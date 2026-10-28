import type { getDb } from "@/lib/db";
import { fetchBoardList } from "@/lib/lookups/boards";
import { boardRef, syncBoard } from "@/lib/lookups/postings";

// Daily board sweep (vercel.json → GET /api/v1/cron/sweep). Refreshes every listed company's
// board whether or not anyone checked it, so each Posting row records when a job left its
// board and when it came back (removedAt, relistedCount): the history a repost signal needs.
// Nothing is scored from it yet.

type Db = Pick<ReturnType<typeof getDb>, "company" | "posting" | "$transaction">;

export type SweepCounts = { boards: number; synced: number; failed: number; added: number; relisted: number; removed: number };

/** Real companies with a board we read; fictional companies keep whatever the seed stored. */
export const SWEEP_COMPANIES = { isFictional: false, ats: { not: "NONE" as const }, atsBoard: { not: null } };

/** Refetches and syncs each board in turn and returns counts only. A board that fails only costs its own slot. */
export async function runSweep(db: Db, now = new Date(), fetchList: typeof fetchBoardList = fetchBoardList): Promise<SweepCounts> {
  const companies = await db.company.findMany({ where: SWEEP_COMPANIES, orderBy: { slug: "asc" } });
  const counts: SweepCounts = { boards: 0, synced: 0, failed: 0, added: 0, relisted: 0, removed: 0 };
  for (const company of companies) {
    const ref = boardRef(company);
    if (!ref) continue;
    counts.boards++;
    try {
      const list = await fetchList(ref);
      const existing = await db.posting.findMany({ where: { ats: ref.ats, board: ref.board }, select: { externalId: true } });
      const synced = await syncBoard(company, ref, list.jobs, existing, now, list.partial, db);
      counts.synced++;
      counts.added += synced.added;
      counts.relisted += synced.relisted;
      counts.removed += synced.removed;
    } catch {
      counts.failed++; // counts only: a board or driver error can name a host
    }
  }
  return counts;
}
