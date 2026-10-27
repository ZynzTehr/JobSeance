import type { NextRequest } from "next/server";
import { handle, HttpError, reader } from "@/lib/api";
import { rateLimit, tooManyRequests } from "@/lib/http";
import { describeDomain } from "@/lib/lookups/domains";

export const dynamic = "force-dynamic";

/** GET /api/v1/domains/:domain: age, mail records, free-mail, ATS and lookalike flags. Signed in, 60/min per account (shared with checks). */
export const GET = handle(async (request: NextRequest, ctx: RouteContext<"/api/v1/domains/[domain]">) => {
  const user = await reader(request);
  const limit = rateLimit(`scan:user:${user.id}`, 60, 60);
  if (!limit.ok) throw new HttpError(tooManyRequests(limit.retryAfter));

  const { domain: param } = await ctx.params;
  const report = await describeDomain(param);
  if (!report) throw new HttpError({ status: 400, code: "invalid_domain", message: "Enter a domain like example.com." });

  const { host, domain, facts, lookalike } = report;
  return Response.json({
    domain: host,
    registrableDomain: domain,
    registeredAt: facts.registeredAt,
    ageDays: report.ageDays,
    rdap: { status: facts.status, source: facts.source },
    mail: { hasMx: facts.hasMx, nullMx: facts.nullMx },
    freeMail: report.freeMail,
    disposable: report.disposable,
    atsSender: report.atsSender,
    lookalike: lookalike && { official: lookalike.official, company: lookalike.slug, reason: lookalike.reason },
    officialFor: report.officialFor,
    checkedAt: facts.checkedAt,
  });
});
