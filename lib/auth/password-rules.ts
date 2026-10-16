// Password rules, shared by the server check (lib/auth/validation.ts) and the
// sign-up form's live checklist. No Node APIs, so the browser can import it.
// The common consumer pattern: 8–64 characters with an uppercase letter, a number and a symbol.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes

export type PasswordRule = { id: "length" | "upper" | "number" | "symbol"; label: string; met: boolean };

/**
 * Counts the way the server does: NFC-normalized, never trimmed, code points
 * for length. The 72-byte bcrypt limit is folded into the length rule; it
 * only bites with many emoji or accented letters.
 */
export function passwordRules(raw: string): PasswordRule[] {
  const password = raw.normalize("NFC");
  const length = [...password].length;
  const bytes = new TextEncoder().encode(password).length;
  return [
    {
      id: "length",
      label: `${PASSWORD_MIN} to ${PASSWORD_MAX} characters`,
      met: length >= PASSWORD_MIN && length <= PASSWORD_MAX && bytes <= PASSWORD_MAX_BYTES,
    },
    { id: "upper", label: "An uppercase letter", met: /\p{Lu}/u.test(password) },
    { id: "number", label: "A number", met: /\p{Nd}/u.test(password) },
    // Anything that isn't a letter, a digit or whitespace: ! ? # @ - _ . and so on.
    { id: "symbol", label: "A symbol (like ! ? # @)", met: /[^\p{L}\p{N}\s]/u.test(password) },
  ];
}
