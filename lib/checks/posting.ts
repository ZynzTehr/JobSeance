import { z } from "zod";
import { emailDomains, redactForAi, urlsIn } from "@/lib/ai/sanitize";
import type { AiTransport } from "@/lib/ai/transport";
import { AI_REASON_TEXT } from "@/lib/ai/types";
import type { PostingExtract } from "@/lib/ai/extract";
import { matchRoleOnBoard } from "@/lib/checks/title-match";
import { presenceUsedAi } from "@/lib/checks/locate";
import type { BoardRef } from "@/lib/lookups/boards";
import { parseJobUrl, withJobPath } from "@/lib/lookups/job-url";
import type { PostingFacts, PostingSummary } from "@/lib/lookups/postings";
import { bandFor, clamp, scoreGhost, type BoardStatus, type CommunityReport, type CommunitySummary, type Score, type Signal } from "@/lib/scoring/ghost";
import { scoreScam, type SenderFacts } from "@/lib/scoring/scam";
import type { Company } from "@/app/generated/prisma/client";

// The "Pasted posting" check (phase 9). AI reads lookup keys from pasted text; the
// directory and the employer's own board verify them; the versioned rubric scores.
// Rules that keep AI out of the verdict:
// - Points from the board path count only for an exact title match, a job link found
//   in the text, or a company and role the user typed or confirmed. Anything else is
//   "couldn't verify" with the closest title shown.
// - Stored facts never contain the model's words: names and titles come from our
//   directory and the board, everything else is fixed text.
// - Contact domains come from the text with a regex, never from the model.

export const postingTextSchema = z.strictObject({
  kind: z.literal("posting_text"),
  text: z.string().trim().min(1, "Paste the posting text.").max(20_000, "Keep it under 20,000 characters."),
  /** Site the text was copied from (a label like "LinkedIn", never the link itself). Display only. */
  sourceSite: z.string().trim().max(40).regex(/^[\p{L}\p{N} .&'-]*$/u, "Use the site's name only.").optional(),
  /** Typed or confirmed by the user: the deterministic path. */
  company: z.string().trim().min(1).max(100).optional(),
  role: z.string().trim().min(1).max(200).optional(),
});
export type PostingTextInput = z.infer<typeof postingTextSchema>;

/** Fact text for a role missing from a system's own search: shown, never counted. */
export const searchMissDetail = (role: string, boardName: string) =>
  `No posting titled "${role.slice(0, 80)}" turned up in a search of ${boardName}. Searches can miss a posting, so nothing counted`;

export type CompanyBoard =
  /** searched = the system's own search (Workday, SmartRecruiters, amazon.jobs), so a miss proves nothing. */
  | { kind: "board"; ref: BoardRef; boardName: string; source: string; postings: PostingSummary[]; searched?: boolean }
  | { kind: "stored"; postings: PostingFacts[] } // companies with no public board (fictional demo data)
  | { kind: "unavailable"; boardName: string; source: string };

export type PostingDeps = {
  ai: AiTransport;
  userId: string;
  now: Date;
  signal?: AbortSignal;
  /** User-typed name: slug, then name prefix (same as company_role). */
  findCompany(name: string): Promise<Company | null>;
  /** AI-read name: exact slug or exact name only. */
  findCompanyExact(name: string): Promise<Company | null>;
  /** The role is passed so search systems (Workday, SmartRecruiters, amazon.jobs) can search for it. */
  companyBoard(company: Company, role: string): Promise<CompanyBoard>;
  lookupJob(ref: BoardRef, jobId: string, company: Company | null): Promise<{ board: BoardStatus; posting: PostingFacts | null }>;
  /** An ATS job link found in the text → board + job id (+ directory company), or null. */
  resolveLink(url: string): Promise<{ ref: BoardRef; jobId: string; company: Company | null } | null>;
  community(companyId: string): Promise<CommunityReport[]>;
  sender(domain: string): Promise<SenderFacts | null>;
  /** Typed-path title match, identical to company_role (exact, then substring). */
  pickByTitle<T extends { title: string }>(items: T[], role: string): T | null;
  /** Phase 11: info rows about an employer outside the directory (never counted). */
  locate?(employer: string, role: string | null, typed: boolean): Promise<{ rows: Signal[]; ai: { used: boolean; model: string | null; mode: "live" | "replay" | null } }>;
  /** Phase 11: presence-check rows for a directory company with careers hosts and no board we read. */
  presence?(company: Company, role: string): Promise<Signal[]>;
};

export type Reading = {
  company: string | null;
  title: string | null;
  location: string | null;
  sourceSite: string | null;
  documentKind: PostingExtract["documentKind"] | null;
  isStaffingAgency: boolean;
};

export type PostingCheck = {
  ghost: Score & { community?: CommunitySummary };
  scam: Score;
  gathered: Signal[];
  posting: PostingFacts | null;
  company: Company | null;
  reading: Reading | null;
  /** textSent: Claude read the pasted text itself (not just a company name for a board search). Gates shadow mode. */
  ai: { used: boolean; model: string | null; mode: "live" | "replay" | null; suggestedKind: "message" | null; textSent?: boolean };
};

/** On pasted postings these sender rules are shown for information only until measured. */
const POSTING_INFO_ONLY = new Set(["S-DOMAIN-NEW", "S-LOOKALIKE", "S-MISMATCH"]);
const SENDER_RULES = new Set(["S-DISPOSABLE", "S-LOOKALIKE", "S-DOMAIN-NEW", "S-DEAD-DOMAIN", "S-FREEMAIL", "S-MISMATCH", "S-REPORTED"]);
const INFO_NOTE = "On pasted postings this is shown for information and not counted yet.";

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("\n\n") || null;

function demote(signals: Signal[]): Signal[] {
  return signals.map((s) => (POSTING_INFO_ONLY.has(s.id) && s.points > 0 ? { ...s, points: 0, kind: "info" as const, note: INFO_NOTE } : s));
}

function rescore(signals: Signal[]): Score {
  const score = clamp(signals.reduce((sum, s) => sum + s.points, 0), 0, 100);
  return { score, band: bandFor(score), signals };
}

export async function checkPostingText(input: PostingTextInput, deps: PostingDeps): Promise<PostingCheck> {
  const { now } = deps;
  const at = now.toISOString();
  const gathered: Signal[] = [];
  const info = (id: string, fact: string, source: string, status: Signal["status"] = "found", extra: Partial<Signal> = {}) =>
    gathered.push({ id, points: 0, status, fact, source, checkedAt: at, ...(status === "found" ? { kind: "info" as const } : {}), ...extra });

  const typed = Boolean(input.company && input.role);
  let reading: Reading | null = null;
  let aiInfo: PostingCheck["ai"] = { used: false, model: null, mode: null, suggestedKind: null };

  // 1. A job link inside the text is the strongest evidence: exact board and job id.
  let link: Awaited<ReturnType<PostingDeps["resolveLink"]>> = null;
  for (const url of urlsIn(input.text)) {
    const parsed = parseJobUrl(url);
    if ("error" in parsed) continue;
    link = await deps.resolveLink(url).catch(() => null);
    if (link) break;
  }

  // 2. Company and role: typed by the user, or read by AI from the redacted text.
  let company: Company | null = null;
  let role: string | null = null;
  let lookUp = true;
  if (typed) {
    company = await deps.findCompany(input.company!);
    role = input.role!;
    info("A-READ", "Company and role as you entered them", "you");
  } else if (!link) {
    const out = await deps.ai.extract(redactForAi(input.text), { userId: deps.userId, signal: deps.signal });
    if (!out.ok) {
      info("A-READ", `Couldn't read the company and role from the text: ${AI_REASON_TEXT[out.reason]}`, "Claude (Anthropic)", "couldnt_verify");
      lookUp = false;
    } else {
      const e = out.value;
      aiInfo = { used: true, model: out.model, mode: out.mode, suggestedKind: e.documentKind === "recruiter_message" ? "message" : null, textSent: true };
      reading = {
        company: e.employerName,
        title: e.roleTitle,
        location: e.location,
        sourceSite: input.sourceSite ?? null,
        documentKind: e.documentKind,
        isStaffingAgency: e.isStaffingAgency,
      };
      const source = `Claude (${out.model}${out.mode === "replay" ? ", saved answer" : ""}) reading your pasted text`;
      if (e.documentKind !== "job_posting") {
        const what = { recruiter_message: "a recruiter message", interview_task: "an interview task", other: "something other than a job posting" }[e.documentKind];
        info("A-READ", `This reads like ${what}, so no job board was checked. The Recruiter message tab also checks the sender.`, source, "couldnt_verify");
        reading = { ...reading, company: null, title: null, location: null }; // nothing read from a message is kept or shown
        lookUp = false;
      } else if (e.isStaffingAgency) {
        info("A-READ", "Posted by a staffing agency; the client's own board usually won't list it, so the board wasn't checked (nothing counted)", source, "couldnt_verify");
        lookUp = false;
      } else {
        info("A-READ", "Company and role read from your pasted text (shown above; not stored)", source);
        // A field the user filled in wins over Claude's reading of it; both still count only on an exact match.
        company = input.company ? await deps.findCompany(input.company) : e.employerName ? await deps.findCompanyExact(e.employerName) : null;
        role = input.role ?? e.roleTitle;
        if (e.postedAgoText) info("A-POSTED", "The text says when it was posted. Job sites reset that date on repost, so it isn't counted", source);
      }
    }
  }

  // 3. The board.
  let board: BoardStatus = { kind: "couldnt_verify", boardName: "", source: "JobSeance company list", detail: "No job board was checked for this text" };
  let posting: PostingFacts | null = null;
  let counted = false; // whether the board result may add points

  if (link) {
    company = link.company;
    ({ board, posting } = await deps.lookupJob(link.ref, link.jobId, link.company));
    counted = true;
    info("A-LINK", "Used the job-board link found in the pasted text", board.kind === "no_board" ? "JobSeance company list" : board.source);
  } else if (lookUp && !company) {
    board = {
      kind: "couldnt_verify",
      boardName: "",
      source: "JobSeance company list",
      detail: typed
        ? "We don't have that company yet, so its job board wasn't checked (nothing counted)"
        : "The company named in the text isn't in our directory, so its job board wasn't checked (nothing counted)",
    };
    const employer = input.company ?? reading?.company;
    if (employer && deps.locate) {
      const located = await deps.locate(employer, role, typed);
      gathered.push(...located.rows);
      if (located.ai.used && !aiInfo.used) aiInfo = { ...aiInfo, used: true, model: located.ai.model, mode: located.ai.mode };
    }
  } else if (lookUp && company && !role) {
    board = { kind: "couldnt_verify", boardName: "", source: "JobSeance company list", detail: "No role title found in the text, so the board wasn't searched (nothing counted)" };
  } else if (lookUp && company && role) {
    const found = await deps.companyBoard(company, role);
    if (found.kind === "unavailable") {
      board = { kind: "couldnt_verify", boardName: found.boardName, source: found.source };
    } else if (found.kind === "stored") {
      const match = typed ? deps.pickByTitle(found.postings, role) : matchRoleOnBoard(found.postings, role).exact;
      board = { kind: "no_board", companyName: company.name };
      posting = match;
      counted = Boolean(match);
      if (!match && company.careersHosts?.length && deps.presence) {
        const rows = await deps.presence(company, role);
        gathered.push(...rows);
        if (presenceUsedAi(rows)) aiInfo = { ...aiInfo, used: true };
      }
    } else {
      const { exact, closest } = matchRoleOnBoard(found.postings, role);
      const pick = typed ? deps.pickByTitle(found.postings, role) : exact;
      if (pick) {
        ({ board, posting } = await deps.lookupJob(withJobPath(found.ref, pick.url), pick.externalId, company));
        counted = true;
      } else if (typed && found.searched) {
        board = {
          kind: "couldnt_verify",
          boardName: found.boardName,
          source: found.source,
          detail: searchMissDetail(role, found.boardName),
        };
      } else if (typed) {
        board = { kind: "not_found", boardName: found.boardName, source: found.source, detail: `No posting titled "${role.slice(0, 80)}" on ${found.boardName}` };
        counted = true;
      } else {
        board = {
          kind: "couldnt_verify",
          boardName: found.boardName,
          source: found.source,
          detail: closest
            ? `Closest title on ${found.boardName}: "${closest.item.title}" (nothing counted; confirm the company and title to count it)`
            : `No similar title on ${found.boardName} (nothing counted; confirm the company and title to count it)`,
        };
      }
    }
  }

  // Without a title nothing can be matched anywhere; say how to add one rather than guess it.
  if (lookUp && !link && !role) {
    info(
      "A-TITLE",
      "No job title in the text, so no listing could be looked for. On LinkedIn the title sits above \"About the job\": add it and check again",
      "Claude reading your pasted text",
      "couldnt_verify",
    );
  }

  // 4. Score with the unchanged rubric. Community counts only on the counted path.
  const community = counted && company ? await deps.community(company.id) : [];
  const ghost = scoreGhost({
    board,
    postedAt: posting?.postedAt ?? null,
    description: join(posting?.description, input.text),
    greenhouseInternalJobId: counted && posting && link?.ref.ats === "GREENHOUSE" ? posting.internalJobId : undefined,
    community,
    now,
  });

  const claimed = counted && company ? { slug: company.slug, name: company.name, officialDomains: company.officialDomains } : null;
  const domains = emailDomains(input.text);
  const senders = (await Promise.all(domains.map((d) => deps.sender(d).catch(() => null)))).filter((s): s is SenderFacts => Boolean(s));
  const base = scoreScam({
    text: join(input.text, posting?.description),
    sender: senders[0] ?? null,
    claimed,
    namesEmployer: Boolean(claimed),
    notOnBoard: counted && board.kind === "not_found" ? { fact: board.detail, source: board.source } : null,
    now,
  });
  const extra = senders.slice(1).flatMap(
    (s) => scoreScam({ text: null, sender: s, claimed, namesEmployer: Boolean(claimed), notOnBoard: null, now }).signals.filter((sig) => SENDER_RULES.has(sig.id)),
  );
  const scam = rescore(demote([...base.signals, ...extra]));

  return { ghost, scam, gathered, posting, company, reading, ai: aiInfo };
}
