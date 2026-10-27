import type { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { aiSummary, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/admin/ai-usage (admin): today's and the last 7 days' AI spend and counts, and the pause switch. Numbers only. */
export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request, "read");
  return Response.json(await aiSummary());
});
