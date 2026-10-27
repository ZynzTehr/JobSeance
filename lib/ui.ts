// Browser-side helpers shared by the pages: same-origin JSON calls to /api/v1
// and display formatting. Safe to import from client components.

export type BandValue = "LOW" | "CAUTION" | "HIGH" | "NOT_ENOUGH_DATA";

export const BAND_LABEL: Record<BandValue, string> = {
  LOW: "Low",
  CAUTION: "Caution",
  HIGH: "High",
  NOT_ENOUGH_DATA: "Not enough data",
};

export const OUTCOME_LABEL = {
  APPLIED: "Applied",
  INTERVIEWING: "Interviewing",
  NO_RESPONSE: "No response",
  REJECTED: "Rejected",
  ROLE_CLOSED: "Role closed",
  OFFER: "Offer",
  HIRED: "Hired",
  WITHDREW: "Withdrew",
} as const;
export type OutcomeValue = keyof typeof OUTCOME_LABEL;

export const STAGE_LABEL = { APPLIED: "Applied", INTERVIEWED: "Interviewed" } as const;

export const CHANNEL_LABEL = {
  EMAIL: "Email",
  TEXT: "Text message",
  WHATSAPP: "WhatsApp",
  TELEGRAM: "Telegram",
  LINKEDIN: "LinkedIn",
  OTHER: "Other",
} as const;
export type ChannelValue = keyof typeof CHANNEL_LABEL;

export const ATS_LABEL = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  WORKDAY: "Workday",
  SMARTRECRUITERS: "SmartRecruiters",
  WORKABLE: "Workable",
  RECRUITEE: "Recruitee",
  AMAZON: "amazon.jobs",
  NONE: "No public board",
} as const;

/** Error from an /api/v1 call, carrying the server's message and field errors. */
export class ApiCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Same-origin JSON request (the session cookie rides along). Throws ApiCallError. */
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiCallError("Network error. Check your connection and try again.", 0);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiCallError(error?.message ?? "Something went wrong. Try again.", response.status, error?.fields);
  }
  return data as T;
}

const UTC_TIME = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
const UTC_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 15, 2026, 23:13 UTC": fixed to UTC so server and browser render the same text. */
export const checkedAt = (iso: string | Date) => {
  const d = new Date(iso);
  return `${UTC_DAY.format(d)}, ${UTC_TIME.format(d)} UTC`;
};

export const shortDate = (iso: string | Date | null | undefined) => (iso ? UTC_DAY.format(new Date(iso)) : "—");

/** yyyy-mm-dd for <input type="date">. */
export const dateInput = (iso: string | Date | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
