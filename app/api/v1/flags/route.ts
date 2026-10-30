import type { NextRequest } from "next/server";
import { handle, HttpError, limitSubmissions, notFound, optionalWriter, readBody } from "@/lib/api";
import { guardForm } from "@/lib/bot-guard";
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
  // A valid Bearer token (an API client) skips the browser checks; with a Bearer header only that token counts.
  const trusted = user !== null && request.headers.has("authorization");
  const body = await readBody(request, flagCreate, async (raw) => {
    const guard = await guardForm(raw, { purpose: "flag", headers: request.headers, trusted });
    if (!guard.ok) throw new HttpError(guard.error);
    return guard.body;
  });
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
    case "SITE":
      // General contact and privacy requests: there is no record to point at.
      targetId = "site";
      break;
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
  // The client words its confirmation from these, not from what it assumed about the session.
  const hidden = hide && (body.targetType === "OUTCOME_REPORT" || body.targetType === "SCAM_REPORT");
  return Response.json({ flag, hidden, linkedToAccount: user !== null }, { status: 201 });
});
