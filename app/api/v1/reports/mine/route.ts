import type { NextRequest } from "next/server";
import { handle, reader } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ownReportSelect } from "@/lib/report-shape";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports/mine: my outcome reports in full. */
export const GET = handle(async (request: NextRequest) => {
  const user = await reader(request);
  const reports = await getDb().outcomeReport.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: ownReportSelect,
  });
  return Response.json({ reports });
});
