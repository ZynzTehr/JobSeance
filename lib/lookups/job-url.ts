// Job-URL parsing (spec "Job-URL parsing"). Pure: the server never fetches a pasted URL.
// Outbound API URLs are built only from the constants below plus encodeURIComponent values.

export type BoardAts = "GREENHOUSE" | "LEVER" | "ASHBY";
export type LeverRegion = "us" | "eu";

export type ParsedJobUrl =
  | { kind: "board"; ats: BoardAts; board: string; jobId: string; region?: LeverRegion }
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
  [/(^|\.)(myworkdayjobs\.com|myworkdaysite\.com|workday\.com)$/, "Workday"],
  [/(^|\.)icims\.com$/, "iCIMS"],
  [/(^|\.)smartrecruiters\.com$/, "SmartRecruiters"],
  [/(^|\.)taleo\.net$/, "Taleo"],
  [/(^|\.)jobvite\.com$/, "Jobvite"],
  [/(^|\.)bamboohr\.com$/, "BambooHR"],
  [/(^|\.)workable\.com$/, "Workable"],
  [/(^|\.)successfactors\.(com|eu)$/, "SuccessFactors"],
  [/(^|\.)rippling\.com$/, "Rippling"],
  [/(^|\.)recruitee\.com$/, "Recruitee"],
  [/(^|\.)breezy\.hr$/, "Breezy"],
  [/(^|\.)applytojob\.com$/, "JazzHR"],
  [/(^|\.)teamtailor\.com$/, "Teamtailor"],
];

const BOARD_ONLY = new RegExp(`^/(${SLUG})(?:/jobs)?/?$`);

/**
 * Why a link can't be checked, in words that say what to do next. Decided from
 * the URL text alone; the server never fetches a pasted URL.
 */
function explain(url: URL, host: string): JobUrlError {
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

  const parse = HOSTS[host];
  if (parse) {
    const embed = host.endsWith("greenhouse.io") ? greenhouseEmbed(url) : null;
    return parse(url.pathname) ?? embed ?? explain(url, host);
  }

  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d{1,20}$/.test(ghJid)) return { kind: "gh_jid", hostname: host, jobId: ghJid };
  return explain(url, host);
}

/** Public job page for a posting (for links in results). */
export function jobPageUrl(ats: BoardAts, board: string, jobId: string, region: LeverRegion = "us"): string {
  const b = encodeURIComponent(board);
  const id = encodeURIComponent(jobId);
  if (ats === "GREENHOUSE") return `https://job-boards.greenhouse.io/${b}/jobs/${id}`;
  if (ats === "LEVER") return `https://${region === "eu" ? "jobs.eu.lever.co" : "jobs.lever.co"}/${b}/${id}`;
  return `https://jobs.ashbyhq.com/${b}/${id}`;
}
