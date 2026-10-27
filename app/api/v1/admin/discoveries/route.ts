import type { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { pendingDiscoveries, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/admin/discoveries (admin): boards found for companies we don't list, to review and add. */
export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request, "read");
  const rows = await pendingDiscoveries();
  return Response.json({
    discoveries: rows.map(({ key, employerName, ats, board, host, declaredName, method, checkedAt }) => ({ key, employerName, ats, board, host, declaredName, method, checkedAt })),
  });
});
