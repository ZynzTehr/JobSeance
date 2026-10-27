// Shared facts for the privacy notice (/privacy) and terms (/terms). Plain
// constants only: imported by server components, so no hooks here.
// Retention numbers must match lib/cleanup.ts (RETENTION) and lib/lookups/*.

export const EFFECTIVE_DATE = "October 27, 2026";
export const EFFECTIVE_DATE_ISO = "2026-10-27";

export const SITE_NAME = "JobSeance";
export const SITE_URL = "https://job-seance.vercel.app";

/** No email address is published: every request goes through Report a problem. */
export const CONTACT_HREF = "/report-a-problem?type=SITE";
export const REPORT_PROBLEM_HREF = "/report-a-problem";
export const PRIVACY_REASON_LABEL = "Privacy or data request";

export const MIN_AGE = 18;

export const RETENTION_DAYS = {
  checks: 30, // unsaved checks, from createdAt (lib/cleanup.ts)
  excerpt: 90, // ScamReport.redactedExcerpt, from the report's createdAt
  resolvedFlags: 90, // UPHELD or REJECTED flags, from resolvedAt
  domainCache: 7, // DomainLookup (lib/lookups/domains.ts DOMAIN_TTL_MS)
  aiUsage: 90, // AiUsage / AiUserUsage daily counters (numbers only)
  discoveryFound: 30, // BoardDiscovery rows for a board found (lib/lookups/discovery.ts FOUND_DAYS)
  discoveryNotFound: 7, // BoardDiscovery rows after a search found nothing (NOT_FOUND_DAYS)
} as const;

/** Job-board postings are refreshed at most once an hour (lib/lookups/postings.ts POSTINGS_TTL_MS). */
export const POSTINGS_REFRESH_HOURS = 1;

/** Session cookie lifetime (lib/auth/session.ts TOKEN_TTL_SEC) and the OAuth state cookie (lib/auth/pages.ts). */
export const SESSION_HOURS = 24;
export const OAUTH_COOKIE_MINUTES = 10;

/** Outbound user agent for job boards, RDAP and DNS (lib/lookups/fetch.ts). */
export const OUTBOUND_USER_AGENT = "JobSeance/0.1";

export type Processor = {
  name: string;
  role: string;
  receives: string;
  when: string;
};

/** Every outside service that receives data, and exactly what it receives. */
export const PROCESSORS: Processor[] = [
  {
    name: "Neon",
    role: "Postgres database, hosted on AWS in us-west-2 (Oregon, USA)",
    receives:
      "Everything we store, as listed above: accounts, linked sign-ins, application reports, scam reports, saved and recent checks, problem reports, and cached job-board and domain facts.",
    when: "Always",
  },
  {
    name: "Vercel",
    role: "Hosting and the daily cleanup job",
    receives:
      "Every request to the site, including your IP address, the page or API path, the time and your browser's user agent, which Vercel keeps in its request logs. Our own server code runs on Vercel, so it also handles what you send us.",
    when: "Always",
  },
  {
    name: "Google",
    role: "Sign in with Google",
    receives:
      "The fact that you are signing in to JobSeance. Google sends us your Google account ID, email address, whether Google has verified it, and your name.",
    when: "Only if you choose to sign in with Google",
  },
  {
    name: "GitHub",
    role: "Sign in with GitHub",
    receives:
      "The fact that you are signing in to JobSeance. GitHub sends us your GitHub account ID, your verified primary email address, and your name or username.",
    when: "Only if you choose to sign in with GitHub",
  },
  {
    name: "Anthropic (Claude API)",
    role: "AI model that reads a pasted job posting (company, role, location) or, if you opt in, a recruiter message (company it claims, contact domain, what it asks); suggests and searches for the job board of a company we don't list; searches or reads a job page on a careers site we allowlisted. It never computes a score.",
    receives:
      "On the Pasted posting tab when you don't type the company and role yourself, and on the Recruiter message tab only if you tick \"Let Claude read this message\": the text you pasted, after our server masks email addresses, phone numbers, SSN-like and other long numbers, and links. Names in the text are not masked. For a company we don't list: only the company name and role title, searched on public job-board sites (Anthropic's web search). For a company we list whose careers site we allowlisted: the role title, searched on that site, or a job link you paste on that site, without its query string, so Anthropic's fetch tool can read the page. Never your IP address, your account, the link you copied a posting from, or the email headers you paste. Anthropic states that it does not use API data to train its models.",
    when: "Only for those checks, while AI is on and under its daily limits (at most 5 web searches or page reads per account per day)",
  },
  {
    name: "Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee and amazon.jobs",
    role: "Employers' public job boards and hiring systems we read to check a posting",
    receives:
      "Only the company's identifier on that system (its board token, or for Workday its career-site address) and, for a single job, the job ID. On Workday, SmartRecruiters and amazon.jobs, also the role title, to search for it. Never anything about you.",
    when: "When a check needs that company's board and our copy is more than an hour old",
  },
  {
    name: "RDAP registries",
    role: "Domain registration dates (for example Verisign for .com), found through IANA's public registry list",
    receives: "Only the sender's domain, such as example.com. Never the full email address or the message.",
    when: "When a check includes a sender address and that domain wasn't looked up in the last 7 days",
  },
  {
    name: "DNS resolver (Google Public DNS, dns.google)",
    role: "Checks whether a sender's domain accepts email and, if you paste email headers, whether it publishes a DMARC policy",
    receives: "Only domain names: the sender's domain, and the From domain of headers you paste. Never the full email address, the headers or the message.",
    when: "Same as RDAP",
  },
];
