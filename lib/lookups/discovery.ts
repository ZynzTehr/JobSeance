import { safeQuery } from "@/lib/ai/locate";
import type { AiTransport } from "@/lib/ai/transport";
import type { AiFailureReason } from "@/lib/ai/types";
import { boardExists } from "@/lib/lookups/boards";
import { getJson, UpstreamError, type FetchOptions } from "@/lib/lookups/fetch";
import type { BoardLink } from "@/lib/lookups/job-url";

// Phase 11: where does an employer outside our directory post its jobs?
// 1. A saved answer (found: 30 days, not found: 7 days).
// 2. Free probes of likely identifiers on the systems we read.
// 3. Claude's guesses (cheap, no tools), each probed.
// 4. One web search limited to the systems' hosts, its result links probed.
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
};

const FOUND_DAYS = 30;
const NOT_FOUND_DAYS = 7;
const days = (now: Date, n: number) => new Date(now.getTime() + n * 86_400_000);
const linkKey = (l: BoardLink) => `${l.ats}:${l.board.toLowerCase()}:${l.host ?? ""}`;

export async function discoverBoard(employerInput: string, role: string | null, deps: DiscoveryDeps): Promise<Discovery> {
  const result: Discovery = { found: null, unconfirmed: [], ai: { used: false, model: null, mode: null }, aiFailure: null };
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
        result.found = await check(out.value, "search");
      }
    }
  }
  if (result.found) result.aiFailure = null;

  // Boards that exist but state no company name. A stated name that differs is someone else's board.
  result.unconfirmed = result.found ? [] : all.filter((p) => !p.declaredName).slice(0, 3);

  const base = { key, employerName: employer.slice(0, 100) };
  if (result.found) {
    const f = result.found;
    await deps.cache
      .put({ ...base, status: "FOUND", ats: f.ats, board: f.board, host: f.host ?? null, declaredName: f.declaredName, method: f.method, expiresAt: days(deps.now, FOUND_DAYS) })
      .catch(() => undefined);
  } else if (searched && !result.unconfirmed.length) {
    // Only a completed search is cached as "not found"; a probe miss alone may just mean AI was off.
    await deps.cache
      .put({ ...base, status: "NOT_FOUND", ats: null, board: null, host: null, declaredName: null, method: "search", expiresAt: days(deps.now, NOT_FOUND_DAYS) })
      .catch(() => undefined);
  }
  return result;
}
