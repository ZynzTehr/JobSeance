import type { NextRequest } from "next/server";
import { handle, limitSubmissions, notFound, optionalWriter, readBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { flagCreate } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/flags: "Report a problem". Open to anyone, 20/hour per user or IP.
 * A personal-info flag from a signed-in user hides the report until reviewed;
 * anonymous flags stay open without hiding anything.
 */
export const POST = handle(async (request: NextRequest) => {
  const user = await optionalWriter(request);
  limitSubmissions(request, user, "flag");
  const body = await readBody(request, flagCreate);
  const db = getDb();

  let targetId = body.targetId;
  const where = { where: { id: targetId }, select: { id: true } };
  switch (body.targetType) {
    case "OUTCOME_REPORT":
      if (!(await db.outcomeReport.findUnique(where))) throw notFound("That report");
      break;
    case "SCAM_REPORT":
      if (!(await db.scamReport.findUnique(where))) throw notFound("That report");
      break;
    case "CHECK":
      if (!(await db.check.findUnique(where))) throw notFound("That check");
      break;
    case "COMPANY": {
      // Outsiders know the slug, not the id; accept either.
      const company = await db.company.findFirst({ where: { OR: [{ id: targetId }, { slug: targetId.toLowerCase() }] }, select: { id: true } });
      if (!company) throw notFound("That company");
      targetId = company.id;
      break;
    }
  }

  const hide = body.reason === "personal_info" && user !== null;
  const data = { visibility: "HIDDEN_PENDING_REVIEW" as const };
  const [flag] = await db.$transaction([
    db.flag.create({
      data: {
        targetType: body.targetType,
        targetId,
        reason: body.reason,
        details: body.details,
        reporterUserId: user?.id ?? null,
        reporterEmail: user ? null : (body.reporterEmail?.toLowerCase() ?? null),
      },
      select: { id: true, status: true },
    }),
    ...(hide && body.targetType === "OUTCOME_REPORT" ? [db.outcomeReport.update({ where: { id: targetId }, data, select: { id: true } })] : []),
    ...(hide && body.targetType === "SCAM_REPORT" ? [db.scamReport.update({ where: { id: targetId }, data, select: { id: true } })] : []),
  ]);
  return Response.json({ flag }, { status: 201 });
});
