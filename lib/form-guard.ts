// Field names and timing for the form bot guard, shared by the forms and the
// server check (lib/bot-guard.ts). No Node APIs, so the browser can import it.

/** The decoy field. People never see it; scripts that fill every input do. */
export const HONEYPOT_FIELD = "fax";
/** The signed token the server puts in the page when it renders the form. */
export const FORM_TOKEN_FIELD = "formToken";
/** Lets Postman, newman and the e2e tests skip the token and BotID with a shared secret. */
export const AUTOMATION_HEADER = "x-automation-key";

/** A form sent sooner than this after the page rendered came from a script. */
export const MIN_FORM_MS = 2_000;
/** Older tokens are refused; the form asks for a reload. */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

export type FormPurpose = "auth" | "flag";

/**
 * Resolves once the form has been on screen for MIN_FORM_MS. Counted from when
 * the form mounted, which is always after the server signed the token, so a
 * fast person (or a password manager) waits instead of seeing an error.
 */
export function waitForMinAge(mountedAt: number, now: number = performance.now()): Promise<void> {
  const remaining = mountedAt + MIN_FORM_MS + 100 - now;
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

