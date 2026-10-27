// Outbound HTTP for job boards, RDAP and DNS (spec "External APIs"): server only,
// 5-second timeout, no redirects, our user agent. Logs host + path only.

export const USER_AGENT = "JobSeance/0.1";
export const DEFAULT_TIMEOUT_MS = 5000;

export type UpstreamFailure = "not_found" | "timeout" | "bad_status" | "network" | "bad_body";

export class UpstreamError extends Error {
  constructor(
    public readonly kind: UpstreamFailure,
    public readonly status?: number,
  ) {
    super(`upstream ${kind}${status ? ` (${status})` : ""}`);
    this.name = "UpstreamError";
  }
}

export type FetchOptions = {
  timeoutMs?: number;
  accept?: string;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

async function requestJson<T>(method: "GET" | "POST", url: string, body: unknown, opts: FetchOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, accept = "application/json", fetchImpl = fetch } = opts;
  const parsed = new URL(url);
  console.info(`outbound ${method} ${parsed.hostname}${parsed.pathname}`);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      // gzip only: amazon.jobs truncates bodies sent with Node's default encodings (zstd), checked 2026-10-27.
      headers: { "user-agent": USER_AGENT, accept, "accept-encoding": "gzip", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new UpstreamError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
  }
  if (response.status === 404) throw new UpstreamError("not_found", 404);
  if (!response.ok) throw new UpstreamError("bad_status", response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError("bad_body", response.status);
  }
}

export function getJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  return requestJson<T>("GET", url, undefined, opts);
}

/** POST with a JSON body (Workday's career-site search). Same timeout, redirect and logging rules as getJson. */
export function postJson<T = unknown>(url: string, body: unknown, opts: FetchOptions = {}): Promise<T> {
  return requestJson<T>("POST", url, body, opts);
}

/**
 * Status of a HEAD request without following redirects (a constant-built job page URL,
 * never a pasted one). Used where a search miss needs a second source before it counts.
 */
export async function headStatus(url: string, opts: FetchOptions = {}): Promise<number> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = opts;
  const parsed = new URL(url);
  console.info(`outbound HEAD ${parsed.hostname}${parsed.pathname}`);
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      headers: { "user-agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return response.status;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new UpstreamError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
  }
}
