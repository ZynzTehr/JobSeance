import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, HttpError, limitSubmissions, readBody, readQuery, writer } from "@/lib/api";
import { findCompany, senderFacts } from "@/lib/checks/run";
import { getDb } from "@/lib/db";
import { describeDomain, registrableDomain } from "@/lib/lookups/domains";
import { excerpt } from "@/lib/redact";
import { ownScamReportSelect } from "@/lib/report-shape";
import { scamReportCreate } from "@/lib/schemas";
import { scoreScam } from "@/lib/scoring/scam";

export const dynamic = "force-dynamic";

const countQuery = z.strictObject({ domain: z.string().trim().min(3).max(254) });

const distinctReporters = async (domain: string) =>
  (
    await getDb().scamReport.findMany({
      where: { senderDomain: domain, visibility: "VISIBLE" },
      distinct: ["userId"],
      select: { userId: true },
    })
  ).length;

/** GET /api/v1/scam-reports?domain=: number of distinct reporters for a sender domain. Public. */
export const GET = handle(async (request: NextRequest) => {
  const { domain: raw } = readQuery(request, countQuery);
  const domain = registrableDomain(raw);
  if (!domain) throw new HttpError({ status: 400, code: "invalid_domain", message: "Use a domain like acme.com.", fields: { domain: "Invalid domain." } });
  return Response.json({ domain, reporters: await distinctReporters(domain) });
});

/**
 * POST /api/v1/scam-reports: report a scam message. The text is scored in memory;
 * only the sender domain, matched rule IDs, score and (if opted in) a redacted excerpt are stored.
 */
export const POST = handle(async (request: NextRequest) => {
  const user = await writer(request);
  limitSubmissions(request, user, "report");
  const body = await readBody(request, scamReportCreate);
  const db = getDb();
  const now = new Date();

  const report = await describeDomain(body.senderEmail, now);
  if (!report) {
    throw new HttpError({ status: 400, code: "validation_failed", message: "Check the sender address.", fields: { senderEmail: "Enter an address like name@company.com." } });
  }
  const already = await db.scamReport.findFirst({ where: { userId: user.id, senderDomain: report.domain }, select: { id: true } });
  if (already) {
    const message = "You already reported this sender. Edit that report instead.";
    throw new HttpError({ status: 409, code: "conflict", message, fields: { senderEmail: message } });
  }

  const claimed = body.companyClaimed ? await findCompany(body.companyClaimed) : null;
  const score = scoreScam({
    text: body.text,
    sender: senderFacts(report, await distinctReporters(report.domain)),
    claimed: claimed && { slug: claimed.slug, name: claimed.name, officialDomains: claimed.officialDomains },
    namesEmployer: Boolean(body.companyClaimed),
    notOnBoard: null,
    now,
  });

  const created = await db.scamReport.create({
    data: {
      userId: user.id,
      senderDomain: report.domain,
      companyClaimed: body.companyClaimed || null,
      channel: body.channel,
      ruleIds: score.signals.filter((s) => s.points > 0).map((s) => s.id),
      scamScore: score.score ?? 0,
      redactedExcerpt: body.shareExcerpt ? excerpt(body.text) : null,
    },
    select: ownScamReportSelect,
  });
  return Response.json({ scamReport: created }, { status: 201 });
});
