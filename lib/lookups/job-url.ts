// Job-URL parsing (spec "Job-URL parsing"). Pure: the server never fetches a pasted URL.
// Outbound API URLs are built only from the constants below plus encodeURIComponent values.

export type BoardAts = "GREENHOUSE" | "LEVER" | "ASHBY" | "WORKDAY" | "SMARTRECRUITERS" | "WORKABLE" | "RECRUITEE" | "AMAZON";

/** Systems too large to download whole: jobs are found with the system's own search (phase 10). */
export const SEARCH_ATS: ReadonlySet<BoardAts> = new Set(["WORKDAY", "SMARTRECRUITERS", "AMAZON"]);
export type LeverRegion = "us" | "eu";

export type ParsedJobUrl =
  | {
      kind: "board";
      ats: BoardAts;
      board: string;
      jobId: string;
      region?: LeverRegion;
      /** Workday only: the career-site host. */
      host?: string;
      /** Workday only: the job's own path ("/job/…_JR123"), so a missing job can be confirmed by a 404. */
      jobPath?: string;
    }
  /** A company-site link like stripe.com/jobs/search?gh_jid=123: resolve the board via the Company table. */
  | { kind: "gh_jid"; hostname: string; jobId: string };

export type JobUrlError = { error: "invalid_url" | "unsupported_url"; message: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SLUG = "[A-Za-z0-9][A-Za-z0-9._-]{0,99}";

// Exact hostnames only. Anchored path patterns; optional trailing apply/application pages.
const GREENHOUSE_PATH = new RegExp(`^/(${SLUG})/jobs/(\\d{1,20})/?$`);
const LEVER_PATH = new RegExp(`^/(${SLUG})/(${UUID})(?:/apply)?/?$`, "i");
const ASHBY_PATH = new RegExp(`^/(${SLUG})/(${UUID})(?:/application)?/?$`, "i");

const HOSTS: Record<string, (path: string) => ParsedJobUrl | null> = {
  "boards.greenhouse.io": (p) => greenhouse(p),
  "job-boards.greenhouse.io": (p) => greenhouse(p),
  "jobs.lever.co": (p) => lever(p, "us"),
  "jobs.eu.lever.co": (p) => lever(p, "eu"),
  "jobs.ashbyhq.com": (p) => {
    const m = ASHBY_PATH.exec(p);
    return m ? { kind: "board", ats: "ASHBY", board: m[1], jobId: m[2].toLowerCase() } : null;
  },
};

// Phase 10 systems. Workday and Recruitee use per-company hostnames, so they are matched by pattern.
/** acme.wd5.myworkdayjobs.com: tenant and data-centre number come from the real careers URL. */
export const WORKDAY_HOST = /^([a-z0-9][a-z0-9-]{0,62})\.(wd\d{1,3})\.myworkday(?:jobs|site)\.com$/;
const WORKDAY_PATH = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?([A-Za-z0-9_-]{1,100})(\/job\/(?:[^/]{1,200}\/)?[^/]{1,300}_([A-Za-z0-9-]{1,40}))(?:\/apply(?:\/[^/]*)?)?\/?$/;
/** The characters Workday uses in job paths; anything else (or "..") keeps the path out of requests. */
export const WORKDAY_JOB_PATH = /^\/job\/[A-Za-z0-9._~%/-]{1,500}$/;
const SMARTRECRUITERS_PATH = /^\/([A-Za-z0-9_-]{1,100})\/(\d{6,20})(?:-[^/]{0,200})?\/?$/;
const WORKABLE_PATH = /^\/([a-z0-9][a-z0-9-]{0,99})\/j\/([A-Za-z0-9]{6,12})(?:\/apply)?\/?$/i;
const RECRUITEE_HOST = /^([a-z0-9][a-z0-9-]{0,62})\.recruitee\.com$/;
const RECRUITEE_PATH = /^\/o\/([a-z0-9][a-z0-9-]{0,199})(?:\/c\/new)?\/?$/;
const AMAZON_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/(\d{5,12})(?:\/[^/]{0,300})?\/?$/;

HOSTS["jobs.smartrecruiters.com"] = (p) => {
  const m = SMARTRECRUITERS_PATH.exec(p);
  // SmartRecruiters company identifiers are case-sensitive.
  return m ? { kind: "board", ats: "SMARTRECRUITERS", board: m[1], jobId: m[2] } : null;
};
HOSTS["apply.workable.com"] = (p) => {
  const m = WORKABLE_PATH.exec(p);
  return m ? { kind: "board", ats: "WORKABLE", board: m[1].toLowerCase(), jobId: m[2].toLowerCase() } : null;
};
HOSTS["www.amazon.jobs"] = (p) => {
  const m = AMAZON_PATH.exec(p);
  return m ? { kind: "board", ats: "AMAZON", board: "amazon", jobId: m[1] } : null;
};
HOSTS["amazon.jobs"] = HOSTS["www.amazon.jobs"];

/** Pattern-matched hosts (one hostname per company). */
function patternHost(host: string, path: string): ParsedJobUrl | null | undefined {
  const wd = WORKDAY_HOST.exec(host);
  if (wd) {
    const m = WORKDAY_PATH.exec(path);
    if (!m) return null;
    const jobPath = WORKDAY_JOB_PATH.test(m[2]) && !m[2].includes("..") ? m[2] : undefined;
    return { kind: "board", ats: "WORKDAY", board: `${wd[1]}/${m[1]}`, host, jobId: m[3].toLowerCase(), ...(jobPath ? { jobPath } : {}) };
  }
  const rc = RECRUITEE_HOST.exec(host);
  if (rc) {
    const m = RECRUITEE_PATH.exec(path);
    return m ? { kind: "board", ats: "RECRUITEE", board: rc[1], jobId: m[1] } : null;
  }
  return undefined; // not one of these hosts
}

/** Names of supported systems recognised by hostname, for "that link isn't a single job" messages. */
function supportedName(host: string): string | null {
  if (WORKDAY_HOST.test(host)) return "Workday";
  if (RECRUITEE_HOST.test(host)) return "Recruitee";
  return { "jobs.smartrecruiters.com": "SmartRecruiters", "apply.workable.com": "Workable", "www.amazon.jobs": "amazon.jobs", "amazon.jobs": "amazon.jobs" }[host] ?? null;
}

function greenhouse(path: string): ParsedJobUrl | null {
  const m = GREENHOUSE_PATH.exec(path);
  return m ? { kind: "board", ats: "GREENHOUSE", board: m[1].toLowerCase(), jobId: m[2] } : null;
}

function lever(path: string, region: LeverRegion): ParsedJobUrl | null {
  const m = LEVER_PATH.exec(path);
  // Lever site slugs are case-sensitive: keep the case as pasted.
  return m ? { kind: "board", ats: "LEVER", board: m[1], jobId: m[2].toLowerCase(), region } : null;
}

const UNSUPPORTED: JobUrlError = {
  error: "unsupported_url",
  message: "Paste a job link from Greenhouse, Lever or Ashby, or search by company and role.",
};

const unsupported = (message: string): JobUrlError => ({ error: "unsupported_url", message });

const ATS_NAME: Record<string, string> = {
  "boards.greenhouse.io": "Greenhouse",
  "job-boards.greenhouse.io": "Greenhouse",
  "jobs.lever.co": "Lever",
  "jobs.eu.lever.co": "Lever",
  "jobs.ashbyhq.com": "Ashby",
};

// Sites that list other companies' jobs: the posting has to be checked on the employer's own board.
const JOB_SITES: [RegExp, string][] = [
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)indeed\.[a-z.]+$/, "Indeed"],
  [/(^|\.)glassdoor\.[a-z.]+$/, "Glassdoor"],
  [/(^|\.)ziprecruiter\.[a-z.]+$/, "ZipRecruiter"],
  [/(^|\.)monster\.[a-z.]+$/, "Monster"],
  [/(^|\.)simplyhired\.[a-z.]+$/, "SimplyHired"],
  [/(^|\.)(wellfound\.com|angel\.co)$/, "Wellfound"],
  [/(^|\.)joinhandshake\.com$/, "Handshake"],
];

// Applicant tracking systems we can't read yet.
const OTHER_ATS: [RegExp, string][] = [
  [/(^|\.)icims\.com$/, "iCIMS"],
  [/(^|\.)taleo\.net$/, "Taleo"],
  [/(^|\.)jobvite\.com$/, "Jobvite"],
  [/(^|\.)bamboohr\.com$/, "BambooHR"],
  [/(^|\.)successfactors\.(com|eu)$/, "SuccessFactors"],
  [/(^|\.)rippling\.com$/, "Rippling"],
  [/(^|\.)breezy\.hr$/, "Breezy"],
  [/(^|\.)applytojob\.com$/, "JazzHR"],
  [/(^|\.)teamtailor\.com$/, "Teamtailor"],
];

export type HostClass = { kind: "ats" | "job_site" | "other_ats" | "unknown"; name: string | null };

/** What kind of site a hostname is (pure, safe in the browser). Used to offer "paste the posting text instead". */
export function classifyHost(hostname: string): HostClass {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (ATS_NAME[host]) return { kind: "ats", name: ATS_NAME[host] };
  const supported = supportedName(host);
  if (supported) return { kind: "ats", name: supported };
  const site = JOB_SITES.find(([re]) => re.test(host));
  if (site) return { kind: "job_site", name: site[1] };
  const other = OTHER_ATS.find(([re]) => re.test(host));
  if (other) return { kind: "other_ats", name: other[1] };
  return { kind: "unknown", name: null };
}

const BOARD_ONLY = new RegExp(`^/(${SLUG})(?:/jobs)?/?$`);

/**
 * Why a link can't be checked, in words that say what to do next. Decided from
 * the URL text alone; the server never fetches a pasted URL.
 */
function explain(url: URL, host: string): JobUrlError {
  const system = supportedName(host);
  if (system) return unsupported(`That ${system} link doesn't point to a single job. Open the job itself and paste its link.`);
  const ats = ATS_NAME[host];
  if (ats) {
    const board = BOARD_ONLY.exec(url.pathname)?.[1];
    if (board) {
      return unsupported(
        `That's the whole ${board} job board on ${ats}, not one job. Open a job there and paste its link, or search by company and role.`,
      );
    }
    return unsupported(`That ${ats} link doesn't point to a single job. Open the job itself and paste its link.`);
  }
  const site = JOB_SITES.find(([re]) => re.test(host))?.[1];
  if (site) {
    return unsupported(
      `${site} links can't be checked: JobSeance reads the employer's own job board. Open the job on the company's careers site (the Apply button usually leads there) and paste that link.`,
    );
  }
  const other = OTHER_ATS.find(([re]) => re.test(host))?.[1];
  if (other) {
    return unsupported(
      `${other} job boards aren't supported yet; we can check Greenhouse, Lever and Ashby postings. You can still check a recruiter's message on the Recruiter message tab.`,
    );
  }
  return unsupported(
    `We can't read jobs on ${host}. JobSeance checks postings on Greenhouse, Lever and Ashby boards; if the company's Apply button leads to one of those, paste that link.`,
  );
}

/** Greenhouse's embedded application form names its board and job: /embed/job_app?for={board}&token={id}. */
function greenhouseEmbed(url: URL): ParsedJobUrl | null {
  if (!/^\/embed\/job_app\/?$/.test(url.pathname)) return null;
  const board = url.searchParams.get("for") ?? "";
  const jobId = url.searchParams.get("token") ?? "";
  if (!new RegExp(`^${SLUG}$`).test(board) || !/^\d{1,20}$/.test(jobId)) return null;
  return { kind: "board", ats: "GREENHOUSE", board: board.toLowerCase(), jobId };
}

export function parseJobUrl(input: string): ParsedJobUrl | JobUrlError {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: "invalid_url", message: "That doesn't look like a web address." };
  }
  // Compare the real hostname: z.url() accepts https://boards.greenhouse.io@evil.com/x (host: evil.com).
  // Links with credentials or a port get the plain message: they're tricks, not mistakes to explain.
  if (url.username || url.password || url.port) return UNSUPPORTED;
  if (url.protocol === "http:") return unsupported("Use the secure link: it starts with https://.");
  if (url.protocol !== "https:") return UNSUPPORTED;
  const host = url.hostname.toLowerCase();

  const patterned = patternHost(host, url.pathname);
  if (patterned) return patterned;
  if (patterned === null) return explain(url, host);

  const parse = HOSTS[host];
  if (parse) {
    const embed = host.endsWith("greenhouse.io") ? greenhouseEmbed(url) : null;
    return parse(url.pathname) ?? embed ?? explain(url, host);
  }

  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d{1,20}$/.test(ghJid)) return { kind: "gh_jid", hostname: host, jobId: ghJid };
  return explain(url, host);
}

/** Public job page for a posting on the three original boards (for links in results). */
export function jobPageUrl(ats: "GREENHOUSE" | "LEVER" | "ASHBY", board: string, jobId: string, region: LeverRegion = "us"): string {
  const b = encodeURIComponent(board);
  const id = encodeURIComponent(jobId);
  if (ats === "GREENHOUSE") return `https://job-boards.greenhouse.io/${b}/jobs/${id}`;
  if (ats === "LEVER") return `https://${region === "eu" ? "jobs.eu.lever.co" : "jobs.lever.co"}/${b}/${id}`;
  return `https://jobs.ashbyhq.com/${b}/${id}`;
}
