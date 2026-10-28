import { safeQuery, type SearchHit } from "@/lib/ai/locate";
import type { AiTransport } from "@/lib/ai/transport";
import type { AiFailureReason } from "@/lib/ai/types";
import { boardExists } from "@/lib/lookups/boards";
import { getJson, UpstreamError, type FetchOptions } from "@/lib/lookups/fetch";
import type { BoardLink } from "@/lib/lookups/job-url";

// Phase 11: where does an employer outside our directory post its jobs?
// 1. A saved answer (found: 30 days, not found: 7 days).
// 2. Free probes of likely identifiers on the systems we read.
// 3. Claude's guesses (cheap, no tools), each probed.
// 4. One web search limited to the systems' hosts, its result links probed. The same search
//    covers hiring systems we can't read, so the result can at least name the one in use.
// A board counts as the employer's only when the system's own company name matches the
// name searched for. Boards that exist but state no name (Lever, Ashby, Workday) are shown
// as unconfirmed and never counted. AI never writes the directory.

export const LEGAL_SUFFIX = /[,\s]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|ag|sa|bv)\.?$/i;
export const bareName = (name: string) => name.trim().replace(LEGAL_SUFFIX, "").trim();

const fold = (s: string) =>
  bareName(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** "Hugging Face, Inc." and "hugging face" are the same company; "Acme" and "Acme Labs" are not. */
export function sameCompany(a: string, b: string): boolean {
  const x = fold(a).replace(/[^a-z0-9]/g, "");
  return x.length >= 2 && x === fold(b).replace(/[^a-z0-9]/g, "");
}

/** "Reyes Family of Businesses", "Acme Group of Companies": the brand phrase around the name. */
const BRAND_FAMILY = /\s+((family|group) of (businesses|companies|brands)|companies|enterprises)$/;
/** Words that may follow a company's name and still mean that company ("Acme Holdings", "Acme, L.L.C."). */
const CORP_WORD = new Set(["holdings", "holding", "inc", "incorporated", "llc", "l", "c", "ltd", "limited", "group", "corp", "corporation", "company", "co", "careers", "jobs", "job", "us", "usa", "hq", "global", "family", "companies", "enterprises"]);
const CORP_TAIL = /^(holdings?|inc|llc|ltd|group|corp|co|careers|jobs|us|usa|hq|global)*$/;

/**
 * Whether a hiring-system account or a search result's title names this employer:
 * "careers-reyesholdings" or "Developer | Reyes Holdings, L.L.C" for "Reyes Holdings".
 * The name must be followed by nothing or a corporate word, so "Reyes TX Inc" isn't "Reyes".
 * It only decides what a 0-point fact may mention; it never counts anything.
 */
export function mentionsEmployer(account: string | null, title: string, employer: string): boolean {
  const words = fold(employer).replace(BRAND_FAMILY, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const compact = words.join("");
  if (compact.length < 3) return false;
  const acc = account ? fold(account).replace(/[^a-z0-9]/g, "") : "";
  if (acc) {
    // The whole name plus corporate words, or the name's leading words ("reyes" for Reyes Holdings).
    if (acc.startsWith(compact) && CORP_TAIL.test(acc.slice(compact.length))) return true;
    if (acc.length >= 4 && words.some((_, i) => words.slice(0, i + 1).join("") === acc)) return true;
  }
  const tokens = fold(title).replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, j) => tokens[i + j] === w)) {
      const next = tokens[i + words.length];
      if (next === undefined || CORP_WORD.has(next)) return true;
    }
  }
  return false;
}

export const discoveryKey = (name: string) =>
  fold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** Likely identifiers: "Hugging Face" → huggingface, hugging-face. */
export function slugVariants(name: string): string[] {
  const f = fold(name);
  const compact = f.replace(/[^a-z0-9]/g, "");
  const dashed = f.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [...new Set([compact, dashed])].filter((v) => v.length >= 2 && v.length <= 60);
}

export type Probe = BoardLink & { declaredName: string | null };
export type DiscoveryMethod = "cache" | "probe" | "guess" | "search";
export type Candidate = Probe & { method: DiscoveryMethod };

const PROBE_TIMEOUT_MS = 3000;
const PROBE_SYSTEMS = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE", "RECRUITEE"] as const;
const name = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);

/** Whether a board exists, and the company name it states. Null when it doesn't exist or can't be reached. */
export async function probeBoard(link: BoardLink, opts: FetchOptions = {}): Promise<Probe | null> {
  const o = { timeoutMs: PROBE_TIMEOUT_MS, ...opts };
  const b = encodeURIComponent(link.board);
  try {
    switch (link.ats) {
      case "GREENHOUSE":
        return { ...link, declaredName: name((await getJson<{ name?: unknown }>(`https://boards-api.greenhouse.io/v1/boards/${b}`, o)).name) };
      case "LEVER":
        return Array.isArray(await getJson(`https://api.lever.co/v0/postings/${b}?mode=json&limit=1`, o)) ? { ...link, declaredName: null } : null;
      case "ASHBY": {
        const r = await getJson<{ jobs?: unknown }>(`https://api.ashbyhq.com/posting-api/job-board/${b}`, o);
        return Array.isArray(r.jobs) ? { ...link, declaredName: null } : null;
      }
      case "SMARTRECRUITERS": {
        const r = await getJson<{ totalFound?: number; content?: { company?: { name?: unknown } }[] }>(`https://api.smartrecruiters.com/v1/companies/${b}/postings?limit=1`, o);
        return (r.totalFound ?? 0) > 0 ? { ...link, declaredName: name(r.content?.[0]?.company?.name) } : null;
      }
      case "WORKABLE":
        return { ...link, declaredName: name((await getJson<{ name?: unknown }>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(link.board.toLowerCase())}`, o)).name) };
      case "RECRUITEE": {
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(link.board)) return null;
        const r = await getJson<{ offers?: { company_name?: unknown }[] }>(`https://${link.board}.recruitee.com/api/offers/`, o);
        return { ...link, declaredName: name(r.offers?.[0]?.company_name) };
      }
      case "WORKDAY":
        return (await boardExists({ ats: "WORKDAY", board: link.board, host: link.host }, o)) ? { ...link, declaredName: null } : null;
    }
  } catch (error) {
    if (error instanceof UpstreamError) return null;
    throw error;
  }
}

export type CachedDiscovery = {
  key: string;
  employerName: string;
  status: "FOUND" | "NOT_FOUND";
  ats: BoardLink["ats"] | null;
  board: string | null;
  host: string | null;
  declaredName: string | null;
  method: string;
  expiresAt: Date;
};

export type DiscoveryDeps = {
  ai: AiTransport;
  userId: string;
  now: Date;
  signal?: AbortSignal;
  probe(link: BoardLink): Promise<Probe | null>;
  cache: { get(key: string): Promise<CachedDiscovery | null>; put(row: CachedDiscovery): Promise<void> };
  /** Whether the check has time left for a web search (about 30 s). */
  canSearch(): boolean;
};

export type Discovery = {
  found: Candidate | null;
  /** Boards that exist but don't state a company name: shown, never counted. */
  unconfirmed: Candidate[];
  ai: { used: boolean; model: string | null; mode: "live" | "replay" | null };
  /** Why an AI step didn't run or failed, when that left the search incomplete. */
  aiFailure: AiFailureReason | null;
  /** Results on hiring systems we can't read, from the same search; null when no search ran (e.g. a cached answer). */
  others: SearchHit[] | null;
};

const FOUND_DAYS = 30;
const NOT_FOUND_DAYS = 7;
/** A miss from the free probes alone (AI off, over budget or out of time): kept briefly so repeats don't re-probe every board. */
const PROBE_MISS_DAYS = 0.5;
/** An admin dismissed a board as not the employer's: kept long enough for the squat to be abandoned. */
export const DISMISSED_DAYS = 90;
const days = (now: Date, n: number) => new Date(now.getTime() + n * 86_400_000);
const linkKey = (l: BoardLink) => `${l.ats}:${l.board.toLowerCase()}:${l.host ?? ""}`;

export async function discoverBoard(employerInput: string, role: string | null, deps: DiscoveryDeps): Promise<Discovery> {
  const result: Discovery = { found: null, unconfirmed: [], ai: { used: false, model: null, mode: null }, aiFailure: null, others: null };
  const employer = safeQuery(employerInput, 60);
  const key = employer ? discoveryKey(employer) : "";
  if (!employer || key.length < 2) return result;

  const cached = await deps.cache.get(key).catch(() => null);
  if (cached && cached.expiresAt > deps.now) {
    if (cached.status === "FOUND" && cached.ats && cached.board) {
      result.found = { ats: cached.ats, board: cached.board, ...(cached.host ? { host: cached.host } : {}), declaredName: cached.declaredName, method: "cache" };
    }
    return result;
  }

  const tried = new Set<string>();
  const all: Candidate[] = [];
  async function check(links: BoardLink[], method: DiscoveryMethod): Promise<Candidate | null> {
    const fresh = links.filter((l) => !tried.has(linkKey(l)));
    fresh.forEach((l) => tried.add(linkKey(l)));
    const probes = await Promise.all(fresh.map((l) => deps.probe(l).catch(() => null)));
    const hits = probes.filter((p): p is Probe => Boolean(p)).map((p) => ({ ...p, method }));
    all.push(...hits);
    return hits.find((p) => p.declaredName && sameCompany(p.declaredName, employer!)) ?? null;
  }
  const noteAi = (out: { ok: true; model: string; mode: "live" | "replay" } | { ok: false; reason: AiFailureReason }) => {
    if (out.ok) result.ai = { used: true, model: out.model, mode: out.mode };
    else if (out.reason !== "off" || !result.aiFailure) result.aiFailure = out.reason;
  };

  // 2. Free probes.
  const variants = slugVariants(employer);
  result.found = await check(variants.flatMap((v) => PROBE_SYSTEMS.map((ats) => ({ ats, board: v }))), "probe");

  // 3. Claude's guesses.
  if (!result.found && deps.ai.guessBoards) {
    const out = await deps.ai.guessBoards(employer, { userId: deps.userId, signal: deps.signal });
    noteAi(out);
    if (out.ok) result.found = await check(out.value, "guess");
  }

  // 4. One restricted web search.
  let searched = false;
  if (!result.found && deps.ai.searchBoards) {
    if (!deps.canSearch()) result.aiFailure ??= "timeout";
    else {
      const out = await deps.ai.searchBoards(employer, role ? safeQuery(role, 120) : null, { userId: deps.userId, signal: deps.signal });
      noteAi(out);
      if (out.ok) {
        searched = true;
        result.others = out.value.others;
        result.found = await check(out.value.boards, "search");
      }
    }
  }
  if (result.found) result.aiFailure = null;

  // Boards that exist but state no company name. A stated name that differs is someone else's board.
  result.unconfirmed = result.found ? [] : all.filter((p) => !p.declaredName).slice(0, 3);

  // Stored: the cache key (a slug) and the board's own name. Never the text the user typed or
  // Claude read: for a found board the board's own name stands in, for a miss nothing does.
  if (result.found) {
    const f = result.found;
    await deps.cache
      .put({ key, employerName: f.declaredName ?? "", status: "FOUND", ats: f.ats, board: f.board, host: f.host ?? null, declaredName: f.declaredName, method: f.method, expiresAt: days(deps.now, FOUND_DAYS) })
      .catch(() => undefined);
  } else if (!result.unconfirmed.length) {
    // A completed search that found nothing is kept 7 days; a probe-only miss (AI off, over
    // budget, out of time) only half a day, so a later check can still run the search.
    const keep = searched ? NOT_FOUND_DAYS : PROBE_MISS_DAYS;
    await deps.cache
      .put({ key, employerName: "", status: "NOT_FOUND", ats: null, board: null, host: null, declaredName: null, method: searched ? "search" : "probe", expiresAt: days(deps.now, keep) })
      .catch(() => undefined);
  }
  return result;
}
