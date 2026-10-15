import { readFile } from "node:fs/promises";
import path from "node:path";
import { getJson, UpstreamError, type FetchOptions } from "@/lib/lookups/fetch";
import type { BoardAts, LeverRegion } from "@/lib/lookups/job-url";

// Greenhouse, Lever and Ashby public job-board clients. Each returns the same
// trimmed shape. With USE_FIXTURES=1 they read fixtures/<ats>-<board>.json
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

export type BoardRef = { ats: BoardAts; board: string; region?: LeverRegion };

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

/** Turns a raw board response (live or fixture) into BoardJobs. */
export function normalizeBoard(ats: BoardAts, raw: unknown): BoardJob[] {
  if (ats === "GREENHOUSE") return ((raw as { jobs?: GreenhouseJob[] }).jobs ?? []).map(normalizeGreenhouse);
  if (ats === "LEVER") return (Array.isArray(raw) ? (raw as LeverPosting[]) : []).map(normalizeLever);
  return ((raw as { jobs?: AshbyJob[] }).jobs ?? []).map(normalizeAshby);
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

async function readFixture(ref: BoardRef): Promise<unknown> {
  if (!SAFE_BOARD.test(ref.board)) throw new UpstreamError("not_found");
  const file = path.join(process.cwd(), "fixtures", `${ref.ats.toLowerCase()}-${ref.board.toLowerCase()}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new UpstreamError("not_found"); // no fixture for this board
  }
}

// ---- Clients -----------------------------------------------------------------

/** Every job on a board. Throws UpstreamError("not_found") for an unknown board. */
export async function fetchBoardJobs(ref: BoardRef, opts?: FetchOptions): Promise<BoardJob[]> {
  const raw = fixturesEnabled() ? await readFixture(ref) : await getJson(boardUrl(ref), opts);
  return normalizeBoard(ref.ats, raw);
}

/** One job with its description, or null when it isn't on the board (Greenhouse 404s look the same for both). */
export async function fetchBoardJob(ref: BoardRef, jobId: string, opts?: FetchOptions): Promise<BoardJob | null> {
  const id = jobId.toLowerCase();
  const single = jobUrl(ref, jobId);
  if (fixturesEnabled() || !single) {
    const jobs = await fetchBoardJobs(ref, opts);
    return jobs.find((j) => j.externalId.toLowerCase() === id) ?? null;
  }
  try {
    const raw = await getJson(single, opts);
    return ref.ats === "GREENHOUSE" ? normalizeGreenhouse(raw as GreenhouseJob) : normalizeLever(raw as LeverPosting);
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "not_found") return null;
    throw error;
  }
}
