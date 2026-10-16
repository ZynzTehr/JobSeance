// Password limits, shared by the server check (lib/auth/validation.ts) and the
// sign-up form's live checklist. No Node APIs, so the browser can import it.

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 64;
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes

export type PasswordRule = { id: "min" | "max" | "bytes"; label: string; met: boolean };

/** Counts the way the server does: NFC-normalized, never trimmed, code points for length, UTF-8 bytes. */
export function passwordRules(raw: string): PasswordRule[] {
  const password = raw.normalize("NFC");
  const length = [...password].length;
  const bytes = new TextEncoder().encode(password).length;
  const typed = length > 0;
  return [
    { id: "min", label: `At least ${PASSWORD_MIN} characters`, met: length >= PASSWORD_MIN },
    { id: "max", label: `At most ${PASSWORD_MAX} characters`, met: typed && length <= PASSWORD_MAX },
    { id: "bytes", label: `${PASSWORD_MAX_BYTES} bytes max (emoji use more)`, met: typed && bytes <= PASSWORD_MAX_BYTES },
  ];
}
