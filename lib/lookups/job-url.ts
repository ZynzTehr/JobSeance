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

export function parseJobUrl(input: string): ParsedJobUrl | JobUrlError {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: "invalid_url", message: "That doesn't look like a web address." };
  }
  // Compare the real hostname: z.url() accepts https://boards.greenhouse.io@evil.com/x (host: evil.com).
  if (url.protocol !== "https:" || url.username || url.password || url.port) return UNSUPPORTED;
  const host = url.hostname.toLowerCase();

  const parse = HOSTS[host];
  if (parse) return parse(url.pathname) ?? UNSUPPORTED;

  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d{1,20}$/.test(ghJid)) return { kind: "gh_jid", hostname: host, jobId: ghJid };
  return UNSUPPORTED;
}

/** Public job page for a posting (for links in results). */
export function jobPageUrl(ats: BoardAts, board: string, jobId: string, region: LeverRegion = "us"): string {
  const b = encodeURIComponent(board);
  const id = encodeURIComponent(jobId);
  if (ats === "GREENHOUSE") return `https://job-boards.greenhouse.io/${b}/jobs/${id}`;
  if (ats === "LEVER") return `https://${region === "eu" ? "jobs.eu.lever.co" : "jobs.lever.co"}/${b}/${id}`;
  return `https://jobs.ashbyhq.com/${b}/${id}`;
}
