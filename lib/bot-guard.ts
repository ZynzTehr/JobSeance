import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { checkBotId } from "botid/server";
import { jwtSecret } from "@/lib/auth/session";
import {
  AUTOMATION_HEADER,
  FORM_TOKEN_FIELD,
  HONEYPOT_FIELD,
  MAX_FORM_AGE_MS,
  MIN_FORM_MS,
  type FormPurpose,
} from "@/lib/form-guard";
import { headerGetter, type ApiError, type HeaderSource } from "@/lib/http";

// Bot checks for the public forms: sign-up, log-in and "Report a problem".
// Three layers, cheapest first: a decoy field, a signed render-time token that
// also enforces a minimum fill time, and Vercel BotID. Rate limits still apply.

export const BOT_ERRORS = {
  rejected: { status: 400, code: "form_rejected", message: "We couldn't accept this form. Reload the page and try again." },
  expired: { status: 400, code: "form_expired", message: "This form has expired. Reload the page and try again." },
  tooFast: { status: 400, code: "form_too_fast", message: "That was sent too quickly. Wait a moment and try again." },
  bot: {
    status: 403,
    code: "bot_detected",
    message: "We couldn't confirm this came from a person using a browser. Reload the page and try again.",
  },
} satisfies Record<string, ApiError>;

function tokenKey(): Buffer {
  // Derived from JWT_SECRET so there's no extra secret to manage; the label keeps the two uses apart.
  return createHmac("sha256", jwtSecret()).update("jobseance/form-token/v1").digest();
}

const sign = (purpose: FormPurpose, issuedAt: number) =>
  createHmac("sha256", tokenKey()).update(`${purpose}.${issuedAt}`).digest("base64url");

/** Signed when the server renders a form. Not secret; it proves the page was loaded first. */
export function issueFormToken(purpose: FormPurpose, now: number = Date.now()): string {
  return `${now}.${sign(purpose, now)}`;
}

export type TokenCheck = "ok" | "invalid" | "too_fast" | "expired";

export function verifyFormToken(token: unknown, purpose: FormPurpose, now: number = Date.now()): TokenCheck {
  if (typeof token !== "string" || token.length > 200) return "invalid";
  const [issued, signature, extra] = token.split(".");
  if (extra !== undefined || !/^\d{13}$/.test(issued ?? "") || !signature) return "invalid";
  const issuedAt = Number(issued);
  const given = Buffer.from(signature, "utf8");
  const expected = Buffer.from(sign(purpose, issuedAt), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  const age = now - issuedAt;
  if (age < MIN_FORM_MS) return "too_fast";
  if (age > MAX_FORM_AGE_MS) return "expired";
  return "ok";
}

/** True only when AUTOMATION_BYPASS_SECRET is set and the header matches it (constant-time). */
export function hasAutomationKey(headers: HeaderSource, secret: string | undefined = process.env.AUTOMATION_BYPASS_SECRET): boolean {
  const given = headerGetter(headers)(AUTOMATION_HEADER);
  if (!secret || Buffer.byteLength(secret, "utf8") < 32 || given === undefined) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Asks Vercel BotID whether a browser sent this request. Only deployments can
 * reach BotID, so local dev, e2e and unit tests always pass. If BotID itself
 * fails we let the request through: the token and rate limits still apply.
 */
export async function looksLikeBot(headers?: IncomingHttpHeaders): Promise<boolean> {
  if (process.env.VERCEL !== "1") return false;
  try {
    const verdict = await checkBotId({ advancedOptions: { headers } });
    return verdict.isBot;
  } catch {
    console.warn("botid_check_failed");
    return false;
  }
}

export type GuardResult = { ok: true; body: unknown } | { ok: false; error: ApiError };

/**
 * Runs the form checks and returns the body without the guard fields, ready for
 * the route's strict schema. `trusted` skips the token and BotID for requests
 * already authenticated with a valid Bearer token (API clients like Postman).
 */
export async function guardForm(
  body: unknown,
  options: { purpose: FormPurpose; headers: HeaderSource; nodeHeaders?: IncomingHttpHeaders; trusted?: boolean; now?: number },
): Promise<GuardResult> {
  // Non-objects go straight to the schema, which answers with its usual 400.
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: true, body };
  const { [HONEYPOT_FIELD]: decoy, [FORM_TOKEN_FIELD]: token, ...rest } = body as Record<string, unknown>;

  if (decoy !== undefined && decoy !== "") return { ok: false, error: BOT_ERRORS.rejected };
  if (options.trusted || hasAutomationKey(options.headers)) return { ok: true, body: rest };

  const check = verifyFormToken(token, options.purpose, options.now);
  if (check === "too_fast") return { ok: false, error: BOT_ERRORS.tooFast };
  if (check !== "ok") return { ok: false, error: BOT_ERRORS.expired };

  if (await looksLikeBot(options.nodeHeaders)) return { ok: false, error: BOT_ERRORS.bot };
  return { ok: true, body: rest };
}

