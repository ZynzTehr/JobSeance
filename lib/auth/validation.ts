import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MAX_BYTES, PASSWORD_MIN, passwordRules } from "./password-rules";

// Spec "Usernames" and "Security requirements". Pure functions, no I/O.

export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "api", "auth", "login", "logout", "signup",
  "dashboard", "settings", "me", "support", "help", "jobseance", "null", "undefined",
]);

export { PASSWORD_MAX, PASSWORD_MAX_BYTES, PASSWORD_MIN };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** NFC-normalizes and checks length and character mix. Never trims. Returns the password to hash, or an error message. */
export function checkPassword(raw: string): { ok: true; password: string } | { ok: false; message: string } {
  const password = raw.normalize("NFC");
  const length = [...password].length;
  if (length < PASSWORD_MIN) return { ok: false, message: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (length > PASSWORD_MAX) return { ok: false, message: `Password must be at most ${PASSWORD_MAX} characters.` };
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return { ok: false, message: "Password is too long once encoded. Use fewer special characters." };
  }
  const missing = passwordRules(password)
    .filter((r) => r.id !== "length" && !r.met)
    .map((r) => ({ upper: "an uppercase letter", number: "a number", symbol: "a symbol" })[r.id as "upper" | "number" | "symbol"]);
  if (missing.length) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    return { ok: false, message: `Password needs ${list}.` };
  }
  return { ok: true, password };
}

const username = z
  .string()
  .max(100)
  .transform(normalizeUsername)
  .refine((u) => /^[a-z0-9_]{3,20}$/.test(u), "Username must be 3–20 letters, numbers or underscores.")
  .refine((u) => !RESERVED_USERNAMES.has(u), "That username is reserved.");

export const signupSchema = z.strictObject({
  username,
  email: z.string().transform(normalizeEmail).pipe(z.email("Enter a valid email.").max(254)),
  password: z.string().max(1000),
});

export const loginSchema = z.strictObject({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(1000),
});

export type FieldErrors = Record<string, string>;

/** First message per top-level field, for the `{ error: { fields } }` shape. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "body");
    fields[key] ??= issue.message;
  }
  return fields;
}
