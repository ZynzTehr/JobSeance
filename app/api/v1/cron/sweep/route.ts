import { isAuthorizedCron } from "@/lib/cleanup";
import { getDb } from "@/lib/db";
import { errorBody } from "@/lib/http";
import { runSweep } from "@/lib/lookups/sweep";

// Always run at request time: this route refetches job boards.
export const dynamic = "force-dynamic";
// About twenty boards, one at a time, each with its own 25 s fetch timeout (lib/lookups/sweep.ts).
export const maxDuration = 300;

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
    const counts = await runSweep(getDb(), ranAt);
    // Counts only: no company names, no hosts.
    console.log(
      `sweep: boards=${counts.boards} synced=${counts.synced} failed=${counts.failed} added=${counts.added} relisted=${counts.relisted} removed=${counts.removed}`,
    );
    return Response.json({ ok: true, ranAt: ranAt.toISOString(), ...counts });
  } catch {
    // Never echo driver errors: they can include the host or user name.
    return Response.json(
      errorBody({ status: 500, code: "sweep_failed", message: "Sweep failed. Try again later." }),
      { status: 500 },
    );
  }
}
