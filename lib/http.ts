// Shared request guards (spec "Security requirements"). Works with both Web
// `Headers` (App Router) and Node's header object (Pages API routes).

export type HeaderSource = Headers | Record<string, string | string[] | undefined>;
type Get = (name: string) => string | undefined;

export function headerGetter(headers: HeaderSource): Get {
  if (headers instanceof Headers) return (name) => headers.get(name) ?? undefined;
  return (name) => {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
}

/** The env vars that decide which origins may send cookie-authenticated writes. */
export type OriginEnv = Readonly<Record<string, string | undefined>>; // reads APP_URL, VERCEL_URL, VERCEL_BRANCH_URL

export type ApiError = {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  retryAfter?: number; // seconds, sent as the Retry-After header on 429
};

export function errorBody(e: ApiError) {
  return { error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } };
}

/** Origins allowed to send cookie-authenticated writes. */
export function allowedOrigins(env: OriginEnv = process.env): Set<string> {
  const origins = new Set<string>();
  if (env.APP_URL) origins.add(new URL(env.APP_URL).origin);
  if (env.VERCEL_URL) origins.add(`https://${env.VERCEL_URL}`);
  if (env.VERCEL_BRANCH_URL) origins.add(`https://${env.VERCEL_BRANCH_URL}`);
  return origins;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * One check for every write (spec "Request checks (CSRF)").
 * - `auth`: signup, login, logout. 403 only when Origin is present and foreign,
 *   or Sec-Fetch-Site is cross-site. Postman and curl send neither and pass.
 * - `write`: cookie-authenticated App Router writes. A Bearer header skips the
 *   origin check (the cookie is ignored then); otherwise the request must be
 *   same-origin, and a missing Origin is refused.
 */
export function checkRequest(
  method: string,
  headers: HeaderSource,
  kind: "auth" | "write",
  env: OriginEnv = process.env,
): ApiError | null {
  if (SAFE_METHODS.has(method.toUpperCase())) return null;
  const get = headerGetter(headers);

  const contentType = (get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { status: 415, code: "unsupported_media_type", message: "Send the body as application/json." };
  }

  const origin = get("origin");
  const site = get("sec-fetch-site");
  const allowed = allowedOrigins(env);
  const forbidden: ApiError = { status: 403, code: "forbidden_origin", message: "Request origin not allowed." };

  if (kind === "auth") {
    if (site === "cross-site") return forbidden;
    if (origin !== undefined && !allowed.has(origin)) return forbidden;
    return null;
  }

  if (get("authorization")) return null;
  if (site === "same-origin") return null;
  if (origin === undefined || !allowed.has(origin)) return forbidden;
  return null;
}

/** x-real-ip, else the first x-forwarded-for entry, else "unknown". */
export function clientIp(headers: HeaderSource): string {
  const get = headerGetter(headers);
  const real = get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

// Best effort on Vercel (instances share no memory); accepted for the demo.
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

export function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): { ok: true } | { ok: false; retryAfter: number } {
  // Sweep expired counters at least once a minute, so an IP address is never kept
  // much past its window (the privacy notice promises at most an hour).
  if (now - lastSweep >= 60_000 || buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true };
  }
  if (bucket.count >= limit) return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  bucket.count += 1;
  return { ok: true };
}

export function tooManyRequests(retryAfter: number): ApiError {
  return { status: 429, code: "rate_limited", message: `Too many attempts. Try again in ${retryAfter} seconds.`, retryAfter };
}
