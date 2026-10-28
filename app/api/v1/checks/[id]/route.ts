import type { NextRequest } from "next/server";
import { assertOwner, handle, readBody, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { checkUpdate } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/v1/checks/[id]">;

/** PATCH /api/v1/checks/:id `{saved}`: owner only. Anonymous checks have no owner (403). */
export const PATCH = handle(async (request: NextRequest, ctx: Ctx) => {
  const user = await writer(request);
  const { id } = await ctx.params;
  const db = getDb();
  assertOwner(await db.check.findUnique({ where: { id }, select: { userId: true } }), user, "That check");
  const { saved } = await readBody(request, checkUpdate);
  const check = await db.check.update({ where: { id }, data: { saved }, select: { id: true, saved: true } });
  return Response.json({ check });
});

/** DELETE /api/v1/checks/:id: owner only. */
export const DELETE = handle(async (request: NextRequest, ctx: Ctx) => {
  const user = await writer(request);
  const { id } = await ctx.params;
  const db = getDb();
  assertOwner(await db.check.findUnique({ where: { id }, select: { userId: true } }), user, "That check");
  // Shadow-mode rows hold only numbers, but they name this check: they go with it.
  await db.$transaction([db.aiShadow.deleteMany({ where: { checkId: id } }), db.check.delete({ where: { id } })]);
  return new Response(null, { status: 204 });
});
