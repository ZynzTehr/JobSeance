import type { NextRequest } from "next/server";
import { handle, notFound, readBody } from "@/lib/api";
import { requireAdmin, resolveFlag } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { flagUpdate } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** PATCH /api/v1/flags/:id (admin): review a problem report. Resolved flags are deleted 90 days after resolvedAt. */
export const PATCH = handle(async (request: NextRequest, ctx: RouteContext<"/api/v1/flags/[id]">) => {
  await requireAdmin(request, "write");
  const id = (await ctx.params).id;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw notFound("That problem report");
  const body = await readBody(request, flagUpdate);
  const db = getDb();
  const flag = await db.flag.findUnique({ where: { id } });
  if (!flag) throw notFound("That problem report");
  return Response.json({ flag: await resolveFlag(db, flag, body) });
});
