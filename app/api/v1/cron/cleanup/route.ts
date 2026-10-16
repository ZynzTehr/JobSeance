import { isAuthorizedCron, runCleanup } from "@/lib/cleanup";
import { getDb } from "@/lib/db";
import { errorBody } from "@/lib/http";

// Always run at request time: this route deletes expired rows.
export const dynamic = "force-dynamic";

// Called daily by Vercel Cron (vercel.json), which sends
// `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json(
      errorBody({ status: 401, code: "unauthorized", message: "Missing or invalid cron secret." }),
      { status: 401 },
    );
  }

  try {
    const ranAt = new Date();
    const counts = await runCleanup(getDb(), ranAt);
    // Counts only: no ids, no personal data.
    console.log(
      `cleanup: checksDeleted=${counts.checksDeleted} excerptsCleared=${counts.excerptsCleared} flagsDeleted=${counts.flagsDeleted}`,
    );
    return Response.json({ ok: true, ranAt: ranAt.toISOString(), ...counts });
  } catch {
    // Never echo driver errors: they can include the host or user name.
    return Response.json(
      errorBody({ status: 500, code: "cleanup_failed", message: "Cleanup failed. Try again later." }),
      { status: 500 },
    );
  }
}
