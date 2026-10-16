// Endpoint reference for /api-docs. Examples are abbreviated real responses.

export type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  access: string;
  summary: string;
  request?: string;
  response?: string;
};

export type EndpointGroup = { title: string; endpoints: Endpoint[] };

const j = (v: unknown) => JSON.stringify(v, null, 2);

export const API_GROUPS: EndpointGroup[] = [
  {
    title: "Auth",
    endpoints: [
      {
        method: "POST",
        path: "/api/auth/login",
        access: "Public · 30/min per IP, 10 per 15 min per username",
        summary: "Log in with a username and password. Returns a JWT for the Authorization header and sets the session cookie.",
        request: j({ username: "demo", password: "••••••••••••••••" }),
        response: j({ user: { id: "cm…", username: "demo", role: "ADMIN" }, token: "eyJhbGciOiJIUzI1NiIs…" }),
      },
      { method: "POST", path: "/api/auth/signup", access: "Public", summary: "Create an account with username, email and a 15–64 character password.", request: j({ username: "ada_1", email: "ada@example.com", password: "a long passphrase here" }) },
      { method: "POST", path: "/api/auth/logout", access: "Signed in", summary: "Clear the session cookie." },
      { method: "GET", path: "/api/v1/health", access: "Public", summary: "Database ping. 503 with db_unavailable if Postgres can't be reached.", response: j({ db: "ok" }) },
      { method: "GET", path: "/api/v1/me", access: "Signed in", summary: "Your account and linked providers.", response: j({ user: { username: "demo", email: "demo@…", providers: [] } }) },
      { method: "DELETE", path: "/api/v1/me", access: "Signed in", summary: "Delete your account and its reports. 204." },
      { method: "POST", path: "/api/v1/me/logout-all", access: "Signed in", summary: "Revoke every token issued so far." },
    ],
  },
  {
    title: "Scanner",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/checks",
        access: "Public · 60/min per IP",
        summary: "Check a job URL, a company + role, or a pasted message. Returns both scores, every signal with its source, the disclaimer and the checklist. Pasted text is never stored.",
        request: j({ kind: "url", url: "https://job-boards.greenhouse.io/discord/jobs/8806482002" }),
        response: j({
          id: "cm…",
          kind: "url",
          checkedAt: "2026-10-15T23:13:06.616Z",
          ghost: { score: 0, band: "LOW", signals: [{ id: "G-BOARD", points: 0, status: "found", fact: "Live on Discord's Greenhouse board", source: "boards-api.greenhouse.io", checkedAt: "…" }] },
          scam: { score: 0, band: "LOW", signals: [], warnings: 0 },
          meta: { configVersion: "2026-10-15.1", disclaimer: "…", verificationChecklist: ["…"] },
        }),
      },
      { method: "GET", path: "/api/v1/checks", access: "Signed in", summary: "Your saved checks, newest first." },
      { method: "PATCH", path: "/api/v1/checks/:id", access: "Owner", summary: "Save or unsave a check.", request: j({ saved: true }) },
      { method: "DELETE", path: "/api/v1/checks/:id", access: "Owner", summary: "Delete a check. 204." },
    ],
  },
  {
    title: "Companies and lookups",
    endpoints: [
      { method: "GET", path: "/api/v1/companies?q=&ats=", access: "Public", summary: "List companies. Never includes a ghost or scam band.", response: j({ companies: [{ slug: "discord", name: "Discord", ats: "GREENHOUSE", atsBoard: "discord", officialDomains: ["discord.com"], isFictional: false }] }) },
      { method: "GET", path: "/api/v1/companies/:slug", access: "Public", summary: "One company with its community summary.", response: j({ company: { slug: "quietwater", name: "Quietwater Logistics" }, community: { reports: 6, shown: true, byOutcome: { HIRED: 1, OFFER: 1 }, ghostedShare: 0 } }) },
      { method: "GET", path: "/api/v1/companies/:slug/postings", access: "Public", summary: "Live postings from the company's board, cached for 1 hour." },
      { method: "POST", path: "/api/v1/companies", access: "Admin", summary: "Add a company. The board token is verified against the ATS first (422 if it doesn't exist).", request: j({ name: "Acme", officialDomains: ["acme.com"], ats: "GREENHOUSE", atsBoard: "acme" }) },
      { method: "GET", path: "/api/v1/domains/:domain", access: "Public · 60/min per IP", summary: "Domain age, mail records, free-mail and lookalike flags." },
    ],
  },
  {
    title: "Outcome reports",
    endpoints: [
      { method: "GET", path: "/api/v1/reports?company=<slug>", access: "Public", summary: "Aggregate only: counts, plus a breakdown once 3+ distinct users reported. Never users, role titles, dates or notes.", response: j({ company: "bramblecloud", reports: 6, shown: true, byOutcome: { NO_RESPONSE: 5, REJECTED: 1 }, byStage: { INTERVIEWED: 5, APPLIED: 1 }, ghostedShare: 0.83 }) },
      { method: "GET", path: "/api/v1/reports/mine", access: "Signed in", summary: "Your outcome reports in full." },
      {
        method: "POST",
        path: "/api/v1/reports",
        access: "Signed in · 20/hour",
        summary: "Log an outcome. One per user per company + role (409 on a duplicate). firstHand must be true; notes can't contain emails or phone numbers.",
        request: j({ company: "quietwater", roleTitle: "Fleet Planner", appliedAt: "2026-09-01", outcome: "APPLIED", firstHand: true }),
      },
      { method: "PATCH", path: "/api/v1/reports/:id", access: "Owner", summary: "Update status or dates. Someone else's report returns 403.", request: j({ outcome: "NO_RESPONSE" }) },
      { method: "DELETE", path: "/api/v1/reports/:id", access: "Owner", summary: "Delete a report. 204." },
    ],
  },
  {
    title: "Scam reports and flags",
    endpoints: [
      { method: "GET", path: "/api/v1/scam-reports?domain=", access: "Public", summary: "How many distinct users reported a sender domain.", response: j({ domain: "bramblecloud-careers.example", reporters: 3 }) },
      { method: "POST", path: "/api/v1/scam-reports", access: "Signed in · 20/hour", summary: "Report a scam message. Stores the domain, matched rules and score; a redacted excerpt only if you opt in.", request: j({ senderEmail: "talent@bramblecloud-careers.example", channel: "EMAIL", text: "…", shareExcerpt: false }) },
      { method: "PATCH", path: "/api/v1/scam-reports/:id", access: "Owner", summary: "Edit the channel or claimed company, or remove the excerpt.", request: j({ removeExcerpt: true }) },
      { method: "DELETE", path: "/api/v1/scam-reports/:id", access: "Owner", summary: "Delete a scam report. 204." },
      { method: "POST", path: "/api/v1/flags", access: "Public · 20/hour", summary: "Report a problem with a report, check, company or the site (targetType SITE, for contact and privacy requests). Reasons: personal_info, fake, harassment, false_fact, score_wrong, privacy_request, other. A signed-in personal-info flag hides the report until reviewed.", request: j({ targetType: "COMPANY", targetId: "quietwater", reason: "false_fact", details: "…" }) },
      { method: "GET", path: "/api/v1/cron/cleanup", access: "Vercel Cron · Bearer CRON_SECRET", summary: "Daily retention cleanup: unsaved and anonymous checks after 30 days, scam-report excerpts after 90, resolved flags 90 days after resolution. 401 without the secret.", response: j({ ok: true, checksDeleted: 12, excerptsCleared: 0, flagsDeleted: 0 }) },
    ],
  },
];

export const ERROR_EXAMPLE = j({ error: { code: "validation_failed", message: "Check the highlighted fields.", fields: { firstHand: "Confirm this is your own first-hand experience." } } });
