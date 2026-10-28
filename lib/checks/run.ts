import { z } from "zod";
import { getDb } from "@/lib/db";
import type { ApiError } from "@/lib/http";
import { fixturesEnabled, type BoardRef } from "@/lib/lookups/boards";
import { describeDomain, officialDomains, registrableDomain, type DomainReport } from "@/lib/lookups/domains";
import type { FetchOptions } from "@/lib/lookups/fetch";
import { parseJobUrl, SEARCH_ATS, withJobPath, type BoardAts } from "@/lib/lookups/job-url";
import { fetchBoardJobs, searchBoardJobs } from "@/lib/lookups/boards";
import { discoverBoard, probeBoard, type CachedDiscovery, type DiscoveryDeps } from "@/lib/lookups/discovery";
import { safeQuery } from "@/lib/ai/locate";
import { onHosts } from "@/lib/ai/presence";
import { pageUrlFor, type PageRead } from "@/lib/ai/read-page";
import { AI_REASON_TEXT, type AiOutcome } from "@/lib/ai/types";
import { locateRows, pageRows, presenceRows, presenceUsedAi } from "@/lib/checks/locate";
import { UpstreamError } from "@/lib/lookups/fetch";
import { boardRef, BoardUnavailableError, getCompanyPostings, lookupPosting, type PostingFacts } from "@/lib/lookups/postings";
import { currentTransport, offTransport, type AiTransport } from "@/lib/ai/transport";
import { checkMessageText, messageExtras, type MessageReading } from "@/lib/checks/message";
import { checkPostingText, postingTextSchema, searchMissDetail, type CompanyBoard, type PostingDeps, type Reading } from "@/lib/checks/posting";
import { dmarcPolicy } from "@/lib/lookups/mail-auth";
import { CONFIG_VERSION, DISCLAIMER, HIGH_SCAM_ADVICE, VERIFICATION_CHECKLIST } from "@/lib/scoring/config";
import { rateLimit } from "@/lib/http";
import { bandFor, clamp, scoreGhost, type BoardStatus, type CommunityReport, type CommunitySummary, type Score, type Signal } from "@/lib/scoring/ghost";
import { scoreScam, warningCount, type SenderFacts } from "@/lib/scoring/scam";
import type { Company, Prisma } from "@/app/generated/prisma/client";

// POST /api/v1/checks: gathers facts (boards, RDAP, DNS, reports), scores them
// with the pure rubrics, and stores only derived facts. Pasted text is never stored.

export const CHANNELS = ["EMAIL", "TEXT", "WHATSAPP", "TELEGRAM", "LINKEDIN", "OTHER"] as const;

export const checkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("url"), url: z.string().trim().min(1).max(2048) }),
  z.strictObject({
    kind: z.literal("company_role"),
    company: z.string().trim().min(1).max(100),
    role: z.string().trim().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("message"),
    text: z.string().trim().min(1, "Paste the message text.").max(20_000, "Keep it under 20,000 characters."),
    senderEmail: z.string().trim().max(254).optional(),
    companyClaimed: z.string().trim().max(100).optional(),
    channel: z.enum(CHANNELS).optional(),
    ...messageExtras,
  }),
  postingTextSchema,
]);
export type CheckInput = z.infer<typeof checkSchema>;

const INPUT_KIND = { url: "URL", company_role: "COMPANY_ROLE", message: "MESSAGE", posting_text: "POSTING_TEXT" } as const satisfies Record<CheckInput["kind"], string>;

export class CheckError extends Error {
  constructor(readonly api: ApiError) {
    super(api.message);
  }
}

const ATS_LABEL: Record<BoardAts, string> = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  WORKDAY: "Workday",
  SMARTRECRUITERS: "SmartRecruiters",
  WORKABLE: "Workable",
  RECRUITEE: "Recruitee",
  AMAZON: "amazon.jobs",
};
const ATS_HOST: Record<BoardAts, string> = {
  GREENHOUSE: "boards-api.greenhouse.io",
  LEVER: "api.lever.co",
  ASHBY: "api.ashbyhq.com",
  WORKDAY: "myworkdayjobs.com (career-site search)",
  SMARTRECRUITERS: "api.smartrecruiters.com",
  WORKABLE: "apply.workable.com",
  RECRUITEE: "recruitee.com",
  AMAZON: "amazon.jobs (search)",
};

export const boardSource = (ats: BoardAts) => (fixturesEnabled() ? `${ATS_HOST[ats]} (saved copy)` : ATS_HOST[ats]);
export const boardName = (ref: BoardRef, company: Company | null) =>
  company ? `${company.name}'s ${ATS_LABEL[ref.ats]} board` : `the "${ref.board}" ${ATS_LABEL[ref.ats]} board`;

export const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const normalizeTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Slug match, then a case-insensitive name prefix (spec "company_role"). */
export async function findCompany(name: string): Promise<Company | null> {
  const db = getDb();
  const slug = slugify(name);
  if (slug) {
    const bySlug = await db.company.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }
  return db.company.findFirst({ where: { name: { startsWith: name.trim(), mode: "insensitive" } }, orderBy: { name: "asc" } });
}

export async function communityFor(companyId: string, now: Date): Promise<CommunityReport[]> {
  const since = new Date(now.getTime() - 180 * 86_400_000);
  const rows = await getDb().outcomeReport.findMany({
    where: { companyId, visibility: "VISIBLE", createdAt: { gte: since } },
    select: { userId: true, stageReached: true, outcome: true, appliedAt: true, lastInterviewAt: true, createdAt: true },
  });
  return rows.map(({ stageReached, ...r }) => ({ ...r, stage: stageReached }));
}

// ---- Board-backed checks (URL, company + role) ----------------------------------

export type BoardCheck = {
  ghost: Score & { community: CommunitySummary };
  scam: Score;
  posting: PostingFacts | null;
  /** Phase 11 info rows (presence check). */
  gathered?: Signal[];
};

/** Looks up one job on its board: live, gone (with the cached copy) or couldn't verify. No scoring. */
export async function lookupBoardJob(
  ref: BoardRef,
  jobId: string,
  company: Company | null,
  { now = new Date(), fetch }: { now?: Date; fetch?: FetchOptions } = {},
): Promise<{ board: BoardStatus; posting: PostingFacts | null }> {
  const lookup = await lookupPosting(ref, jobId, company, { now, fetch });
  const name = boardName(ref, company);
  const source = boardSource(ref.ats);
  let board: BoardStatus;
  let posting: PostingFacts | null = null;
  if (lookup.found === true) {
    board = { kind: "live", boardName: name, source };
    posting = lookup.posting;
  } else if (lookup.found === false) {
    // Workday and Workable show ids in upper case; we store them lowercased.
    const shown = ref.ats === "WORKDAY" || ref.ats === "WORKABLE" ? jobId.toUpperCase() : jobId;
    board = { kind: "not_found", boardName: name, source, detail: `Job ${shown} is no longer on ${name}` };
    posting = lookup.previous;
  } else {
    board = { kind: "couldnt_verify", boardName: name, source };
  }
  return { board, posting };
}

/** Looks up one job and scores it. With company = null nothing touches the DB (used by tests). */
export async function checkBoardJob(
  ref: BoardRef,
  jobId: string,
  company: Company | null,
  { now = new Date(), fetch, community = [] }: { now?: Date; fetch?: FetchOptions; community?: CommunityReport[] } = {},
): Promise<BoardCheck> {
  const { board, posting } = await lookupBoardJob(ref, jobId, company, { now, fetch });
  return scoreBoardCheck(board, posting, ref.ats, community, now);
}

function scoreBoardCheck(
  board: BoardStatus,
  posting: PostingFacts | null,
  ats: BoardAts | null,
  community: CommunityReport[],
  now: Date,
): BoardCheck {
  const ghost = scoreGhost({
    board,
    postedAt: posting?.postedAt ?? null,
    description: posting?.description ?? null,
    greenhouseInternalJobId: ats === "GREENHOUSE" && posting ? posting.internalJobId : undefined,
    community,
    now,
  });
  const scam = scoreScam({
    text: posting?.description ?? null,
    sender: null,
    claimed: null,
    namesEmployer: false,
    notOnBoard: board.kind === "not_found" ? { fact: board.detail, source: board.source } : null,
    now,
  });
  return { ghost, scam, posting };
}

export async function resolveUrl(url: string): Promise<{ ref: BoardRef; jobId: string; company: Company | null }> {
  const parsed = parseJobUrl(url);
  if ("error" in parsed) {
    throw new CheckError({
      status: parsed.error === "invalid_url" ? 400 : 422,
      code: parsed.error,
      message: parsed.message,
      fields: { url: parsed.message },
    });
  }
  const db = getDb();
  if (parsed.kind === "gh_jid") {
    const domain = registrableDomain(parsed.hostname);
    const company = domain
      ? await db.company.findFirst({ where: { ats: "GREENHOUSE", officialDomains: { has: domain }, atsBoard: { not: null } } })
      : null;
    if (!company?.atsBoard) {
      throw new CheckError({
        status: 422,
        code: "unsupported_url",
        // Company + role won't help either: the company isn't in our directory.
        message: `This is a Greenhouse job on ${parsed.hostname}, but we can't tell which company's board it's on. Click Apply: if the page that opens starts with job-boards.greenhouse.io, paste that link instead.`,
      });
    }
    return { ref: { ats: "GREENHOUSE", board: company.atsBoard }, jobId: parsed.jobId, company };
  }
  const company = await db.company.findFirst({
    where: { ats: parsed.ats, atsBoard: { equals: parsed.board, mode: "insensitive" } },
  });
  const host = company?.atsHost ?? parsed.host;
  // The pasted job path only makes sense on the host it came from.
  const jobPath = parsed.jobPath && host === parsed.host ? parsed.jobPath : undefined;
  const ref: BoardRef = { ats: parsed.ats, board: company?.atsBoard ?? parsed.board, region: parsed.region, ...(host ? { host } : {}), ...(jobPath ? { jobPath } : {}) };
  return { ref, jobId: parsed.jobId, company };
}

export function pickByTitle<T extends { title: string }>(items: T[], role: string): T | null {
  const want = normalizeTitle(role);
  if (!want) return null;
  const exact = items.find((i) => normalizeTitle(i.title) === want);
  if (exact) return exact;
  const partial = items.filter((i) => normalizeTitle(i.title).includes(want));
  return partial.sort((a, b) => a.title.length - b.title.length)[0] ?? null;
}

export async function checkCompanyRole(company: Company, role: string, now: Date, presence?: (company: Company, role: string) => Promise<Signal[]>): Promise<BoardCheck> {
  const community = await communityFor(company.id, now);
  const ref = boardRef(company);

  if (!ref) {
    const rows = await getDb().posting.findMany({ where: { companyId: company.id } });
    const match = pickByTitle(rows, role);
    const posting = match
      ? { id: match.id, externalId: match.externalId, title: match.title, location: match.location, url: match.url, postedAt: match.postedAt, internalJobId: match.internalJobId, description: match.description }
      : null;
    const gathered = !match && presence ? await presence(company, role) : [];
    return { ...scoreBoardCheck({ kind: "no_board", companyName: company.name }, posting, null, community, now), gathered };
  }

  const found = await companyBoard(company, now, role);
  if (found.kind !== "board") {
    const name = boardName(ref, company);
    return scoreBoardCheck({ kind: "couldnt_verify", boardName: name, source: boardSource(ref.ats) }, null, ref.ats, community, now);
  }
  const match = pickByTitle(found.postings, role);
  if (!match && found.searched) {
    // A search can miss a posting (different wording, index lag), so a miss is never counted.
    const detail = searchMissDetail(role, found.boardName);
    return scoreBoardCheck({ kind: "couldnt_verify", boardName: found.boardName, source: found.source, detail }, null, ref.ats, community, now);
  }
  if (!match) {
    const detail = `No posting titled "${role.slice(0, 80)}" on ${found.boardName}`;
    return scoreBoardCheck({ kind: "not_found", boardName: found.boardName, source: found.source, detail }, null, ref.ats, community, now);
  }
  return checkBoardJob(withJobPath(ref, match.url), match.externalId, company, { now, community });
}

// ---- Message checks -------------------------------------------------------------

const RDAP_SOURCE = { official: "RDAP", unofficial: "RDAP (unofficial registry)", cache: "RDAP (cached)" } as const;

export function senderFacts(report: DomainReport, reporters: number): SenderFacts {
  const { facts } = report;
  return {
    domain: report.domain,
    rdapStatus: facts.status,
    rdapSource: facts.source ? RDAP_SOURCE[facts.source] : "RDAP",
    ageDays: report.ageDays,
    hasMx: facts.hasMx,
    nullMx: facts.nullMx,
    freeMail: report.freeMail,
    disposable: report.disposable,
    atsSender: report.atsSender,
    lookalike: report.lookalike && { official: report.lookalike.official, reason: report.lookalike.reason },
    officialFor: report.officialFor,
    reporters,
  };
}

async function checkMessage(input: Extract<CheckInput, { kind: "message" }>, userId: string | null, now: Date, ai: AiTransport | undefined) {
  if (input.senderEmail && !registrableDomain(input.senderEmail)) {
    throw new CheckError({
      status: 400,
      code: "validation_failed",
      message: "Check the sender address.",
      fields: { senderEmail: "Enter an address like name@company.com." },
    });
  }
  if (input.aiRead && !userId) throw new CheckError({ status: 401, code: "unauthorized", message: "Sign in to continue." });
  return checkMessageText(input, {
    ai: input.aiRead ? (ai ?? (await currentTransport())) : offTransport,
    userId: userId ?? "",
    now,
    signal: AbortSignal.timeout(POSTING_DEADLINE_MS),
    findCompany,
    sender: (addressOrDomain) => senderForDomain(addressOrDomain, now),
    dmarcPolicy: (domain) => dmarcPolicy(domain),
    officials: officialDomains,
  });
}

// ---- Pasted postings (phase 9) ----------------------------------------------------

const LEGAL_SUFFIX = /[,\s]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|ag|sa|bv)\.?$/i;

/** For AI-read names: exact slug or exact name (legal suffixes stripped). Never a prefix match. */
export async function findCompanyExact(name: string): Promise<Company | null> {
  const bare = name.trim().replace(LEGAL_SUFFIX, "").trim();
  if (!bare) return null;
  const db = getDb();
  const slug = slugify(bare);
  if (slug) {
    const bySlug = await db.company.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }
  return db.company.findFirst({ where: { name: { equals: bare, mode: "insensitive" } } });
}

/**
 * A company's postings to match a role against: the stored rows (no public board), the cached
 * board, or for search systems (Workday, SmartRecruiters, amazon.jobs) the system's own search.
 */
async function companyBoard(company: Company, now: Date, role?: string): Promise<CompanyBoard> {
  const ref = boardRef(company);
  if (!ref) {
    const rows = await getDb().posting.findMany({ where: { companyId: company.id } });
    return {
      kind: "stored",
      postings: rows.map((r) => ({ id: r.id, externalId: r.externalId, title: r.title, location: r.location, url: r.url, postedAt: r.postedAt, internalJobId: r.internalJobId, description: r.description })),
    };
  }
  const name = boardName(ref, company);
  const source = boardSource(ref.ats);
  if (SEARCH_ATS.has(ref.ats) && role) {
    try {
      const jobs = await searchBoardJobs(ref, role);
      return { kind: "board", ref, boardName: name, source, searched: true, postings: jobs.map((j) => ({ ...j, state: "LIVE" as const })) };
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      return { kind: "unavailable", boardName: name, source };
    }
  }
  try {
    const list = await getCompanyPostings(company.slug, now);
    return { kind: "board", ref, boardName: name, source, postings: list?.postings ?? [] };
  } catch (error) {
    if (!(error instanceof BoardUnavailableError)) throw error;
    return { kind: "unavailable", boardName: name, source };
  }
}

async function senderForDomain(domain: string, now: Date) {
  const report = await describeDomain(domain, now);
  if (!report) return null;
  const reporters = (
    await getDb().scamReport.findMany({ where: { senderDomain: report.domain, visibility: "VISIBLE" }, distinct: ["userId"], select: { userId: true } })
  ).length;
  return senderFacts(report, reporters);
}

// ---- Phase 11: employers outside the directory, presence checks, page reads ---------

function discoveryCache(): DiscoveryDeps["cache"] {
  const db = getDb();
  return {
    get: async (key) => (await db.boardDiscovery.findUnique({ where: { key } })) as CachedDiscovery | null,
    put: async (row) => {
      await db.boardDiscovery.upsert({ where: { key: row.key }, update: { ...row, checkedAt: new Date() }, create: row });
    },
  };
}

/** Lookups of unlisted companies per account per hour: each one can probe several job boards. */
export const DISCOVERY_PER_HOUR = 20;

/** Finds an unknown employer's board and turns it into info rows (never counted). */
export function locator(userId: string, now: Date, ai: AiTransport, started: number, signal?: AbortSignal) {
  return async (employer: string, role: string | null, typed: boolean) => {
    if (!rateLimit(`discover:user:${userId || "anonymous"}`, DISCOVERY_PER_HOUR, 3600).ok) {
      const d = { found: null, unconfirmed: [], ai: { used: false, model: null, mode: null }, aiFailure: "limit" as const };
      return { rows: await locateRows(d, role, typed, { now, pickByTitle, jobs: async () => [] }), ai: d.ai, located: false, aiFailure: d.aiFailure };
    }
    const d = await discoverBoard(employer, role, {
      ai,
      userId,
      now,
      signal,
      probe: (l) => (fixturesEnabled() ? Promise.resolve(null) : probeBoard(l)),
      cache: discoveryCache(),
      // A web search takes up to 30 s: only start one with that much of the deadline left.
      canSearch: () => Date.now() - started <= POSTING_DEADLINE_MS - 30_000,
    });
    const rows = await locateRows(d, role, typed, {
      now,
      pickByTitle,
      jobs: (ref, r) => (SEARCH_ATS.has(ref.ats) ? searchBoardJobs(ref, r) : fetchBoardJobs(ref)),
    });
    return { rows, ai: d.ai, located: Boolean(d.found || d.unconfirmed.length), aiFailure: d.aiFailure };
  };
}

/** Presence results per company and title, kept for 6 hours on this server (searches cost money; the answer changes slowly). */
const PRESENCE_TTL_MS = 6 * 3_600_000;
const presenceCache = new Map<string, { at: number; out: Awaited<ReturnType<NonNullable<AiTransport["presence"]>>> }>();

/** Presence check on a directory company's own careers hosts (admin-curated). */
export function presenceCheck(userId: string, now: Date, ai: AiTransport, signal?: AbortSignal) {
  return async (company: Company, role: string): Promise<Signal[]> => {
    const hosts = company.careersHosts;
    const title = safeQuery(role, 120);
    if (!hosts.length || !title || !ai.presence) return [];
    const key = `${company.id}|${hosts.join(",")}|${title.toLowerCase()}`;
    const hit = presenceCache.get(key);
    let out = hit && Date.now() - hit.at < PRESENCE_TTL_MS ? hit.out : null;
    if (!out) {
      out = await ai.presence(title, hosts, { userId, signal });
      if (out.ok) {
        if (presenceCache.size >= 500) presenceCache.delete(presenceCache.keys().next().value!);
        presenceCache.set(key, { at: Date.now(), out });
      }
    }
    return presenceRows(out, role, hosts, now);
  };
}

const PAGE_NOTE = "From a page read: shown for information and not counted yet.";

/**
 * Page-derived phrase hits are shown, not counted, until page reads are measured; community
 * reports still count. A page whose warning signs were set aside, or that couldn't be read,
 * gets "Not enough data", never a reassuring "Low" built from nothing.
 */
export function pageInfoOnly<T extends Score>(s: T, hadText: boolean): T {
  let demoted = false;
  const signals = s.signals.map((x) => {
    if (x.points <= 0 || x.id === "G-COMMUNITY") return x;
    demoted = true;
    return { ...x, points: 0, kind: "info" as const, note: PAGE_NOTE };
  });
  if (s.band === "NOT_ENOUGH_DATA") return { ...s, signals };
  const score = clamp(signals.reduce((sum, x) => sum + x.points, 0), 0, 100);
  if (score === 0 && (demoted || !hadText)) return { ...s, score: null, band: "NOT_ENOUGH_DATA", signals };
  return { ...s, score, band: bandFor(score), signals };
}

type PageCheck = BoardCheck & { gathered: Signal[]; company: Company; ai: { used: boolean; model: string | null; mode: "live" | "replay" | null; suggestedKind: null } };

/** A link on a directory company's allowlisted careers host: Anthropic's fetch tool reads the page. Null when the host isn't allowlisted. */
async function pageCheck(rawUrl: string, userId: string | null, now: Date, aiOverride?: AiTransport): Promise<PageCheck | null> {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const companies = await getDb().company.findMany({ where: { NOT: { careersHosts: { isEmpty: true } } } });
  const company = companies.find((c) => onHosts(`https://${host}/`, c.careersHosts));
  const url = company ? pageUrlFor(rawUrl, company.careersHosts) : null;
  if (!company || !url) return null;

  const transport = userId ? (aiOverride ?? (await currentTransport())) : offTransport;
  const out: AiOutcome<PageRead> = transport.readPage
    ? await transport.readPage(url, host, { userId: userId ?? "", signal: AbortSignal.timeout(POSTING_DEADLINE_MS) })
    : { ok: false, reason: "off" };
  const text = out.ok ? out.value.pageText : null;
  const community = await communityFor(company.id, now);
  const board: BoardStatus = {
    kind: "couldnt_verify",
    boardName: "",
    source: host,
    detail: `${company.name} doesn't use a job board we read, so we can't check whether this job is still open (nothing counted)`,
  };
  const g = scoreGhost({ board, postedAt: null, description: text, community, now });
  const scam = scoreScam({ text, sender: null, claimed: null, namesEmployer: false, notOnBoard: null, now });
  const posting: PostingFacts | null =
    out.ok && out.value.title
      ? { id: null, externalId: "", title: out.value.title, location: out.value.location, url: out.value.url, postedAt: null, internalJobId: null, description: null }
      : null;
  return {
    ghost: { ...pageInfoOnly(g, Boolean(text)), community: g.community },
    scam: pageInfoOnly(scam, Boolean(text)),
    posting,
    gathered: pageRows(out, host, now),
    company,
    ai: { used: out.ok, model: out.ok ? out.model : null, mode: out.ok ? out.mode : null, suggestedKind: null },
  };
}

export function postingDeps(userId: string, now: Date, ai: AiTransport, signal?: AbortSignal): PostingDeps {
  const started = Date.now();
  return {
    locate: locator(userId, now, ai, started, signal),
    presence: presenceCheck(userId, now, ai, signal),
    ai,
    userId,
    now,
    signal,
    findCompany,
    findCompanyExact,
    companyBoard: (company, role) => companyBoard(company, now, role),
    lookupJob: (ref, jobId, company) => lookupBoardJob(ref, jobId, company, { now }),
    resolveLink: async (url) => {
      try {
        return await resolveUrl(url);
      } catch (error) {
        if (error instanceof CheckError) return null;
        throw error;
      }
    },
    community: (companyId) => communityFor(companyId, now),
    sender: (domain) => senderForDomain(domain, now),
    pickByTitle,
  };
}

/** A pasted-posting check gets 45 s in total, AI step included. */
export const POSTING_DEADLINE_MS = 45_000;

// ---- Entry point ------------------------------------------------------------------

export async function runCheck(input: CheckInput, userId: string | null, now = new Date(), opts: { ai?: AiTransport } = {}) {
  const db = getDb();
  const notEnough: Score = { score: null, band: "NOT_ENOUGH_DATA", signals: [] };
  let ghost: Score;
  let scam: Score;
  let community: CommunitySummary | undefined;
  let company: Company | null = null;
  let posting: PostingFacts | null = null;
  let senderDomain: string | null = null;
  let gathered: Signal[] = [];
  let reading: Reading | null = null;
  let messageReading: MessageReading | null = null;
  let ai: { used: boolean; model: string | null; mode: "live" | "replay" | null; suggestedKind: "message" | null; textSent?: boolean } | null = null;

  if (input.kind === "posting_text") {
    if (!userId) throw new CheckError({ status: 401, code: "unauthorized", message: "Sign in to continue." });
    const transport = opts.ai ?? (await currentTransport());
    const result = await checkPostingText(input, postingDeps(userId, now, transport, AbortSignal.timeout(POSTING_DEADLINE_MS)));
    const { community: summary, ...ghostScore } = result.ghost;
    ghost = ghostScore;
    community = summary;
    scam = result.scam;
    posting = result.posting;
    company = result.company;
    gathered = result.gathered;
    reading = result.reading;
    ai = result.ai;
  } else if (input.kind === "message") {
    const result = await checkMessage(input, userId, now, opts.ai);
    ghost = notEnough;
    scam = result.scam;
    company = result.claimed;
    senderDomain = result.senderDomain;
    gathered = result.gathered;
    messageReading = result.reading;
    ai = result.ai;
  } else {
    let result: BoardCheck;
    if (input.kind === "url") {
      let resolved: Awaited<ReturnType<typeof resolveUrl>> | null = null;
      let page: PageCheck | null = null;
      try {
        resolved = await resolveUrl(input.url);
      } catch (error) {
        if (!(error instanceof CheckError) || error.api.code !== "unsupported_url") throw error;
        page = await pageCheck(input.url, userId, now, opts.ai);
        // No hint from a board's name: anyone can open a board under a company's name.
        if (!page) throw error;
      }
      if (page) {
        result = page;
        company = page.company;
        gathered = page.gathered;
        ai = page.ai;
      } else {
        company = resolved!.company;
        const reports = company ? await communityFor(company.id, now) : [];
        result = await checkBoardJob(resolved!.ref, resolved!.jobId, company, { now, community: reports });
      }
    } else {
      const transport = userId ? (opts.ai ?? (await currentTransport())) : offTransport;
      const signal = AbortSignal.timeout(POSTING_DEADLINE_MS);
      company = await findCompany(input.company);
      if (!company) {
        const located = await locator(userId ?? "", now, transport, Date.now(), signal)(input.company, input.role, true);
        if (!located.located) {
          const why =
            located.aiFailure === "limit"
              ? ` (${AI_REASON_TEXT.limit})`
              : located.aiFailure && located.aiFailure !== "off"
                ? ` (the AI-assisted search didn't finish: ${AI_REASON_TEXT[located.aiFailure]})`
                : "";
          throw new CheckError({
            status: 404,
            code: "company_not_found",
            message: `We don't have that company, and we couldn't find its job board on the systems we read${why}. Try a job link, or paste the posting text.`,
          });
        }
        gathered = located.rows;
        ai = { used: located.ai.used, model: located.ai.model, mode: located.ai.mode, suggestedKind: null };
        const board: BoardStatus = { kind: "couldnt_verify", boardName: "", source: "JobSeance company list", detail: "This company isn't in our directory, so no employer board was checked (nothing counted)" };
        result = scoreBoardCheck(board, null, null, [], now);
      } else {
        result = await checkCompanyRole(company, input.role, now, presenceCheck(userId ?? "", now, transport, signal));
        gathered = result.gathered ?? [];
        if (presenceUsedAi(gathered)) ai = { used: true, model: null, mode: null, suggestedKind: null };
      }
    }
    const { community: summary, ...ghostScore } = result.ghost;
    ghost = ghostScore;
    community = summary;
    scam = result.scam;
    posting = result.posting;
  }

  const check = await db.check.create({
    data: {
      userId,
      inputKind: INPUT_KIND[input.kind],
      postingId: posting?.id ?? null,
      companyId: company?.id ?? null,
      senderDomain,
      ghostScore: ghost.score,
      ghostBand: ghost.band,
      scamScore: scam.score,
      scamBand: scam.band,
      signals: [...gathered, ...ghost.signals, ...scam.signals] as unknown as Prisma.InputJsonValue,
      configVersion: CONFIG_VERSION,
      aiUsed: Boolean(ai?.used),
    },
    select: { id: true, createdAt: true },
  });

  return {
    id: check.id,
    kind: input.kind,
    checkedAt: check.createdAt,
    company: company && { slug: company.slug, name: company.name, isFictional: company.isFictional },
    posting: posting && { title: posting.title, location: posting.location, url: posting.url, postedAt: posting.postedAt },
    ghost,
    scam: { ...scam, warnings: warningCount(scam) },
    ...(community ? { community } : {}),
    ...(input.kind === "posting_text" ? { gathered, reading, ai } : {}),
    ...((input.kind === "url" || input.kind === "company_role") && gathered.length ? { gathered, ai } : {}),
    ...(input.kind === "message" && (gathered.length || input.aiRead) ? { gathered, messageReading, ai } : {}),
    meta: {
      configVersion: CONFIG_VERSION,
      disclaimer: DISCLAIMER,
      verificationChecklist: VERIFICATION_CHECKLIST,
      ...(scam.band === "HIGH" ? { whatToDo: HIGH_SCAM_ADVICE } : {}),
    },
  };
}
