import { onHosts } from "@/lib/ai/presence";
import type { PageRead } from "@/lib/ai/read-page";
import type { SearchHit } from "@/lib/ai/locate";
import { AI_REASON_TEXT, type AiOutcome } from "@/lib/ai/types";
import { matchRoleOnBoard } from "@/lib/checks/title-match";
import type { BoardJob, BoardRef } from "@/lib/lookups/boards";
import { mentionsEmployer, type Discovery, type DiscoveryMethod } from "@/lib/lookups/discovery";
import { classifyHost, otherSystemOf, SEARCH_ATS, type BoardLink } from "@/lib/lookups/job-url";
import type { Signal } from "@/lib/scoring/ghost";
import { ATS_LABEL } from "@/lib/ui";

// Phase 11 facts for employers outside the directory, presence checks and page reads.
// All of them are 0-point "for your information" rows: anyone can open a board under a
// company's name, and a search result or a page can't show that a job is still open.
// Boards outside the directory are named, never linked: a squatted board must not get a
// clickable link from a scam checker.

const METHOD_SOURCE: Record<DiscoveryMethod, string> = {
  probe: "JobSeance's check of public job boards",
  guess: "Claude's suggestion, checked on the job board itself",
  search: "Anthropic web search via Claude, checked on the job board itself",
  cache: "An earlier search (kept up to 30 days)",
};

/** Links shown on results: https, no credentials, on a hiring system or an allowlisted careers host. */
export function safeSourceUrl(url: string | null | undefined, careersHosts: string[] = []): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return undefined;
    const ok = classifyHost(u.hostname).kind === "ats" || onHosts(u.href, careersHosts);
    return ok && u.href.length <= 2048 ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** The board's own front page, built from constants. */
export function boardFrontUrl(l: BoardLink): string | undefined {
  const b = encodeURIComponent(l.board);
  switch (l.ats) {
    case "GREENHOUSE":
      return `https://job-boards.greenhouse.io/${b}`;
    case "LEVER":
      return `https://jobs.lever.co/${b}`;
    case "ASHBY":
      return `https://jobs.ashbyhq.com/${b}`;
    case "SMARTRECRUITERS":
      return `https://jobs.smartrecruiters.com/${b}`;
    case "WORKABLE":
      return `https://apply.workable.com/${b}`;
    case "RECRUITEE":
      return /^[a-z0-9][a-z0-9-]{0,62}$/.test(l.board) ? `https://${l.board}.recruitee.com` : undefined;
    case "WORKDAY":
      return l.host ? `https://${l.host}/${encodeURIComponent(l.board.split("/")[1] ?? "")}` : undefined;
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));

export type LocateDeps = {
  now: Date;
  /** The board's jobs for a role (the system's own search on search systems). */
  jobs(ref: BoardRef, role: string): Promise<BoardJob[]>;
  /** Typed-path title match, as for directory companies. */
  pickByTitle<T extends { title: string }>(items: T[], role: string): T | null;
};

/**
 * Rows for an employer outside the directory. `roleShown` is the user's own typed title
 * (null when the title was read by AI: facts never carry the model's words).
 */
export async function locateRows(d: Discovery, role: string | null, typed: boolean, deps: LocateDeps): Promise<Signal[]> {
  const at = deps.now.toISOString();
  const rows: Signal[] = [];
  const row = (id: string, fact: string, source: string, status: Signal["status"] = "found", extra: Partial<Signal> = {}) =>
    rows.push({ id, points: 0, status, fact, source, checkedAt: at, ...(status === "found" ? { kind: "info" as const } : {}), ...extra });

  if (d.found) {
    const f = d.found;
    const label = ATS_LABEL[f.ats];
    const named = f.declaredName ? ` that calls itself "${f.declaredName}"` : "";
    row(
      "A-LOCATE",
      `Found a ${label} board ("${f.board}")${named}. It isn't in our directory, so we can't confirm it's the employer's own board, and nothing from it is counted. Apply through the employer's own website, not through this board`,
      METHOD_SOURCE[f.method],
    );
    if (role) {
      const ref: BoardRef = { ats: f.ats, board: f.board, ...(f.host ? { host: f.host } : {}) };
      const jobs = await deps.jobs(ref, role).catch(() => null);
      const source = `${label} (${f.board})`;
      if (!jobs) row("A-LISTING", "Couldn't read that board just now", source, "couldnt_verify");
      else {
        const match = typed ? deps.pickByTitle(jobs, role) : matchRoleOnBoard(jobs, role).exact;
        if (match) {
          const when = match.postedAt ? `, first published ${isoDay(match.postedAt)} (${daysBetween(match.postedAt, deps.now)} days ago)` : "";
          row("A-LISTING", `That board lists "${match.title.slice(0, 120)}"${when}. Not counted: the board isn't confirmed as the employer's`, source);
        } else {
          const how = SEARCH_ATS.has(f.ats) ? " in a search" : "";
          row("A-LISTING", `That board doesn't list a matching title${how} (not conclusive)`, source, "couldnt_verify");
        }
      }
    }
  } else if (d.unconfirmed.length) {
    for (const u of d.unconfirmed) {
      row("A-LOCATE", `A ${ATS_LABEL[u.ats]} board named "${u.board}" exists, but it doesn't state a company name, so we can't tell whose it is (nothing counted)`, METHOD_SOURCE[u.method]);
    }
  } else {
    const why =
      d.aiFailure === "limit"
        ? `: ${AI_REASON_TEXT.limit}`
        : d.aiFailure && d.aiFailure !== "off"
          ? `; the AI-assisted search didn't finish: ${AI_REASON_TEXT[d.aiFailure]}`
          : "";
    row("A-LOCATE", `We couldn't find this company's job board on the systems we read${why}`, METHOD_SOURCE.probe, "couldnt_verify");
  }
  return rows;
}

/**
 * Rows for an employer outside the directory whose jobs are on a hiring system we can't read
 * (iCIMS, Taleo, UKG and so on). The system and account come from the search engine's result
 * links, the listing title from its result titles; nothing is linked or counted, since an
 * account on a hiring system can be opened under any company's name. `employer` only decides
 * which results are about this company and never appears in a fact.
 */
/** " in Chicago, IL" before a separator or the end of a result title. */
const IN_PLACE = /\s+in\s+[^|,–—·•]{2,40},\s*[A-Z]{2}\b[^|–—·•]*?(?=\s+[-|–—·•]\s+|$)/;

export function systemRows(
  out: AiOutcome<SearchHit[]>,
  employer: string,
  role: string | null,
  typed: boolean,
  deps: Pick<LocateDeps, "now" | "pickByTitle">,
): Signal[] {
  if (!out.ok && out.reason === "off") return [];
  const at = deps.now.toISOString();
  const source = "Anthropic web search via Claude, limited to hiring-system sites";
  const rows: Signal[] = [];
  const row = (id: string, fact: string, status: Signal["status"] = "found") =>
    rows.push({ id, points: 0, status, fact, source, checkedAt: at, ...(status === "found" ? { kind: "info" as const } : {}) });

  if (!out.ok) {
    row("A-SYSTEM", `Couldn't search other hiring systems for this company: ${AI_REASON_TEXT[out.reason]}`, "couldnt_verify");
    return rows;
  }
  const ours = out.value.flatMap((h) => {
    const sys = otherSystemOf(h.url);
    return sys && mentionsEmployer(sys.account, h.title, employer) ? [{ ...h, sys }] : [];
  });
  if (!ours.length) {
    row("A-SYSTEM", "This company's jobs didn't turn up on other common hiring systems either (iCIMS, Taleo, UKG, ADP and others). Not conclusive", "couldnt_verify");
    return rows;
  }
  // The system with the most results about this employer.
  const counts = new Map<string, number>();
  for (const h of ours) counts.set(h.sys.name, (counts.get(h.sys.name) ?? 0) + 1);
  const name = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const onIt = ours.filter((h) => h.sys.name === name);
  const account = onIt.find((h) => h.sys.account)?.sys.account;
  row(
    "A-SYSTEM",
    `This company's jobs appear on ${name}${account ? ` (account "${account}")` : ""}, a hiring system we can't read yet, so we can't check whether a job there is still open. We can't confirm the account is the employer's own: apply through the employer's own website`,
  );
  if (role) {
    // Hiring-system result titles often name the place: "Developer in Chicago, IL | Careers at Acme".
    const titled = onIt.map((h) => ({ ...h, title: h.title.replace(IN_PLACE, ""), shown: h.title }));
    const match = typed ? deps.pickByTitle(titled, role) : matchRoleOnBoard(titled, role).exact;
    if (match) {
      const dated = match.pageAge ? ` (search result dated ${match.pageAge.slice(0, 40)})` : "";
      row("A-LISTING", `A listing titled "${match.shown.slice(0, 160)}" appears in a search of ${name}${dated}. A search result isn't proof the job is open, so nothing counted`);
    } else {
      row("A-LISTING", `No listing with this title turned up in a search of ${name} (not conclusive)`, "couldnt_verify");
    }
  }
  return rows;
}

const PRESENCE_FAILED = "Couldn't search ";
/** Whether presence rows came from a search that ran (for the check's "AI-assisted" flag). */
export const presenceUsedAi = (rows: Signal[]) => rows.some((r) => r.id === "A-PRESENCE" && !r.fact.startsWith(PRESENCE_FAILED));

/** Presence check rows for a directory company with careers hosts and no board we read. */
export function presenceRows(out: AiOutcome<SearchHit[]>, role: string, hosts: string[], now: Date): Signal[] {
  const at = now.toISOString();
  const where = hosts.join(", ");
  const source = `Web search of ${where} via Claude`;
  if (!out.ok) {
    return [{ id: "A-PRESENCE", points: 0, status: "couldnt_verify", fact: `${PRESENCE_FAILED}${where}: ${AI_REASON_TEXT[out.reason]}`, source, checkedAt: at }];
  }
  // Result titles carry site decoration ("Engineer - Jobs - Careers at Acme"); roleKey strips it.
  const hit = matchRoleOnBoard(out.value, role).exact;
  if (!hit) {
    return [{ id: "A-PRESENCE", points: 0, status: "couldnt_verify", fact: `No listing with this title turned up in a search of ${where} (not conclusive)`, source, checkedAt: at }];
  }
  const dated = hit.pageAge ? ` (search result dated ${hit.pageAge.slice(0, 40)})` : "";
  return [
    {
      id: "A-PRESENCE",
      points: 0,
      status: "found",
      kind: "info",
      fact: `A listing titled "${hit.title.slice(0, 160)}" appears in a search of ${where}${dated}. A search result isn't proof the job is open, so nothing counted`,
      source,
      sourceUrl: safeSourceUrl(hit.url, hosts),
      checkedAt: at,
    },
  ];
}

/** Page-read rows. Every value shown appears word for word on the fetched page. */
export function pageRows(out: AiOutcome<PageRead>, host: string, now: Date): Signal[] {
  const at = now.toISOString();
  if (!out.ok) {
    return [
      {
        id: "A-PAGE",
        points: 0,
        status: "couldnt_verify",
        fact: `Couldn't read the page on ${host}: ${AI_REASON_TEXT[out.reason]}. Pages that need JavaScript can't be read`,
        source: "Anthropic's fetch tool via Claude",
        checkedAt: at,
      },
    ];
  }
  const p = out.value;
  const source = `${host} page read by Anthropic's fetch tool${p.retrievedAt ? ` at ${p.retrievedAt.slice(0, 19).replace("T", " ")} UTC` : ""}`;
  const link = safeSourceUrl(p.url, [host]);
  const rows: Signal[] = [];
  const push = (fact: string) => rows.push({ id: "A-PAGE", points: 0, status: "found", kind: "info", fact, source, sourceUrl: link, checkedAt: at });
  if (!p.isJobPosting) push("Claude judged that this page isn't a single job opening (its judgement, not text from the page)");
  if (p.title) push(`Page title: "${p.title.slice(0, 160)}"`);
  if (p.location) push(`Location on the page: ${p.location.slice(0, 120)}`);
  if (p.postedText) push(`The page says "${p.postedText.slice(0, 80)}". Not counted until we've measured how reliable page dates are`);
  if (!rows.length) push("Read the page, but it states no title, location or date we could confirm");
  return rows;
}
