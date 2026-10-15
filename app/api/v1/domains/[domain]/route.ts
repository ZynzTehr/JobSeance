import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/auth/require-user";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";
import {
  ageDays,
  findLookalike,
  isAtsSender,
  isDisposable,
  isFreeMail,
  lookupDomain,
  normalizeHost,
  officialDomains,
  registrableDomain,
} from "@/lib/lookups/domains";

export const dynamic = "force-dynamic";

/** GET /api/v1/domains/:domain: age, mail records, free-mail, ATS and lookalike flags. Public, 60/min per IP (shared with checks). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/domains/[domain]">) {
  const limit = rateLimit(`scan:ip:${clientIp(request.headers)}`, 60, 60);
  if (!limit.ok) return jsonError(tooManyRequests(limit.retryAfter));

  const { domain: rawParam } = await ctx.params;
  const host = normalizeHost(rawParam);
  const domain = host ? registrableDomain(host) : null;
  if (!host || !domain) {
    return jsonError({ status: 400, code: "invalid_domain", message: "Enter a domain like example.com." });
  }

  const [facts, officials] = await Promise.all([lookupDomain(domain), officialDomains()]);
  const officialFor = [...new Set(officials.filter((o) => o.domain === domain || o.domain === host).map((o) => o.slug))];
  const atsSender = isAtsSender(host);
  const lookalike = officialFor.length || atsSender ? null : findLookalike(domain, officials);
  const freeMail = isFreeMail(domain) || isFreeMail(host);

  return Response.json({
    domain: host,
    registrableDomain: domain,
    registeredAt: facts.registeredAt,
    ageDays: ageDays(facts.registeredAt),
    rdap: { status: facts.status, source: facts.source },
    mail: { hasMx: facts.hasMx, nullMx: facts.nullMx },
    freeMail,
    disposable: isDisposable(domain) || isDisposable(host),
    atsSender,
    lookalike: lookalike && { official: lookalike.official, company: lookalike.slug, reason: lookalike.reason },
    officialFor,
    checkedAt: facts.checkedAt,
  });
}
