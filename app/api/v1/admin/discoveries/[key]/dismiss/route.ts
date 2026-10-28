import type { NextRequest } from "next/server";
import { handle, notFound } from "@/lib/api";
import { dismissDiscovery, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** POST /api/v1/admin/discoveries/:key/dismiss (admin): a found board isn't the employer's; no check shows it for 90 days. */
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/v1/admin/discoveries/[key]/dismiss">) => {
  await requireAdmin(request, "write");
  const key = (await ctx.params).key;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) throw notFound("That board");
  await dismissDiscovery(key);
  return Response.json({ dismissed: key });
});
