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

export async function getJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, accept = "application/json", fetchImpl = fetch } = opts;
  const parsed = new URL(url);
  console.info(`outbound GET ${parsed.hostname}${parsed.pathname}`);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept },
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
