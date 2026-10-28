import { getDb } from "@/lib/db";
import { boardExists, fetchBoardJob, fetchBoardList, fixturesEnabled, type BoardJob, type BoardRef } from "@/lib/lookups/boards";
import type { FetchOptions } from "@/lib/lookups/fetch";
import type { Company, Posting, PostingState } from "@/app/generated/prisma/client";

// Board postings cached in the Posting table. A board is fresh for 1 hour after
// its last fetch; after that the next request refetches and syncs it in a few
// bulk queries (no per-row upserts: each round trip is slow over the Neon driver).
// The daily sweep (lib/lookups/sweep.ts) refreshes every listed board the same way.

export const POSTINGS_TTL_MS = 60 * 60 * 1000;

export type PostingSummary = {
  externalId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: Date | null;
  state: PostingState;
};

export type CompanyPostings = {
  company: { slug: string; name: string; ats: Company["ats"]; board: string | null };
  postings: PostingSummary[];
  fetchedAt: Date | null;
  source: "live" | "fixture" | "cache" | "stored";
  stale: boolean;
  /** The system's own count of open jobs when the list is only the newest page (Workday, SmartRecruiters, amazon.jobs). */
  total?: number | null;
  partial?: boolean;
};

/** Last known totals for partial boards, per server instance (best effort, like the rate limiter). */
const totals = new Map<string, number | null>();

export class BoardUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super("The job board could not be reached.");
  }
}

const summary = (p: Posting): PostingSummary => ({
  externalId: p.externalId,
  title: p.title,
  location: p.location,
  url: p.url,
  postedAt: p.postedAt,
  state: p.state,
});

export const boardRef = (company: Company): BoardRef | null =>
  company.ats === "NONE" || !company.atsBoard ? null : { ats: company.ats, board: company.atsBoard, ...(company.atsHost ? { host: company.atsHost } : {}) };

/** Live postings for a company slug, or null if the slug is unknown. */
export async function getCompanyPostings(slug: string, now = new Date()): Promise<CompanyPostings | null> {
  const db = getDb();
  const company = await db.company.findUnique({ where: { slug } });
  if (!company) return null;

  const head = { slug: company.slug, name: company.name, ats: company.ats, board: company.atsBoard };
  const ref = boardRef(company);
  const stored = () =>
    db.posting.findMany({ where: { companyId: company.id }, orderBy: [{ state: "asc" }, { postedAt: "desc" }] });

  if (!ref) {
    // Fictional companies: whatever the seed stored, never the network.
    const rows = await stored();
    return { company: head, postings: rows.map(summary), fetchedAt: latest(rows), source: "stored", stale: false };
  }

  const rows = await db.posting.findMany({ where: { ats: ref.ats, board: ref.board } });
  const fetchedAt = latest(rows);
  const key = `${ref.ats}:${ref.board}`;
  const extra = (partial: boolean) => (partial ? { partial, total: totals.get(key) ?? null } : {});
  const partialBoard = !["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE", "RECRUITEE"].includes(ref.ats);
  if (fetchedAt && now.getTime() - fetchedAt.getTime() < POSTINGS_TTL_MS) {
    return { company: head, postings: liveFirst(rows), fetchedAt, source: "cache", stale: false, ...extra(partialBoard) };
  }

  let list: { jobs: BoardJob[]; total: number | null; partial: boolean };
  try {
    list = await fetchBoardList(ref);
  } catch (error) {
    if (rows.length) return { company: head, postings: liveFirst(rows), fetchedAt, source: "cache", stale: true, ...extra(partialBoard) };
    throw new BoardUnavailableError(error);
  }

  await syncBoard(company, ref, list.jobs, rows, now, list.partial);
  if (list.partial) totals.set(key, list.total);
  const synced = await db.posting.findMany({ where: { ats: ref.ats, board: ref.board } });
  const source = fixturesEnabled() ? "fixture" : "live";
  return { company: head, postings: liveFirst(synced), fetchedAt: now, source, stale: false, ...extra(list.partial) };
}

/** On search systems, a stored job not seen on the newest page for this long is no longer listed as open. */
export const PARTIAL_STALE_DAYS = 7;

export type SyncCounts = { added: number; relisted: number; removed: number };

/**
 * Inserts new jobs, marks seen jobs LIVE and jobs that left the board NOT_FOUND. A partial
 * list (the newest page of a search system) never marks anything NOT_FOUND: absence from one
 * page proves nothing. Instead, jobs it hasn't shown for a week drop from LIVE to UNKNOWN, so a
 * removed job isn't listed as open forever; a lookup by id still checks it directly.
 * Repost history: a job seen again after it was gone gets relistedCount +1, and a job that
 * leaves a full board gets removedAt, so a later signal can tell a relisted job from a new one.
 */
export async function syncBoard(
  company: Pick<Company, "id">,
  ref: BoardRef,
  jobs: BoardJob[],
  existing: Pick<Posting, "externalId">[],
  now: Date,
  partial = false,
  db: Pick<ReturnType<typeof getDb>, "$transaction" | "posting"> = getDb(),
): Promise<SyncCounts> {
  const known = new Set(existing.map((p) => p.externalId));
  const seen = jobs.map((j) => j.externalId);
  const fresh = jobs.filter((j) => !known.has(j.externalId));
  const unseenLive = { ats: ref.ats, board: ref.board, state: "LIVE" as const, externalId: { notIn: seen } };

  const ops = [
    db.posting.createMany({
      data: fresh.map((j) => ({
        companyId: company.id,
        ats: ref.ats,
        board: ref.board,
        externalId: j.externalId,
        title: j.title,
        location: j.location,
        url: j.url,
        postedAt: j.postedAt,
        internalJobId: j.internalJobId,
        description: j.description, // null for list fetches except Lever/Ashby, which include it
        state: "LIVE",
        firstSeenAt: now,
        lastSeenAt: now,
        fetchedAt: now,
      })),
      skipDuplicates: true,
    }),
    // Back on the board after it was removed (or, on a search system, after a week unseen): a repost.
    db.posting.updateMany({
      where: { ats: ref.ats, board: ref.board, externalId: { in: seen }, state: { not: "LIVE" as const } },
      data: { relistedCount: { increment: 1 } },
    }),
    db.posting.updateMany({
      where: { ats: ref.ats, board: ref.board, externalId: { in: seen } },
      data: { state: "LIVE", lastSeenAt: now, fetchedAt: now },
    }),
    partial
      ? db.posting.updateMany({
          where: { ...unseenLive, lastSeenAt: { lt: new Date(now.getTime() - PARTIAL_STALE_DAYS * 86_400_000) } },
          data: { state: "UNKNOWN" as const },
        })
      : db.posting.updateMany({ where: unseenLive, data: { removedAt: now } }),
    ...(partial
      ? []
      : [
          db.posting.updateMany({
            where: { ats: ref.ats, board: ref.board, externalId: { notIn: seen } },
            data: { state: "NOT_FOUND" as const, fetchedAt: now },
          }),
        ]),
  ];
  const results = await db.$transaction(ops);
  const count = (i: number) => results[i]?.count ?? 0;
  return { added: count(0), relisted: count(1), removed: partial ? 0 : count(3) };
}

/** The posting facts scoring needs, from a cached row or a fresh fetch. */
export type PostingFacts = {
  id: string | null; // Posting row id when cached in the DB
  externalId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: Date | null;
  internalJobId: string | null;
  description: string | null;
};

export type PostingLookup =
  | { found: true; posting: PostingFacts; source: "live" | "cache" }
  | { found: false; previous: PostingFacts | null } // board confirmed, job gone
  | { found: null; error: unknown }; // couldn't verify (timeout, unknown board, ...)

const facts = (p: Posting | BoardJob, id: string | null): PostingFacts => ({
  id,
  externalId: p.externalId,
  title: p.title,
  location: p.location,
  url: p.url,
  postedAt: p.postedAt,
  internalJobId: p.internalJobId,
  description: p.description,
});

/**
 * One posting with its description, for checks. With a Company it reads and
 * writes the Posting cache; without one (a board we don't list) it only fetches.
 */
export async function lookupPosting(
  ref: BoardRef,
  jobId: string,
  company: Company | null,
  { now = new Date(), fetch: fetchOpts }: { now?: Date; fetch?: FetchOptions } = {},
): Promise<PostingLookup> {
  const db = company ? getDb() : null;
  const externalId = jobId.toLowerCase();
  const key = { ats_board_externalId: { ats: ref.ats, board: ref.board, externalId } };

  const cached = db ? await db.posting.findUnique({ where: key }) : null;
  // Only a LIVE copy short-circuits. A board sync (a company page or the daily sweep) stamps
  // fetchedAt on jobs it marks removed, so a fresh NOT_FOUND row is checked live again.
  if (cached && cached.state === "LIVE" && cached.description !== null && now.getTime() - cached.fetchedAt.getTime() < POSTINGS_TTL_MS) {
    return { found: true, posting: facts(cached, cached.id), source: "cache" };
  }

  let job: BoardJob | null;
  try {
    job = await fetchBoardJob(ref, externalId, fetchOpts);
    if (!job && !(await boardExists(ref, fetchOpts))) return { found: null, error: new Error("unknown board") };
  } catch (error) {
    return { found: null, error };
  }

  if (!job) {
    if (db && cached) await db.posting.update({ where: key, data: { state: "NOT_FOUND", fetchedAt: now } });
    return { found: false, previous: cached ? facts(cached, cached.id) : null };
  }
  if (!db || !company) return { found: true, posting: facts(job, null), source: "live" };

  const fields = {
    title: job.title,
    location: job.location,
    url: job.url,
    postedAt: job.postedAt,
    internalJobId: job.internalJobId,
    description: job.description,
    state: "LIVE" as const,
    lastSeenAt: now,
    fetchedAt: now,
  };
  // Found again after it was proven gone: a repost. One conditional update counts it and sets LIVE,
  // so a lookup racing another lookup (or the sweep) on the same job finds no NOT_FOUND row left.
  if (cached?.state === "NOT_FOUND") {
    await db.posting.updateMany({
      where: { ats: ref.ats, board: ref.board, externalId, state: "NOT_FOUND" },
      data: { ...fields, relistedCount: { increment: 1 } },
    });
  }
  const row = await db.posting.upsert({
    where: key,
    update: fields,
    create: { ...fields, companyId: company.id, ats: ref.ats, board: ref.board, externalId, firstSeenAt: now },
  });
  return { found: true, posting: facts(row, row.id), source: "live" };
}

function latest(rows: Posting[]): Date | null {
  let max: Date | null = null;
  for (const r of rows) if (!max || r.fetchedAt > max) max = r.fetchedAt;
  return max;
}

function liveFirst(rows: Posting[]): PostingSummary[] {
  return rows
    .filter((r) => r.state === "LIVE")
    .sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0))
    .map(summary);
}
