// Server-side redaction for opted-in scam-report excerpts (spec "Pasted
// messages and personal data"). Automated redaction misses things, so stored
// excerpts are never shown publicly.

const EXCERPT_MAX = 500;

export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g, "[email]@$1")
    .replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[ssn]")
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\d{6,}/g, "[number]");
}

/** Redacted, whitespace-tidied, at most 500 characters. */
export function excerpt(text: string): string {
  const tidy = redact(text).replace(/\s+/g, " ").trim();
  return tidy.length > EXCERPT_MAX ? `${tidy.slice(0, EXCERPT_MAX - 1)}…` : tidy;
}
