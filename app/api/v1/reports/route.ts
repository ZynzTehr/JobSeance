import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, HttpError, limitSubmissions, normalizeRole, notFound, readBody, readQuery, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { companyAggregate } from "@/lib/reports";
import { conflictOn, reportCreate } from "@/lib/schemas";
import { ownReportSelect } from "@/lib/report-shape";

export const dynamic = "force-dynamic";

const aggregateQuery = z
  .strictObject({ companyId: z.string().trim().min(1).max(40).optional(), company: z.string().trim().min(1).max(100).optional() })
  .refine((q) => q.companyId || q.company, { message: "Pass companyId or company.", path: ["companyId"] });

/** GET /api/v1/reports?companyId= (or ?company=<slug>): aggregate counts only. Public. */
export const GET = handle(async (request: NextRequest) => {
  const q = readQuery(request, aggregateQuery);
  const company = await getDb().company.findUnique({
    where: q.companyId ? { id: q.companyId } : { slug: q.company!.toLowerCase() },
    select: { id: true, slug: true },
  });
  if (!company) throw notFound("That company");
  return Response.json({ companyId: company.id, company: company.slug, ...(await companyAggregate(company.id)) });
});

/** POST /api/v1/reports: log an outcome. One per user per company + role (409). */
export const POST = handle(async (request: NextRequest) => {
  const user = await writer(request);
  limitSubmissions(request, user, "report");
  const body = await readBody(request, reportCreate);
  const db = getDb();

  const company = await db.company.findUnique({
    where: body.companyId ? { id: body.companyId } : { slug: body.company!.toLowerCase() },
    select: { id: true },
  });
  if (!company) throw new HttpError({ status: 400, code: "validation_failed", message: "Choose a company we list.", fields: { company: "Unknown company." } });
  if (body.postingId) {
    const posting = await db.posting.findUnique({ where: { id: body.postingId }, select: { companyId: true } });
    if (posting?.companyId !== company.id) {
      throw new HttpError({ status: 400, code: "validation_failed", message: "That posting isn't from this company.", fields: { postingId: "Unknown posting." } });
    }
  }

  const report = await db.outcomeReport
    .create({
      data: {
        userId: user.id,
        companyId: company.id,
        postingId: body.postingId ?? null,
        roleTitle: normalizeRole(body.roleTitle),
        appliedAt: body.appliedAt,
        lastInterviewAt: body.lastInterviewAt ?? null,
        lastContactAt: body.lastContactAt ?? null,
        stageReached: body.stageReached ?? (body.lastInterviewAt ? "INTERVIEWED" : "APPLIED"),
        outcome: body.outcome ?? "APPLIED",
        note: body.note || null,
      },
      select: ownReportSelect,
    })
    .catch((e) => conflictOn(e, "roleTitle", "You already reported this role at this company. Update that report instead."));
  return Response.json({ report }, { status: 201 });
});
