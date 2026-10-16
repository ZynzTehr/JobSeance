import type { NextRequest } from "next/server";
import { handle, reader } from "@/lib/api";
import { jsonError, requireUser } from "@/lib/auth/require-user";
import { checkRequest, clientIp, rateLimit, tooManyRequests } from "@/lib/http";
import { CheckError, checkSchema, runCheck } from "@/lib/checks/run";
import { savedChecks } from "@/lib/saved-checks";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 100_000;

/** GET /api/v1/checks: my saved checks, newest first. */
export const GET = handle(async (request: NextRequest) => {
  const user = await reader(request);
  return Response.json({ checks: await savedChecks(user.id) });
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
