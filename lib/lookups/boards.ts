import { readFile } from "node:fs/promises";
import path from "node:path";
import { getJson, UpstreamError, type FetchOptions } from "@/lib/lookups/fetch";
import {
  adapterExists,
  adapterJob,
  adapterList,
  adapterSearch,
  normalizeAmazon,
  normalizeRecruitee,
  normalizeSmartRecruiters,
  normalizeWorkable,
  normalizeWorkday,
  type AdapterJob,
} from "@/lib/lookups/adapters";
import { SEARCH_ATS, type BoardAts, type LeverRegion } from "@/lib/lookups/job-url";

// Job-board clients: Greenhouse, Lever and Ashby here, the phase 10 systems in
// lib/lookups/adapters.ts. Each returns the same trimmed shape. With USE_FIXTURES=1 they read fixtures/<ats>-<board>.json
// (a raw board response) instead of the network.

export type BoardJob = {
  externalId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: Date | null; // GH first_published, Lever createdAt, Ashby publishedAt (last publish)
  internalJobId: string | null; // Greenhouse only
  description: string | null; // plain text, max 20,000 chars
};

export type BoardRef = {
  ats: BoardAts;
  board: string;
  region?: LeverRegion;
  /** Workday only: the career-site host. */
  host?: string;
  /** Workday only: the pasted job's own path, used to confirm a removed job. */
  jobPath?: string;
};

/** Greenhouse, Lever and Ashby use the clients below; the phase 10 systems use lib/lookups/adapters.ts. */
const ORIGINAL = new Set<BoardAts>(["GREENHOUSE", "LEVER", "ASHBY"]);

const MAX_DESCRIPTION = 20_000;
const SAFE_BOARD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const fixturesEnabled = () => process.env.USE_FIXTURES === "1";

// ---- Normalizers (pure; tested against fixtures) ----------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Greenhouse `content` is HTML-escaped HTML: decode entities, then strip tags, then decode text entities. */
export function htmlToText(escaped: string): string | null {
  const html = decodeEntities(escaped);
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return clip(decodeEntities(text));
}

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  const tidy = text.replace(/[ \t\f\v\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return tidy ? tidy.slice(0, MAX_DESCRIPTION) : null;
}

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
};

type GreenhouseJob = {
  id: number;
  title: string;
  location?: { name?: string } | null;
  first_published?: string | null;
  internal_job_id?: number | null;
  absolute_url: string;
  content?: string | null;
};

export function normalizeGreenhouse(job: GreenhouseJob): BoardJob {
  return {
    externalId: String(job.id),
    title: job.title.trim(),
    location: job.location?.name?.trim() || null,
    url: job.absolute_url,
    postedAt: toDate(job.first_published),
    internalJobId: job.internal_job_id == null ? null : String(job.internal_job_id),
    description: job.content ? htmlToText(job.content) : null,
  };
}

type LeverPosting = {
  id: string;
  text: string;
  categories?: { location?: string | null } | null;
  createdAt?: number | null;
  hostedUrl: string;
  descriptionPlain?: string | null;
};

export function normalizeLever(job: LeverPosting): BoardJob {
  return {
    externalId: job.id.toLowerCase(),
    title: job.text.trim(),
    location: job.categories?.location?.trim() || null,
    url: job.hostedUrl,
    postedAt: toDate(job.createdAt),
    internalJobId: null,
    description: clip(job.descriptionPlain),
  };
}

type AshbyJob = {
  id: string;
  title: string;
  location?: string | null;
  publishedAt?: string | null;
  jobUrl: string;
  descriptionPlain?: string | null;
};

export function normalizeAshby(job: AshbyJob): BoardJob {
  return {
    externalId: job.id.toLowerCase(),
    title: job.title.trim(),
    location: job.location?.trim() || null,
    url: job.jobUrl,
    postedAt: toDate(job.publishedAt),
    internalJobId: null,
    description: clip(job.descriptionPlain),
  };
}

const fromAdapter = (j: AdapterJob): BoardJob => ({
  externalId: j.externalId,
  title: j.title,
  location: j.location,
  url: j.url,
  postedAt: j.postedAt,
  internalJobId: j.internalJobId,
  description: j.descriptionHtml ? htmlToText(j.descriptionHtml) : null,
});

/** Runs a normalizer; an unexpected response shape is a bad response ("couldn't verify"), never a crash. */
function safely<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError("bad_body");
  }
}

/** Turns a raw board response (live or fixture) into BoardJobs. */
export function normalizeBoard(ats: BoardAts, raw: unknown, ref: Omit<BoardRef, "ats"> = { board: "" }): BoardJob[] {
  return safely(() => normalizeUnsafe(ats, raw, ref));
}

function normalizeUnsafe(ats: BoardAts, raw: unknown, ref: Omit<BoardRef, "ats">): BoardJob[] {
  // A body without its job list is a bad response, never an empty board (that would mark every job removed).
  const list = <T>(v: unknown): T[] => {
    if (!Array.isArray(v)) throw new UpstreamError("bad_body");
    return v as T[];
  };
  if (ats === "GREENHOUSE") return list<GreenhouseJob>((raw as { jobs?: unknown }).jobs).map(normalizeGreenhouse);
  if (ats === "LEVER") return list<LeverPosting>(raw).map(normalizeLever);
  if (ats === "ASHBY") return list<AshbyJob>((raw as { jobs?: unknown }).jobs).map(normalizeAshby);
  const r = { ...ref, ats };
  const jobs =
    ats === "WORKDAY"
      ? normalizeWorkday(raw as never, r)
      : ats === "SMARTRECRUITERS"
        ? normalizeSmartRecruiters(raw as never, r)
        : ats === "WORKABLE"
          ? normalizeWorkable(raw as never, r)
          : ats === "RECRUITEE"
            ? normalizeRecruitee(raw as never, r)
            : normalizeAmazon(raw as never);
  return jobs.map(fromAdapter);
}

// ---- URLs (built from constants + encodeURIComponent) -----------------------

function boardUrl({ ats, board, region }: BoardRef): string {
  const b = encodeURIComponent(board);
  if (ats === "GREENHOUSE") return `https://boards-api.greenhouse.io/v1/boards/${b}/jobs`;
  if (ats === "LEVER") return `https://${region === "eu" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${b}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${b}`;
}

function jobUrl({ ats, board, region }: BoardRef, jobId: string): string | null {
  const b = encodeURIComponent(board);
  const id = encodeURIComponent(jobId);
  if (ats === "GREENHOUSE") return `https://boards-api.greenhouse.io/v1/boards/${b}/jobs/${id}?content=true`;
  if (ats === "LEVER") return `https://${region === "eu" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${b}/${id}?mode=json`;
  return null; // Ashby has no single-job endpoint
}

/** Fixture file name: "workday-nvidia--nvidiaexternalcareersite.json" for board "nvidia/NVIDIAExternalCareerSite". */
export const fixtureName = (ref: BoardRef) => `${ref.ats.toLowerCase()}-${ref.board.toLowerCase().replace("/", "--")}.json`;

async function readFixture(ref: BoardRef): Promise<unknown> {
  if (!ref.board.split("/").every((part) => SAFE_BOARD.test(part)) || ref.board.split("/").length > 2) throw new UpstreamError("not_found");
  const file = path.join(process.cwd(), "fixtures", fixtureName(ref));
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new UpstreamError("not_found"); // no fixture for this board
  }
}

// ---- Clients -----------------------------------------------------------------

/**
 * A board's jobs. For search systems (Workday, SmartRecruiters, amazon.jobs) this is only
 * the newest page, so `partial` is true and `total` is the system's own count.
 */
export async function fetchBoardList(ref: BoardRef, opts?: FetchOptions): Promise<{ jobs: BoardJob[]; total: number | null; partial: boolean }> {
  const partial = SEARCH_ATS.has(ref.ats);
  if (fixturesEnabled()) {
    const jobs = normalizeBoard(ref.ats, await readFixture(ref), ref);
    return { jobs, total: jobs.length, partial };
  }
  if (ORIGINAL.has(ref.ats)) {
    const jobs = normalizeBoard(ref.ats, await getJson(boardUrl(ref), opts), ref);
    return { jobs, total: jobs.length, partial: false };
  }
  const list = await adapterList(ref, opts);
  return { jobs: list.jobs.map(fromAdapter), total: list.total, partial };
}

/** Every job on a board (or the newest page for search systems). Throws UpstreamError("not_found") for an unknown board. */
export async function fetchBoardJobs(ref: BoardRef, opts?: FetchOptions): Promise<BoardJob[]> {
  return (await fetchBoardList(ref, opts)).jobs;
}

/** Jobs whose title matches a role, using the system's own search (search systems) or the whole board. */
export async function searchBoardJobs(ref: BoardRef, role: string, opts?: FetchOptions): Promise<BoardJob[]> {
  if (fixturesEnabled() || !SEARCH_ATS.has(ref.ats)) return fetchBoardJobs(ref, opts);
  return (await adapterSearch(ref, role, opts)).map(fromAdapter);
}

/** One job with its description, or null when it isn't on the board (Greenhouse 404s look the same for both). */
export async function fetchBoardJob(ref: BoardRef, jobId: string, opts?: FetchOptions): Promise<BoardJob | null> {
  const id = jobId.toLowerCase();
  if (!fixturesEnabled() && !ORIGINAL.has(ref.ats)) {
    const job = await adapterJob(ref, id, opts);
    return job ? fromAdapter(job) : null;
  }
  const single = ORIGINAL.has(ref.ats) ? jobUrl(ref, jobId) : null;
  if (fixturesEnabled() || !single) {
    const jobs = await fetchBoardJobs(ref, opts);
    const job = jobs.find((j) => j.externalId.toLowerCase() === id) ?? null;
    // A saved copy of a search system holds only the newest page: a miss there proves nothing.
    if (!job && SEARCH_ATS.has(ref.ats)) throw new UpstreamError("bad_body");
    return job;
  }
  try {
    const raw = await getJson(single, opts);
    return safely(() => (ref.ats === "GREENHOUSE" ? normalizeGreenhouse(raw as GreenhouseJob) : normalizeLever(raw as LeverPosting)));
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "not_found") return null;
    throw error;
  }
}

/**
 * Whether the board itself exists. Greenhouse answers a wrong token and a removed
 * job with the same 404, so a missing job only counts once the board is confirmed.
 * Throws on network errors and timeouts.
 */
export async function boardExists(ref: BoardRef, opts?: FetchOptions): Promise<boolean> {
  const b = encodeURIComponent(ref.board);
  if (!fixturesEnabled() && !ORIGINAL.has(ref.ats)) return adapterExists(ref, opts);
  try {
    if (fixturesEnabled()) await readFixture(ref);
    else if (ref.ats === "GREENHOUSE") await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}`, opts);
    else if (ref.ats === "LEVER") await getJson(`${boardUrl(ref)}&limit=1`, opts);
    else await getJson(boardUrl(ref), opts);
    return true;
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "not_found") return false;
    throw error;
  }
}
