import { getJson, type FetchOptions } from "@/lib/lookups/fetch";
import { isAtsSender, normalizeHost, registrableDomain } from "@/lib/lookups/domains";

// Email authentication from pasted headers (phase 9b). Pure parsing of RFC 5322
// headers and RFC 8601 Authentication-Results, plus one DNS lookup of the From
// domain's DMARC policy. Headers are read in memory and never stored or logged.

export type AuthResult = "pass" | "fail" | "softfail" | "neutral" | "none" | "temperror" | "permerror" | "policy";
export type DmarcPolicy = "reject" | "quarantine" | "none";

export type MailHeaders = {
  /** More than one From line, or none: we don't read such headers. */
  malformed: boolean;
  fromAddress: string | null;
  fromDomain: string | null;
  replyToDomain: string | null;
  /** The receiving server's results (the topmost Authentication-Results header), or null if absent. */
  results: {
    spf: { result: AuthResult; domain: string | null } | null;
    dkim: { result: AuthResult; domain: string | null }[];
    dmarc: { result: AuthResult; policy: DmarcPolicy | null } | null;
  } | null;
};

export const MAX_HEADERS = 50_000;

/** Unfolds continuation lines and returns [lowercased name, value] in order. Stops at the first blank line (the body). */
export function headerFields(raw: string): [string, string][] {
  const fields: [string, string][] = [];
  for (const line of raw.slice(0, MAX_HEADERS).replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim() === "") {
      if (fields.length) break;
      continue;
    }
    if (/^[ \t]/.test(line) && fields.length) {
      fields[fields.length - 1][1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0 && /^[!-9;-~]+$/.test(line.slice(0, colon))) fields.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return fields;
}

/** The address inside "Name <a@b>" or a bare "a@b"; null if none. */
export function addressOf(value: string): string | null {
  const angle = /<([^<>@\s]+@[^<>\s]+)>/.exec(value);
  const bare = angle ? angle[1] : /([^\s<>",;:]+@[^\s<>",;:]+)/.exec(value)?.[1];
  return bare ? bare.toLowerCase().replace(/[.>]+$/, "") : null;
}

const domainOfAddress = (address: string | null) => (address ? registrableDomain(address.slice(address.lastIndexOf("@") + 1)) : null);
const RESULT = /^(pass|fail|softfail|neutral|none|temperror|permerror|policy)$/i;

/** Parses one Authentication-Results value into SPF, DKIM and DMARC results. */
export function parseAuthResults(value: string): NonNullable<MailHeaders["results"]> {
  const out: NonNullable<MailHeaders["results"]> = { spf: null, dkim: [], dmarc: null };
  // Drop comments in parentheses but keep the DMARC policy inside them ("(p=REJECT sp=REJECT dis=NONE)").
  for (const part of value.split(";").slice(1)) {
    const policy = /\bp=(reject|quarantine|none)\b/i.exec(part)?.[1]?.toLowerCase() as DmarcPolicy | undefined;
    const clean = part.replace(/\([^)]*\)/g, " ").trim();
    const m = /^(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(clean);
    if (!m || !RESULT.test(m[2])) continue;
    const method = m[1].toLowerCase();
    const result = m[2].toLowerCase() as AuthResult;
    const prop = (name: string) => new RegExp(`\\b${name}=([^\\s;]+)`, "i").exec(clean)?.[1] ?? null;
    if (method === "spf" && !out.spf) {
      const from = prop("smtp\\.mailfrom");
      out.spf = { result, domain: from ? registrableDomain(from.includes("@") ? from.slice(from.lastIndexOf("@") + 1) : from) : null };
    } else if (method === "dkim") {
      const d = prop("header\\.d") ?? prop("header\\.i")?.replace(/^.*@/, "") ?? null;
      out.dkim.push({ result, domain: d ? registrableDomain(d) : null });
    } else if (method === "dmarc" && !out.dmarc) {
      out.dmarc = { result, policy: policy ?? null };
    }
  }
  return out;
}

export function parseMailHeaders(raw: string): MailHeaders {
  const fields = headerFields(raw);
  const all = (name: string) => fields.filter(([n]) => n === name).map(([, v]) => v);
  const froms = all("from");
  const fromAddress = froms.length === 1 ? addressOf(froms[0]) : null;
  const replyTo = all("reply-to")[0];
  const authResults = all("authentication-results")[0]; // topmost = added by the receiving server
  return {
    malformed: froms.length !== 1 || !fromAddress,
    fromAddress,
    fromDomain: domainOfAddress(fromAddress),
    replyToDomain: replyTo ? domainOfAddress(addressOf(replyTo)) : null,
    results: authResults ? parseAuthResults(authResults) : null,
  };
}

/** True when the reply domain is a hiring platform recruiters commonly use. */
export const replyToIsAts = (domain: string) => isAtsSender(normalizeHost(domain) ?? domain);

type DnsTxt = { Status?: number; Answer?: { type?: number; data?: string }[] };

/** The From domain's published DMARC policy (DNS TXT at _dmarc.<domain>), or null when none or unknown. */
export async function dmarcPolicy(domain: string, opts?: FetchOptions): Promise<DmarcPolicy | null> {
  try {
    const raw = await getJson<DnsTxt>(`https://dns.google/resolve?name=${encodeURIComponent(`_dmarc.${domain}`)}&type=TXT`, {
      ...opts,
      accept: "application/dns-json",
    });
    const record = (raw.Answer ?? [])
      .filter((a) => a.type === 16)
      .map((a) => (a.data ?? "").replace(/"\s*"/g, "").replace(/"/g, ""))
      .find((t) => /^v=DMARC1\b/i.test(t.trim()));
    const p = record ? /\bp=(reject|quarantine|none)\b/i.exec(record)?.[1] : undefined;
    return (p?.toLowerCase() as DmarcPolicy | undefined) ?? null;
  } catch {
    return null;
  }
}
