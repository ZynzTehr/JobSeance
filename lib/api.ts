import type { NextRequest } from "next/server";
import type { z } from "zod";
import { jsonError, requireUser, requireUserForWrite, unauthorized } from "@/lib/auth/require-user";
import type { PublicUser } from "@/lib/auth/session";
import { checkRequest, clientIp, rateLimit, tooManyRequests, type ApiError } from "@/lib/http";

// Shared plumbing for the /api/v1 CRUD handlers: bounded JSON bodies, Zod
// validation with field errors, owner checks and per-user/IP write limits.

export const MAX_BODY_BYTES = 100_000;

export class HttpError extends Error {
  constructor(readonly api: ApiError) {
    super(api.message);
  }
}

export const notFound = (what = "That record") => new HttpError({ status: 404, code: "not_found", message: `${what} wasn't found.` });
export const forbidden = () => new HttpError({ status: 403, code: "forbidden", message: "You can only change your own records." });

/** Turns Zod issues into `{ field: message }`, naming unknown keys. */
export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) fields[key] = "Unknown field.";
    else fields[issue.path.join(".") || "body"] = issue.message;
  }
  return fields;
}

/** Reads a JSON body (≤ 100 KB) and validates it. Throws HttpError 413/400. */
export async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const tooLarge = new HttpError({ status: 413, code: "payload_too_large", message: "Keep the request under 100 KB." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw tooLarge;
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw tooLarge;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError({ status: 400, code: "invalid_json", message: "The body isn't valid JSON." });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError({ status: 400, code: "validation_failed", message: "Check the highlighted fields.", fields: zodFields(parsed.error) });
  }
  return parsed.data;
}

/** Validates query parameters the same way. */
export function readQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.infer<S> {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    throw new HttpError({ status: 400, code: "validation_failed", message: "Check the query parameters.", fields: zodFields(parsed.error) });
  }
  return parsed.data;
}

/** "Report and flag submissions: 20 per hour per user or IP." */
export function limitSubmissions(request: NextRequest, user: PublicUser | null, bucket: string) {
  const key = user ? `${bucket}:user:${user.id}` : `${bucket}:ip:${clientIp(request.headers)}`;
  const result = rateLimit(key, 20, 60 * 60);
  if (!result.ok) throw new HttpError(tooManyRequests(result.retryAfter));
}

export function assertOwner(record: { userId: string | null } | null, user: PublicUser, what?: string) {
  if (!record) throw notFound(what);
  if (record.userId !== user.id) throw forbidden();
}

/** Wraps a handler so thrown HttpErrors (and Responses) become the reply. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.api);
      if (error instanceof Response) return error;
      throw error;
    }
  };
}

/** Signed-in user for a write (content-type + origin checks first), or throws 415/403/401. */
export async function writer(request: NextRequest): Promise<PublicUser> {
  const result = await requireUserForWrite(request);
  if (result instanceof Response) throw result;
  return result;
}

/** Signed-in user for a read, or throws 401. */
export async function reader(request: NextRequest): Promise<PublicUser> {
  const user = await requireUser(request).catch(() => null);
  if (!user) throw unauthorized();
  return user;
}

/** Optional user for public writes (flags): JSON + origin rules of auth routes, cookie or Bearer if present. */
export async function optionalWriter(request: NextRequest): Promise<PublicUser | null> {
  const problem = checkRequest(request.method, request.headers, "auth");
  if (problem) throw new HttpError(problem);
  return requireUser(request).catch(() => null);
}

/** Trims, collapses spaces and lowercases a role title before the unique check. */
export const normalizeRole = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
