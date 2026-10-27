import { BANDS, DOMAIN_NEW, EVERGREEN_PHRASES, GHOST, NO_VACANCY_PHRASES, REPORTED, SCAM_CITES, SCAM_POINTS, type ScamRuleId } from "@/lib/scoring/config";

// Human-readable descriptions of every signal, shared by the result card and
// /methodology. Points come from the versioned config so the page can't drift.

export type SignalInfo = { name: string; points: string; when: string; source: string; url?: string };

const ONTARIO = "https://www.ontario.ca/document/your-guide-employment-standards-act-0/recent-changes";
const NG_2024 = "https://arxiv.org/abs/2410.21771v1";
const age = GHOST.age.map((a) => a.points);
const days = GHOST.age.map((a) => a.maxDays);
const quoted = (phrases: { label: string }[]) => phrases.map((x) => `"${x.label}"`).join(", ");

export const GHOST_SIGNALS: Record<string, SignalInfo> = {
  "G-BOARD": {
    name: "On the employer's own job board",
    points: `+${GHOST.notOnBoard}`,
    when: "The company's job board is known and this job ID isn't on it. A live listing scores 0. On systems we can only search (Workday, SmartRecruiters, amazon.jobs), a role that doesn't turn up in the search shows \"couldn't verify\", never \"not found\".",
    source: "The employer's own hiring system (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee or amazon.jobs), checked live",
  },
  "G-AGE": {
    name: "How long it's been listed",
    points: `0 / +${age[1]} / +${age[2]} / +${age[3]}`,
    when: `Listed ${days[0]} days or less / ${days[0] + 1}–${days[1]} / ${days[1] + 1}–${days[2]} / over ${days[2]} days, from the board's own first-published date (Workday: the posting's start date; amazon.jobs: its posted date), never LinkedIn's "posted" date, which resets on repost.`,
    source: "The employer's own hiring system",
  },
  "G-EVERGREEN": {
    name: "Pipeline wording",
    points: `+${GHOST.evergreen}`,
    when: `The posting says ${quoted(EVERGREEN_PHRASES)}, or it's a Greenhouse post with no internal job ID.`,
    source: "Researchers count pipeline postings as ghost jobs (Ng 2024)",
    url: NG_2024,
  },
  "G-NO-VACANCY": {
    name: "Says there's no current vacancy",
    points: `+${GHOST.noVacancy} (replaces pipeline wording)`,
    when: `The posting says ${quoted(NO_VACANCY_PHRASES)}.`,
    source: "Ontario's 2026 job-posting disclosure rules",
    url: ONTARIO,
  },
  "G-COMMUNITY": {
    name: "JobSeance users' outcomes",
    points: `${GHOST.community.hiredPenalty} to +${GHOST.community.max}`,
    when: `Needs ${GHOST.community.minReporters}+ distinct users in the last ${GHOST.community.windowDays} days. "Ghosted" means no response ${GHOST.community.ghostedAfterDays}+ days after applying or the last interview; interview-stage reports count double. Any Offer or Hired report subtracts ${-GHOST.community.hiredPenalty}.`,
    source: "Users' own reports (not verified); Ontario's 45-day rule defines \"ghosted\"",
    url: ONTARIO,
  },
};

const SCAM_TEXT: Record<ScamRuleId, Omit<SignalInfo, "points" | "url">> = {
  "S-PAY-TO-WORK": { name: "Asks you to pay to start", when: `"Starter kit", "training fee", "registration fee", "buy equipment from our vendor".`, source: "FTC: Job scams" },
  "S-FAKE-CHECK": { name: "Fake-check pattern", when: `"Deposit the check", "mobile deposit", "send the remaining", "overpayment".`, source: "FTC: Job scams" },
  "S-DISPOSABLE": { name: "Disposable email address", when: "The sender's domain is on the disposable-email list.", source: "Open disposable-domain lists" },
  "S-LOOKALIKE": { name: "Lookalike domain", when: "The sender's domain is 1–2 letters off an official one, brand + careers/hr/jobs, or punycode.", source: "FBI IC3 PSA, 2022" },
  "S-DOMAIN-NEW": { name: "Newly registered domain", when: `Registered under ${DOMAIN_NEW.newDays} days ago (+${SCAM_POINTS["S-DOMAIN-NEW"]}) or ${DOMAIN_NEW.newDays}–${DOMAIN_NEW.youngDays} days ago (+${DOMAIN_NEW.youngPoints}), from RDAP.`, source: "FBI IC3 PSA, 2020" },
  "S-TASK-SCAM": { name: "Task-scam wording", when: `"Product boosting", paid ratings or likes, "level up", commission per task.`, source: "FTC: Task scams, Aug 2025" },
  "S-PII-EARLY": { name: "Asks for sensitive details early", when: "SSN, driver's license, bank or card details before any interview.", source: "FTC, Jul 2025" },
  "S-RESHIP": { name: "Reshipping or laptop farm", when: `"Reship", "forward packages", "receive laptops", "interview on behalf of".`, source: "FBI IC3 PSA, Oct 2026" },
  "S-FREEMAIL": { name: "Free email for a named employer", when: "Gmail, Yahoo, Outlook and similar while claiming to be a named company.", source: "FTC, Aug 2023" },
  "S-PAYMENT-METHOD": { name: "Untraceable payment method", when: "Gift cards, Bitcoin, USDT, crypto wallets, Zelle, Cash App, wire transfer.", source: "FTC Data Spotlight, Dec 2024" },
  "S-DEAD-DOMAIN": { name: "Domain can't receive mail", when: "The sender's domain doesn't exist or refuses all mail (null MX).", source: "RFC 7505" },
  "S-RUN-CODE": { name: "Asks you to run their code", when: "Clone a repo, npm install, run the project, or .vscode/tasks.json. Real take-home tests exist; run unknown code only in a sandbox.", source: "FBI IC3 / NPA, Sep 2026" },
  "S-MISMATCH": { name: "Sender isn't the company's domain", when: "Not an official company domain and not a known applicant-tracking sender.", source: "FBI IC3 PSA, 2020" },
  "S-NOT-ON-BOARD": { name: "Not on the official board", when: "The company's board is known and this posting isn't on it.", source: "FBI IC3 PSA, 2020" },
  "S-CHAT-ONLY": { name: "Chat-app only", when: `WhatsApp, Telegram, Signal, "text me at", interview by chat only.`, source: "FTC, Apr 2026" },
  "S-REPORTED": { name: "Reported by JobSeance users", when: `1–2 distinct users reported this sender domain (+${REPORTED.fewPoints}) or ${REPORTED.manyFrom}+ (+${SCAM_POINTS["S-REPORTED"]}). Never for free-mail, ATS or official domains.`, source: "JobSeance reports" },
  "S-NO-INTERVIEW": { name: "Offer without an interview, or pressure", when: `An offer with no interview, or "respond within 24 hours".`, source: "FTC, Jul 2025" },
  "S-TOO-GOOD": { name: "Pay that's too good", when: `High pay per day or week with vague duties ("$500/day from home").`, source: "FTC: Job scams" },
  "S-AUTH-FAIL": {
    name: "Email failed authentication",
    when: "Only if you paste the email's headers: the receiving server recorded DMARC fail, or no passing SPF or DKIM for a sender domain that publishes a reject or quarantine policy. A pass is shown as a positive fact.",
    source: "RFC 7489 (DMARC)",
  },
  "S-REPLY-TO": {
    name: "Replies go to another domain",
    when: "Only if you paste the email's headers: the Reply-To domain differs from the sender's domain and isn't a known hiring platform.",
    source: "FTC: Phishing",
  },
};

export const SCAM_SIGNALS: Record<string, SignalInfo> = Object.fromEntries(
  (Object.keys(SCAM_TEXT) as ScamRuleId[]).map((id) => [
    id,
    {
      ...SCAM_TEXT[id],
      points: id === "S-DOMAIN-NEW" ? `+${SCAM_POINTS[id]} / +${DOMAIN_NEW.youngPoints}` : id === "S-REPORTED" ? `+${REPORTED.fewPoints} / +${SCAM_POINTS[id]}` : `+${SCAM_POINTS[id]}`,
      url: SCAM_CITES[id],
    },
  ]),
);

/** Facts gathered for context on pasted postings. 0 points; never part of a score. */
export const GATHERED_SIGNALS: Record<string, { name: string; when: string }> = {
  "A-READ": { name: "What we read from the text", when: "Claude read the company and role from your pasted text (or, if you opted in, suggested fields from a recruiter message), or you typed them. The values are shown on the result but never stored." },
  "A-LINK": { name: "Job link in the text", when: "The pasted text contained a job link on a system we read (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee or amazon.jobs), so we checked that exact job." },
  "A-HEADERS": { name: "Sender from pasted headers", when: "You pasted the email's headers and left the sender blank, so we used the address in the From line." },
  "A-POSTED": { name: "Posting date in the text", when: "The text says when it was posted. Job sites reset that date on repost, so it is never counted; only the board's own date is." },
  "A-LOCATE": {
    name: "Job board found for a company we don't list",
    when: "We asked the job boards we read whether this company has a board, then asked Claude for likely boards, then ran one web search limited to those job-board sites. A board counts as found only when its own company name matches. Anyone can open a board under any name, so it is never counted until an admin adds the company to our directory.",
  },
  "A-LISTING": { name: "Listing on that board", when: "The found board lists this title, with its own date and link. Shown, never counted, for the same reason." },
  "A-PRESENCE": {
    name: "Search of the company's careers site",
    when: "For a company we list that doesn't use a board we read, a web search limited to its careers site (allowlisted by an admin) looks for the title. A search result doesn't show that a job is open, so it's never counted.",
  },
  "A-PAGE": {
    name: "Job page read",
    when: "You pasted a link on a company's allowlisted careers site, so Anthropic's fetch tool read that page. Every value shown appears word for word on the page. Its date and wording are shown, not counted, until we've measured how reliable page reads are.",
  },
};

export const signalName = (id: string) => GHOST_SIGNALS[id]?.name ?? SCAM_SIGNALS[id]?.name ?? GATHERED_SIGNALS[id]?.name ?? id;

/** /methodology "How AI helps, and what it never does". */
export const AI_RULES = [
  "On the Pasted posting tab, Claude (Anthropic's AI model, claude-haiku-5-5 by default) reads the company name, role title and location from the text you paste. That is all it does.",
  "Claude never scores anything and never writes a verdict. Points come only from the signals on this page.",
  "We look what Claude read up in our own directory and on the employer's own job board. Points from the board count only when the title matches the board's title exactly, when the text contains the job's own link, or when you confirm the company and title.",
  "Names and titles in a result come from our directory and the job board, not from Claude. What Claude read is shown on the result and never stored.",
  "Email domains in the text are found with a fixed pattern, not by Claude. On pasted postings, a domain's age, look-alike check and company mismatch are shown for information and not counted yet.",
  "On the Recruiter message tab, Claude reads the message only if you tick the box, and only to suggest the company it claims and the address to check. Nothing it suggests counts until you use it to check again.",
  "Before anything is sent, our server masks email addresses, phone and ID numbers and links. Names are not masked. Email headers are never sent.",
  "For a company we don't list, Claude may suggest where it posts jobs and Anthropic's web search may look on public job-board sites (Sonnet 5.5, at most 3 searches). Every suggestion is checked on the job board itself, and nothing found this way is counted.",
  "For a company we list that doesn't use a board we read, a web search can look for the title on its own careers site, and Anthropic's fetch tool can read a job link you paste there. Only sites an admin allowlisted are searched or read, and nothing from them is counted yet.",
  "If the AI step is off, over our daily limit, too slow or declines, the result says so and the step scores 0, like any failed lookup.",
] as const;

export const BAND_RANGES = [
  { band: "LOW", range: `0–${BANDS.cautionFrom - 1}` },
  { band: "CAUTION", range: `${BANDS.cautionFrom}–${BANDS.highFrom - 1}` },
  { band: "HIGH", range: `${BANDS.highFrom}+` },
] as const;
