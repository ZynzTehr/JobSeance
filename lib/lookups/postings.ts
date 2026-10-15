import { getDb } from "@/lib/db";
import { fetchBoardJob, fetchBoardJobs, fixturesEnabled, type BoardJob, type BoardRef } from "@/lib/lookups/boards";
import { UpstreamError } from "@/lib/lookups/fetch";
import type { Company, Posting, PostingState } from "@/app/generated/prisma/client";

// Board postings cached in the Posting table. A board is fresh for 1 hour after
// its last fetch; after that the next request refetches and syncs it in four
// queries (no per-row upserts: each round trip is slow over the Neon driver).

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
};

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
  company.ats === "NONE" || !company.atsBoard ? null : { ats: company.ats, board: company.atsBoard };

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
  if (fetchedAt && now.getTime() - fetchedAt.getTime() < POSTINGS_TTL_MS) {
    return { company: head, postings: liveFirst(rows), fetchedAt, source: "cache", stale: false };
  }

  let jobs: BoardJob[];
  try {
    jobs = await fetchBoardJobs(ref);
  } catch (error) {
    if (rows.length) return { company: head, postings: liveFirst(rows), fetchedAt, source: "cache", stale: true };
    throw new BoardUnavailableError(error);
  }

  await syncBoard(company, ref, jobs, rows, now);
  const synced = await db.posting.findMany({ where: { ats: ref.ats, board: ref.board } });
  const source = fixturesEnabled() ? "fixture" : "live";
  return { company: head, postings: liveFirst(synced), fetchedAt: now, source, stale: false };
}

/** Inserts new jobs, marks seen jobs LIVE and jobs that left the board NOT_FOUND. */
async function syncBoard(company: Company, ref: BoardRef, jobs: BoardJob[], existing: Posting[], now: Date) {
  const db = getDb();
  const known = new Set(existing.map((p) => p.externalId));
  const seen = jobs.map((j) => j.externalId);
  const fresh = jobs.filter((j) => !known.has(j.externalId));

  await db.$transaction([
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
    db.posting.updateMany({
      where: { ats: ref.ats, board: ref.board, externalId: { in: seen } },
      data: { state: "LIVE", lastSeenAt: now, fetchedAt: now },
    }),
    db.posting.updateMany({
      where: { ats: ref.ats, board: ref.board, externalId: { notIn: seen } },
      data: { state: "NOT_FOUND", fetchedAt: now },
    }),
  ]);
}

export type PostingLookup =
  | { found: true; posting: Posting; source: "live" | "cache" }
  | { found: false; source: "live" }
  | { found: null; error: UpstreamError | unknown }; // couldn't verify

/**
 * One posting with its description, used by checks (Phase 4). Serves a fresh
 * cached row that already has a description; otherwise fetches the single job.
 */
export async function lookupPosting(company: Company, jobId: string, now = new Date()): Promise<PostingLookup> {
  const ref = boardRef(company);
  if (!ref) return { found: null, error: new Error("company has no public board") };
  const db = getDb();
  const externalId = jobId.toLowerCase();
  const key = { ats_board_externalId: { ats: ref.ats, board: ref.board, externalId } };

  const cached = await db.posting.findUnique({ where: key });
  if (cached && cached.description !== null && now.getTime() - cached.fetchedAt.getTime() < POSTINGS_TTL_MS) {
    return { found: true, posting: cached, source: "cache" };
  }

  let job: BoardJob | null;
  try {
    job = await fetchBoardJob(ref, externalId);
  } catch (error) {
    return { found: null, error };
  }

  if (!job) {
    if (cached) await db.posting.update({ where: key, data: { state: "NOT_FOUND", fetchedAt: now } });
    return { found: false, source: "live" };
  }

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
  const posting = await db.posting.upsert({
    where: key,
    update: fields,
    create: { ...fields, companyId: company.id, ats: ref.ats, board: ref.board, externalId, firstSeenAt: now },
  });
  return { found: true, posting, source: "live" };
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
