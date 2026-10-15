import type { NextRequest } from "next/server";
import { assertOwner, handle, readBody, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ownScamReportSelect } from "@/lib/report-shape";
import { scamReportUpdate } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/scam-reports/[id]">;

/** PATCH /api/v1/scam-reports/:id: owner edits channel or claimed company, or removes the excerpt. */
export const PATCH = handle(async (request: NextRequest, ctx: Ctx) => {
  const user = await writer(request);
  const { id } = await ctx.params;
  const db = getDb();
  assertOwner(await db.scamReport.findUnique({ where: { id }, select: { userId: true } }), user, "That report");
  const { removeExcerpt, ...body } = await readBody(request, scamReportUpdate);
  const scamReport = await db.scamReport.update({
    where: { id },
    data: {
      ...body,
      ...(body.companyClaimed !== undefined ? { companyClaimed: body.companyClaimed || null } : {}),
      ...(removeExcerpt ? { redactedExcerpt: null } : {}),
    },
    select: ownScamReportSelect,
  });
  return Response.json({ scamReport });
});

/** DELETE /api/v1/scam-reports/:id: owner only. */
export const DELETE = handle(async (request: NextRequest, ctx: Ctx) => {
  const user = await writer(request);
  const { id } = await ctx.params;
  const db = getDb();
  assertOwner(await db.scamReport.findUnique({ where: { id }, select: { userId: true } }), user, "That report");
  await db.scamReport.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
