import type { NextRequest } from "next/server";
import { handle, readBody } from "@/lib/api";
import { aiSummary, requireAdmin, setAiPaused } from "@/lib/admin";
import { aiPauseBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** POST /api/v1/admin/ai-pause (admin): { paused } stops or resumes every AI call within a minute, no redeploy. */
export const POST = handle(async (request: NextRequest) => {
  await requireAdmin(request, "write");
  const { paused } = await readBody(request, aiPauseBody);
  await setAiPaused(paused);
  return Response.json(await aiSummary());
});
