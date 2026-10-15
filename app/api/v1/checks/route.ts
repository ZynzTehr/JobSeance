import type { NextRequest } from "next/server";
import { handle, reader } from "@/lib/api";
import { jsonError, requireUser } from "@/lib/auth/require-user";
import { checkRequest, clientIp, rateLimit, tooManyRequests } from "@/lib/http";
import { CheckError, checkSchema, runCheck } from "@/lib/checks/run";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 100_000;

/** GET /api/v1/checks: my saved checks, newest first. */
export const GET = handle(async (request: NextRequest) => {
  const user = await reader(request);
  const checks = await getDb().check.findMany({
    where: { userId: user.id, saved: true },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      inputKind: true,
      ghostScore: true,
      ghostBand: true,
      scamScore: true,
      scamBand: true,
      senderDomain: true,
      signals: true,
      configVersion: true,
      saved: true,
      createdAt: true,
      companyId: true,
      postingId: true,
    },
  });
  // Check stores plain ids (no relations), so label them in two queries.
  const db = getDb();
  const ids = (key: "companyId" | "postingId") => [...new Set(checks.map((c) => c[key]).filter((v): v is string => !!v))];
  const [companies, postings] = await Promise.all([
    db.company.findMany({ where: { id: { in: ids("companyId") } }, select: { id: true, slug: true, name: true } }),
    db.posting.findMany({ where: { id: { in: ids("postingId") } }, select: { id: true, title: true, url: true } }),
  ]);
  const company = new Map(companies.map(({ id, ...c }) => [id, c]));
  const posting = new Map(postings.map(({ id, ...p }) => [id, p]));
  return Response.json({
    checks: checks.map(({ companyId, postingId, ...c }) => ({
      ...c,
      company: (companyId && company.get(companyId)) || null,
      posting: (postingId && posting.get(postingId)) || null,
    })),
  });
});

/** POST /api/v1/checks: the scanner. Public, 60/min per IP (shared with domain lookups). */
export async function POST(request: NextRequest) {
  const limit = rateLimit(`scan:ip:${clientIp(request.headers)}`, 60, 60);
  if (!limit.ok) return jsonError(tooManyRequests(limit.retryAfter));

  // Public endpoint: JSON only, and refuse foreign browser origins (curl/Postman pass).
  const problem = checkRequest(request.method, request.headers, "auth");
  if (problem) return jsonError(problem);

  const tooLarge = () => jsonError({ status: 413, code: "payload_too_large", message: "Keep the request under 100 KB." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError({ status: 400, code: "invalid_json", message: "The body isn't valid JSON." });
  }

  const parsed = checkSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") for (const key of issue.keys) fields[key] = "Unknown field.";
      else fields[issue.path.join(".") || "body"] = issue.message;
    }
    return jsonError({ status: 400, code: "validation_failed", message: "Check the highlighted fields.", fields });
  }

  const user = await requireUser(request).catch(() => null);
  try {
    const result = await runCheck(parsed.data, user?.id ?? null);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CheckError) return jsonError(error.api);
    throw error;
  }
}
