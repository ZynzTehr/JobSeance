import { getDb } from "@/lib/db";

// Always run at request time: this route reports live database health.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ db: "ok" });
  } catch {
    // Never echo driver errors: they can include the host or user name.
    return Response.json(
      { error: { code: "db_unavailable", message: "Database is unreachable." } },
      { status: 503 },
    );
  }
}
