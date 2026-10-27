import type { NextRequest } from "next/server";
import { handle, HttpError, readBody, reader, writer } from "@/lib/api";
import { jsonError } from "@/lib/auth/require-user";
import { rateLimit, tooManyRequests } from "@/lib/http";
import { CheckError, checkSchema, runCheck } from "@/lib/checks/run";
import { savedChecks } from "@/lib/saved-checks";

export const dynamic = "force-dynamic";
/** AI reading, board searches and page reads share a 45-second deadline per check; this leaves headroom. */
export const maxDuration = 90;

/** GET /api/v1/checks: my saved checks, newest first. */
export const GET = handle(async (request: NextRequest) => {
  const user = await reader(request);
  return Response.json({ checks: await savedChecks(user.id) });
});

/** POST /api/v1/checks: the scanner. Signed in (every check needs an account), 60/min per account. */
export const POST = handle(async (request: NextRequest) => {
  const user = await writer(request); // 415 / 403 / 401 before anything else
  const limit = rateLimit(`scan:user:${user.id}`, 60, 60);
  if (!limit.ok) throw new HttpError(tooManyRequests(limit.retryAfter));

  const input = await readBody(request, checkSchema); // 413 / 400 with field errors
  try {
    const result = await runCheck(input, user.id);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CheckError) return jsonError(error.api);
    throw error;
  }
});
