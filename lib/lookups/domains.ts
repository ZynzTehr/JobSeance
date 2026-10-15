import { distance } from "fastest-levenshtein";
import { getDomain, getDomainWithoutSuffix, getPublicSuffix } from "tldts";
import freeDomains from "@/data/email-domains/free-email-domains.json";
import disposableDomains from "@/data/email-domains/disposable-email-domains.json";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/http";
import { getJson, UpstreamError, type FetchOptions } from "@/lib/lookups/fetch";
import type { RdapStatus } from "@/app/generated/prisma/client";

// Sender-domain facts: registrable domain, free/disposable mail, ATS senders,
// lookalikes (pure), plus RDAP registration date and DNS MX (cached 7 days).

// ---- Pure rules -------------------------------------------------------------

const FREE = new Set<string>(freeDomains);
const DISPOSABLE = new Set<string>(disposableDomains);

/** Domains the big ATSs send recruiting mail from. Never free-mail, never lookalikes. */
export const ATS_SENDER_DOMAINS = ["greenhouse-mail.io", "hire.lever.co", "ashbyhq.com", "myworkday.com", "smartrecruiters.com"];

/** Reserved TLDs (RFC 2606/6761): answered locally, never sent to RDAP or DNS. */
const RESERVED_TLDS = new Set(["example", "test", "invalid", "localhost", "local"]);

const DOMAIN_SHAPE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** Trims, lowercases and strips "user@" and a trailing dot. Returns null if it isn't a hostname. */
export function normalizeHost(input: string): string | null {
  let host = input.trim().toLowerCase();
  const at = host.lastIndexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  host = host.replace(/\.$/, "");
  return DOMAIN_SHAPE.test(host) ? host : null;
}

/** "mail.google.com" → "google.com"; "a.b.co.uk" → "b.co.uk". Null for bare suffixes or junk. */
export function registrableDomain(input: string): string | null {
  const host = normalizeHost(input);
  return host ? getDomain(host) : null;
}

export const isFreeMail = (domain: string) => FREE.has(domain);
export const isDisposable = (domain: string) => DISPOSABLE.has(domain);

/** True for an ATS sender domain or any subdomain of one (e.g. "us.greenhouse-mail.io"). */
export function isAtsSender(host: string): boolean {
  return ATS_SENDER_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

export type OfficialDomain = { domain: string; slug: string };
export type Lookalike = {
  official: string | null;
  slug: string | null;
  reason: "typo" | "brand_suffix" | "other_tld" | "punycode";
};

const BRAND_SUFFIXES = ["careers", "hr", "jobs", "llc", "recruiting"];

/** Edits allowed for a label of this length: short labels collide too easily. */
const maxEdits = (len: number) => (len >= 7 ? 2 : len >= 4 ? 1 : 0);

/**
 * Flags a registrable domain that imitates an official one: 1–2 edits away,
 * brand plus careers/hr/jobs/llc/recruiting, same brand on another TLD, or punycode.
 * Exact official domains are never flagged.
 */
export function findLookalike(domain: string, officials: OfficialDomain[]): Lookalike | null {
  if (officials.some((o) => o.domain === domain)) return null;
  const label = getDomainWithoutSuffix(domain);
  const suffix = getPublicSuffix(domain);
  if (!label) return null;

  let best: Lookalike | null = null;
  let bestRank = Infinity; // 0 = brand match, otherwise edit count
  const consider = (candidate: Lookalike, rank: number) => {
    if (rank < bestRank) [best, bestRank] = [candidate, rank];
  };

  for (const o of officials) {
    const brand = getDomainWithoutSuffix(o.domain);
    if (!brand) continue;
    const base = { official: o.domain, slug: o.slug };
    if (label === brand && suffix !== getPublicSuffix(o.domain)) consider({ ...base, reason: "other_tld" }, 0);
    for (const s of BRAND_SUFFIXES) {
      if (label === `${brand}${s}` || label === `${brand}-${s}`) consider({ ...base, reason: "brand_suffix" }, 0);
    }
    const edits = distance(label, brand);
    if (edits > 0 && edits <= maxEdits(Math.min(label.length, brand.length))) consider({ ...base, reason: "typo" }, edits);
  }

  if (best) return best;
  return domain.split(".").some((part) => part.startsWith("xn--"))
    ? { official: null, slug: null, reason: "punycode" }
    : null;
}

// ---- RDAP ---------------------------------------------------------------------

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;

/** TLDs missing from the IANA bootstrap; results from these are labelled unofficial. */
export const RDAP_FALLBACK: Record<string, string> = {
  io: "https://rdap.identitydigital.services/rdap/",
  me: "https://rdap.identitydigital.services/rdap/",
  co: "https://rdap.registry.co/co/",
  us: "https://rdap.nic.us/",
};

let bootstrap: { map: Map<string, string>; loadedAt: number } | null = null;

type Bootstrap = { services?: [string[], string[]][] };

export function parseBootstrap(raw: Bootstrap): Map<string, string> {
  const map = new Map<string, string>();
  for (const [tlds, urls] of raw.services ?? []) {
    const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
    if (!url) continue;
    for (const tld of tlds) map.set(tld.toLowerCase(), url.endsWith("/") ? url : `${url}/`);
  }
  return map;
}

async function rdapBase(tld: string, opts?: FetchOptions, now = Date.now()) {
  if (!bootstrap || now - bootstrap.loadedAt > BOOTSTRAP_TTL_MS) {
    try {
      bootstrap = { map: parseBootstrap(await getJson<Bootstrap>(BOOTSTRAP_URL, opts)), loadedAt: now };
    } catch (error) {
      if (!bootstrap) throw error; // keep serving a stale bootstrap if IANA is down
    }
  }
  const official = bootstrap.map.get(tld);
  if (official) return { base: official, source: "official" as const };
  const fallback = RDAP_FALLBACK[tld];
  return fallback ? { base: fallback, source: "unofficial" as const } : null;
}

type RdapDomain = { events?: { eventAction?: string; eventDate?: string }[] };

export function registrationDate(raw: RdapDomain): Date | null {
  const event = raw.events?.find((e) => e.eventAction === "registration");
  const date = event?.eventDate ? new Date(event.eventDate) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export type RdapResult = { status: RdapStatus; registeredAt: Date | null; source: "official" | "unofficial" | null };

export async function rdapLookup(domain: string, opts?: FetchOptions): Promise<RdapResult> {
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld)) return { status: "UNSUPPORTED_TLD", registeredAt: null, source: null };

  let server: Awaited<ReturnType<typeof rdapBase>>;
  try {
    server = await rdapBase(tld, opts);
  } catch {
    return { status: "ERROR", registeredAt: null, source: null };
  }
  if (!server) return { status: "UNSUPPORTED_TLD", registeredAt: null, source: null };

  if (!rateLimit("rdap:outbound", 8, 10).ok) return { status: "ERROR", registeredAt: null, source: server.source };
  try {
    const raw = await getJson<RdapDomain>(`${server.base}domain/${encodeURIComponent(domain)}`, {
      ...opts,
      accept: "application/rdap+json, application/json",
    });
    return { status: "OK", registeredAt: registrationDate(raw), source: server.source };
  } catch (error) {
    // Verisign answers an unregistered name with an empty-bodied 404.
    if (error instanceof UpstreamError && error.kind === "not_found") {
      return { status: "NOT_REGISTERED", registeredAt: null, source: server.source };
    }
    return { status: "ERROR", registeredAt: null, source: server.source };
  }
}

// ---- DNS (MX over HTTPS) --------------------------------------------------------

type DnsAnswer = { Status?: number; Answer?: { type?: number; data?: string }[] };
export type MxResult = { hasMx: boolean | null; nullMx: boolean | null };

export function parseMx(raw: DnsAnswer): MxResult {
  if (raw.Status === 3) return { hasMx: false, nullMx: false }; // NXDOMAIN
  if (raw.Status !== 0) return { hasMx: null, nullMx: null }; // SERVFAIL etc.: couldn't verify
  const mx = (raw.Answer ?? []).filter((a) => a.type === 15).map((a) => (a.data ?? "").trim());
  const nullMx = mx.length === 1 && /^0\s+\.$/.test(mx[0]); // RFC 7505: "0 ." means no mail accepted
  return { hasMx: mx.length > 0 && !nullMx, nullMx };
}

export async function mxLookup(domain: string, opts?: FetchOptions): Promise<MxResult> {
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld)) return { hasMx: false, nullMx: false };
  try {
    const raw = await getJson<DnsAnswer>(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
      ...opts,
      accept: "application/dns-json",
    });
    return parseMx(raw);
  } catch {
    return { hasMx: null, nullMx: null };
  }
}

// ---- Cached lookup ------------------------------------------------------------

export const DOMAIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DomainFacts = {
  domain: string;
  registeredAt: Date | null;
  status: RdapStatus;
  source: "official" | "unofficial" | "cache" | null;
  hasMx: boolean | null;
  nullMx: boolean | null;
  checkedAt: Date;
};

/** RDAP + MX for a registrable domain. Reads DomainLookup first; never caches ERROR. */
export async function lookupDomain(domain: string, now = new Date(), opts?: FetchOptions): Promise<DomainFacts> {
  const db = getDb();
  const cached = await db.domainLookup.findUnique({ where: { domain } });
  if (cached && now.getTime() - cached.checkedAt.getTime() < DOMAIN_TTL_MS) {
    return { ...cached, source: "cache" };
  }

  const [rdap, mx] = await Promise.all([rdapLookup(domain, opts), mxLookup(domain, opts)]);
  const row = { registeredAt: rdap.registeredAt, status: rdap.status, hasMx: mx.hasMx, nullMx: mx.nullMx, checkedAt: now };
  if (rdap.status !== "ERROR" && mx.hasMx !== null) {
    await db.domainLookup.upsert({ where: { domain }, update: row, create: { domain, ...row } });
  }
  return { domain, ...row, source: rdap.source };
}

/** Every company's official domains, for lookalike and officialFor checks. */
export async function officialDomains(): Promise<OfficialDomain[]> {
  const companies = await getDb().company.findMany({ select: { slug: true, officialDomains: true } });
  return companies.flatMap((c) => c.officialDomains.map((domain) => ({ domain: domain.toLowerCase(), slug: c.slug })));
}

export const ageDays = (registeredAt: Date | null, now = new Date()) =>
  registeredAt ? Math.floor((now.getTime() - registeredAt.getTime()) / 86_400_000) : null;

export type DomainReport = {
  host: string;
  domain: string;
  facts: DomainFacts;
  ageDays: number | null;
  freeMail: boolean;
  disposable: boolean;
  atsSender: boolean;
  lookalike: Lookalike | null;
  officialFor: string[];
};

/** Every fact about a sender host. Returns null when it has no registrable domain. */
export async function describeDomain(input: string, now = new Date(), opts?: FetchOptions): Promise<DomainReport | null> {
  const host = normalizeHost(input);
  const domain = host ? registrableDomain(host) : null;
  if (!host || !domain) return null;
  const [facts, officials] = await Promise.all([lookupDomain(domain, now, opts), officialDomains()]);
  const officialFor = [...new Set(officials.filter((o) => o.domain === domain || o.domain === host).map((o) => o.slug))];
  const atsSender = isAtsSender(host);
  return {
    host,
    domain,
    facts,
    ageDays: ageDays(facts.registeredAt, now),
    freeMail: isFreeMail(domain) || isFreeMail(host),
    disposable: isDisposable(domain) || isDisposable(host),
    atsSender,
    lookalike: officialFor.length || atsSender ? null : findLookalike(domain, officials),
    officialFor,
  };
}
