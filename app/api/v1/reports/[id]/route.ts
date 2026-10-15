import type { NextRequest } from "next/server";
import { assertOwner, handle, HttpError, readBody, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ownReportSelect } from "@/lib/report-shape";
import { reportUpdate } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/reports/[id]">;

/** PATCH /api/v1/reports/:id: owner updates status (e.g. Applied → No response). */
export const PATCH = handle(async (request: NextRequest, ctx: Ctx) => {
  const user = await writer(request);
  const { id } = await ctx.params;
  const db = getDb();
  const existing = await db.outcomeReport.findUnique({ where: { id }, select: { userId: true, appliedAt: true, lastInterviewAt: true } });
  assertOwner(existing, user, "That report");
  const body = await readBody(request, reportUpdate);

  const appliedAt = body.appliedAt ?? existing!.appliedAt;
  const lastInterviewAt = body.lastInterviewAt === undefined ? existing!.lastInterviewAt : body.lastInterviewAt;
  if (lastInterviewAt && lastInterviewAt < appliedAt) {
    const message = "The interview can't be before you applied.";
    throw new HttpError({ status: 400, code: "validation_failed", message, fields: { lastInterviewAt: message } });
  }

  const report = await db.outcomeReport.update({
    where: { id },
    data: {
      ...body,
      ...(body.note !== undefined ? { note: body.note || null } : {}),
      ...(body.lastInterviewAt && !body.stageReached ? { stageReached: "INTERVIEWED" as const } : {}),
    },
    select: ownReportSelect,
  });
  return Response.json({ report });
});

/** DELETE /api/v1/reports/:id: owner only. */
export const DELETE = handle(async (request: NextRequest, ctx: Ctx) => {
  const user = await writer(request);
  const { id } = await ctx.params;
  const db = getDb();
  assertOwner(await db.outcomeReport.findUnique({ where: { id }, select: { userId: true } }), user, "That report");
  await db.outcomeReport.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
