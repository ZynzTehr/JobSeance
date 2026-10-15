import type { NextRequest } from "next/server";
import { getPassport } from "@/lib/auth/passport";
import type { PublicUser } from "@/lib/auth/session";
import { checkRequest, errorBody, type ApiError } from "@/lib/http";

/**
 * Resolves the signed-in user for App Router handlers via passport-jwt.
 * Passport wants a Node-style req, so build a plain one (never pass Web Headers).
 */
export function requireUser(request: NextRequest): Promise<PublicUser | null> {
  const req = {
    headers: Object.fromEntries(request.headers),
    cookies: Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value])),
  };
  return new Promise((resolve, reject) => {
    getPassport().authenticate("jwt", { session: false }, (error: unknown, user: PublicUser | false) =>
      error ? reject(error) : resolve(user || null),
    )(req, {}, reject);
  });
}

export function jsonError(e: ApiError): Response {
  const headers = e.retryAfter !== undefined ? { "Retry-After": String(e.retryAfter) } : undefined;
  return Response.json(errorBody(e), { status: e.status, headers });
}

export const unauthorized = () =>
  jsonError({ status: 401, code: "unauthorized", message: "Sign in to continue." });

/** For App Router writes: CSRF/content-type check, then the user. Returns a Response to send on failure. */
export async function requireUserForWrite(request: NextRequest): Promise<PublicUser | Response> {
  const problem = checkRequest(request.method, request.headers, "write");
  if (problem) return jsonError(problem);
  return (await requireUser(request)) ?? unauthorized();
}
