import { getJson, headStatus, postJson, UpstreamError, type FetchOptions } from "@/lib/lookups/fetch";
import { WORKDAY_HOST, WORKDAY_JOB_PATH, type BoardAts } from "@/lib/lookups/job-url";

// Phase 10 adapters: Workday (public career-site JSON, undocumented), SmartRecruiters
// (public posting API), Workable (public widget API), Recruitee (public offers API)
// and amazon.jobs (public search JSON). Every outbound URL is built from constants
// plus validated, encoded identifiers; the server never fetches a URL a user pasted.
// Each adapter returns the same BoardJob shape as Greenhouse, Lever and Ashby.

export type AdapterJob = {
  externalId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: Date | null;
  internalJobId: string | null;
  /** Raw HTML or text; boards.ts turns it into clipped plain text. */
  descriptionHtml: string | null;
};

export type AdapterRef = { ats: BoardAts; board: string; host?: string; /** Workday: the pasted job's own path. */ jobPath?: string };
export type AdapterList = { jobs: AdapterJob[]; total: number | null };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const WORKDAY_PAGE = 20; // Workday's maximum page size
const SEARCH_LIMIT = 20;

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value).replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, "$1T$2Z"));
  return Number.isNaN(d.getTime()) ? null : d;
};

function assertSafe(...ids: string[]) {
  for (const id of ids) if (!SAFE_ID.test(id)) throw new UpstreamError("not_found");
}

// ---- Workday --------------------------------------------------------------------

type WorkdayListItem = { title: string; externalPath: string; locationsText?: string | null; postedOn?: string | null; bulletFields?: string[] };
type WorkdayList = { total?: number; jobPostings?: WorkdayListItem[] };
type WorkdayDetail = { jobPostingInfo?: { title?: string; jobDescription?: string; location?: string; startDate?: string; jobReqId?: string; externalUrl?: string } };
/** Fixture shape: the list response plus detail responses keyed by externalPath. */
export type WorkdayRaw = WorkdayList & { details?: Record<string, WorkdayDetail> };

const WORKDAY_EXTERNAL_PATH = WORKDAY_JOB_PATH;

function workdayParts(ref: AdapterRef) {
  const [tenant, site] = ref.board.split("/");
  const host = (ref.host ?? "").toLowerCase();
  const m = WORKDAY_HOST.exec(host);
  if (!m || !tenant || !site || m[1] !== tenant.toLowerCase()) throw new UpstreamError("not_found");
  assertSafe(tenant, site);
  return { base: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`, publicBase: `https://${host}/${encodeURIComponent(site)}` };
}

/** "…/Senior-Engineer_JR2022104-1" → "jr2022104-1" (the id the job's own URL ends with). */
export const workdayIdOf = (externalPath: string) => (externalPath.split("_").pop() ?? externalPath).toLowerCase();

export function normalizeWorkday(raw: WorkdayRaw, ref: AdapterRef): AdapterJob[] {
  const site = ref.board.split("/")[1] ?? "";
  const publicBase = ref.host ? `https://${ref.host}/${encodeURIComponent(site)}` : "";
  return (raw.jobPostings ?? [])
    .filter((j) => WORKDAY_EXTERNAL_PATH.test(j.externalPath) && !j.externalPath.includes(".."))
    .map((j) => {
      const info = raw.details?.[j.externalPath]?.jobPostingInfo;
      return {
        externalId: workdayIdOf(j.externalPath),
        title: (info?.title ?? j.title).trim(),
        location: (info?.location ?? j.locationsText)?.trim() || null,
        url: `${publicBase}${j.externalPath}`,
        postedAt: toDate(info?.startDate),
        internalJobId: info?.jobReqId ?? j.bulletFields?.[0] ?? null,
        descriptionHtml: info?.jobDescription ?? null,
      };
    });
}

async function workdayList(ref: AdapterRef, searchText: string, opts?: FetchOptions): Promise<AdapterList> {
  const { base } = workdayParts(ref);
  const raw = await postJson<WorkdayList>(`${base}/jobs`, { appliedFacets: {}, limit: WORKDAY_PAGE, offset: 0, searchText: searchText.slice(0, 200) }, opts);
  return { jobs: normalizeWorkday(raw, ref), total: typeof raw.total === "number" ? raw.total : null };
}

async function workdayJob(ref: AdapterRef, jobId: string, opts?: FetchOptions): Promise<AdapterJob | null> {
  const { base } = workdayParts(ref);
  const id = jobId.toLowerCase();
  // Search by the requisition number (without a "-1" posting suffix), then match the exact id.
  const raw = await postJson<WorkdayList>(`${base}/jobs`, { appliedFacets: {}, limit: WORKDAY_PAGE, offset: 0, searchText: id.replace(/-\d+$/, "") }, opts);
  const item = (raw.jobPostings ?? []).find((j) => WORKDAY_EXTERNAL_PATH.test(j.externalPath) && !j.externalPath.includes("..") && workdayIdOf(j.externalPath) === id);
  if (item) {
    const detail = await getJson<WorkdayDetail>(`${base}${item.externalPath}`, opts);
    return normalizeWorkday({ jobPostings: [item], details: { [item.externalPath]: detail } }, ref)[0] ?? null;
  }
  // The search is undocumented, so a miss alone never counts. With the job's own path (from the
  // pasted link) the detail endpoint answers 404 for a removed job; without it, couldn't verify.
  const path = ref.jobPath;
  if (!path || !WORKDAY_EXTERNAL_PATH.test(path) || path.includes("..") || workdayIdOf(path) !== id) throw new UpstreamError("bad_body");
  try {
    const detail = await getJson<WorkdayDetail>(`${base}${path}`, opts);
    const title = detail.jobPostingInfo?.title;
    if (!title) throw new UpstreamError("bad_body");
    return normalizeWorkday({ jobPostings: [{ title, externalPath: path }], details: { [path]: detail } }, ref)[0] ?? null;
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "not_found") return null;
    throw error;
  }
}

// ---- SmartRecruiters --------------------------------------------------------------

type SrPosting = { id: string; name: string; releasedDate?: string; location?: { fullLocation?: string; city?: string } | null; refNumber?: string };
type SrList = { totalFound?: number; content?: SrPosting[] };
type SrDetail = SrPosting & { postingUrl?: string; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
export type SmartRecruitersRaw = SrList & { details?: Record<string, SrDetail> };

const SR_API = "https://api.smartrecruiters.com/v1/companies";

export function normalizeSmartRecruiters(raw: SmartRecruitersRaw, ref: AdapterRef): AdapterJob[] {
  return (raw.content ?? [])
    .filter((p) => /^\d{1,20}$/.test(p.id))
    .map((p) => {
      const d = raw.details?.[p.id];
      const sections = d?.jobAd?.sections ? Object.values(d.jobAd.sections).map((s) => s?.text ?? "").join("\n") : null;
      return {
        externalId: p.id,
        title: p.name.trim(),
        location: p.location?.fullLocation?.trim() || p.location?.city?.trim() || null,
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(ref.board)}/${p.id}`,
        postedAt: toDate(d?.releasedDate ?? p.releasedDate),
        internalJobId: p.refNumber ?? null,
        descriptionHtml: sections,
      };
    });
}

async function srList(ref: AdapterRef, q: string, opts?: FetchOptions): Promise<AdapterList> {
  assertSafe(ref.board);
  const query = q ? `&q=${encodeURIComponent(q.slice(0, 200))}` : "";
  const raw = await getJson<SrList>(`${SR_API}/${encodeURIComponent(ref.board)}/postings?limit=${SEARCH_LIMIT * 5}&offset=0${query}`, opts);
  return { jobs: normalizeSmartRecruiters(raw, ref), total: raw.totalFound ?? null };
}

async function srJob(ref: AdapterRef, jobId: string, opts?: FetchOptions): Promise<AdapterJob | null> {
  assertSafe(ref.board);
  if (!/^\d{1,20}$/.test(jobId)) return null;
  try {
    const d = await getJson<SrDetail>(`${SR_API}/${encodeURIComponent(ref.board)}/postings/${jobId}`, opts);
    return normalizeSmartRecruiters({ content: [d], details: { [d.id]: d } }, ref)[0] ?? null;
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "not_found") return null;
    throw error;
  }
}

// ---- Workable ---------------------------------------------------------------------

type WorkableJob = { shortcode: string; title: string; city?: string; state?: string; country?: string; url?: string; published_on?: string; description?: string };
export type WorkableRaw = { jobs?: WorkableJob[] };

export function normalizeWorkable(raw: WorkableRaw, ref: AdapterRef): AdapterJob[] {
  return (raw.jobs ?? [])
    .filter((j) => /^[A-Za-z0-9]{4,20}$/.test(j.shortcode))
    .map((j) => ({
      externalId: j.shortcode.toLowerCase(),
      title: j.title.trim(),
      location: [j.city, j.country].filter(Boolean).join(", ") || null,
      url: `https://apply.workable.com/${encodeURIComponent(ref.board)}/j/${j.shortcode}`,
      postedAt: toDate(j.published_on),
      internalJobId: null,
      descriptionHtml: j.description ?? null,
    }));
}

const workableUrl = (ref: AdapterRef) => {
  assertSafe(ref.board);
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(ref.board.toLowerCase())}?details=true`;
};

// ---- Recruitee --------------------------------------------------------------------

type RecruiteeOffer = { slug: string; title: string; location?: string; careers_url?: string; published_at?: string; description?: string; requirements?: string; status?: string; id?: number };
export type RecruiteeRaw = { offers?: RecruiteeOffer[] };

export function normalizeRecruitee(raw: RecruiteeRaw, ref: AdapterRef): AdapterJob[] {
  return (raw.offers ?? [])
    .filter((o) => /^[a-z0-9][a-z0-9-]{0,199}$/.test(o.slug) && (o.status ?? "published") === "published")
    .map((o) => ({
      externalId: o.slug,
      title: o.title.trim(),
      location: o.location?.trim() || null,
      url: `https://${ref.board.toLowerCase()}.recruitee.com/o/${o.slug}`,
      postedAt: toDate(o.published_at),
      internalJobId: o.id !== undefined ? String(o.id) : null,
      descriptionHtml: [o.description, o.requirements].filter(Boolean).join("\n") || null,
    }));
}

const recruiteeUrl = (ref: AdapterRef) => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(ref.board)) throw new UpstreamError("not_found");
  return `https://${ref.board.toLowerCase()}.recruitee.com/api/offers/`;
};

// ---- amazon.jobs --------------------------------------------------------------------

type AmazonJob = { id_icims: string; title: string; job_path?: string; posted_date?: string; normalized_location?: string; location?: string; description?: string; basic_qualifications?: string; preferred_qualifications?: string };
export type AmazonRaw = { hits?: number; jobs?: AmazonJob[] };

export function normalizeAmazon(raw: AmazonRaw): AdapterJob[] {
  return (raw.jobs ?? [])
    .filter((j) => /^\d{5,12}$/.test(j.id_icims))
    .map((j) => ({
      externalId: j.id_icims,
      title: j.title.trim(),
      location: (j.normalized_location ?? j.location)?.trim() || null,
      url: `https://www.amazon.jobs/en/jobs/${j.id_icims}`,
      postedAt: toDate(j.posted_date?.replace(/\s+/g, " ")),
      internalJobId: null,
      descriptionHtml: [j.description, j.basic_qualifications, j.preferred_qualifications].filter(Boolean).join("<br/>") || null,
    }));
}

const amazonSearch = (q: string, limit: number) =>
  `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q.slice(0, 200))}&result_limit=${limit}&offset=0`;

// ---- Dispatch ---------------------------------------------------------------------------

/** Newest jobs (search systems) or the whole board (Workable, Recruitee). */
export async function adapterList(ref: AdapterRef, opts?: FetchOptions): Promise<AdapterList> {
  switch (ref.ats) {
    case "WORKDAY":
      return workdayList(ref, "", opts);
    case "SMARTRECRUITERS":
      return srList(ref, "", opts);
    case "WORKABLE": {
      const jobs = normalizeWorkable(await getJson<WorkableRaw>(workableUrl(ref), opts), ref);
      return { jobs, total: jobs.length };
    }
    case "RECRUITEE": {
      const jobs = normalizeRecruitee(await getJson<RecruiteeRaw>(recruiteeUrl(ref), opts), ref);
      return { jobs, total: jobs.length };
    }
    case "AMAZON": {
      const raw = await getJson<AmazonRaw>(amazonSearch("", SEARCH_LIMIT), opts);
      return { jobs: normalizeAmazon(raw), total: raw.hits ?? null };
    }
    default:
      throw new Error(`no adapter for ${ref.ats}`);
  }
}

/** Jobs matching a role title, using the system's own search. */
export async function adapterSearch(ref: AdapterRef, text: string, opts?: FetchOptions): Promise<AdapterJob[]> {
  switch (ref.ats) {
    case "WORKDAY":
      return (await workdayList(ref, text, opts)).jobs;
    case "SMARTRECRUITERS":
      return (await srList(ref, text, opts)).jobs;
    case "AMAZON":
      return normalizeAmazon(await getJson<AmazonRaw>(amazonSearch(text, SEARCH_LIMIT), opts));
    default:
      return (await adapterList(ref, opts)).jobs;
  }
}

/** One job with its description and date, or null when it isn't there. */
export async function adapterJob(ref: AdapterRef, jobId: string, opts?: FetchOptions): Promise<AdapterJob | null> {
  const id = jobId.toLowerCase();
  switch (ref.ats) {
    case "WORKDAY":
      return workdayJob(ref, id, opts);
    case "SMARTRECRUITERS":
      return srJob(ref, id, opts);
    case "AMAZON": {
      if (!/^\d{5,12}$/.test(id)) return null;
      const hit = normalizeAmazon(await getJson<AmazonRaw>(amazonSearch(id, 5), opts)).find((j) => j.externalId === id);
      if (hit) return hit;
      // The search is undocumented, so a miss alone never counts: the job's own page must answer 404 too.
      // A live job answers 302 (to its slug URL); anything but 404 means "couldn't verify".
      const status = await headStatus(`https://www.amazon.jobs/en/jobs/${id}`, opts);
      if (status === 404) return null;
      throw new UpstreamError("bad_status", status);
    }
    default:
      return (await adapterList(ref, opts)).jobs.find((j) => j.externalId === id) ?? null;
  }
}

/** Whether the board itself exists (so a missing job means "gone", not "wrong board"). */
export async function adapterExists(ref: AdapterRef, opts?: FetchOptions): Promise<boolean> {
  try {
    switch (ref.ats) {
      case "WORKDAY":
        return ((await workdayList(ref, "", opts)).total ?? 0) > 0;
      case "SMARTRECRUITERS":
        // An unknown company and a disabled feed both answer 200 with nothing: treat as unknown.
        return ((await srList(ref, "", opts)).total ?? 0) > 0;
      case "AMAZON":
        return true;
      default:
        await adapterList(ref, opts);
        return true;
    }
  } catch (error) {
    if (error instanceof UpstreamError && (error.kind === "not_found" || (error.kind === "bad_status" && error.status === 422))) return false;
    throw error;
  }
}
