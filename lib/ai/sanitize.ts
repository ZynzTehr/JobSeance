import { redact } from "@/lib/redact";

// What leaves our server for an AI call: redacted text only. Scoring always runs
// on the original text in memory (the S-PII-EARLY rule would match "[ssn]").

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;

/** Job-site page chrome that carries no posting facts (and sometimes the viewer's name). */
const CHROME_LINE = /^(easy apply|apply|save|saved|share|report this job|show more|show less|see more|see less|promoted|be an early applicant|.*your profile matches.*|.*people clicked apply.*|.*applicants?\b.*\bago\b.*|.*\bresponses? managed off linkedin\b.*)$/i;

export const AI_TEXT_MAX = 20_000;

/** Emails → [email]@domain, phones, SSN-like and long digit runs masked, links → [link]@host, chrome dropped. */
export function redactForAi(text: string): string {
  const withoutLinks = text.replace(URL_RE, (url) => {
    try {
      return `[link]@${new URL(url).hostname}`;
    } catch {
      return "[link]";
    }
  });
  const lines = redact(withoutLinks)
    .replace(CONTROL_RE, "")
    .split(/\r?\n/)
    .filter((line) => !CHROME_LINE.test(line.trim()));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, AI_TEXT_MAX);
}

/** Registrable-looking domains of email addresses in the ORIGINAL text (deterministic, never from AI output). */
export function emailDomains(text: string, max = 3): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
    seen.add(m[1].toLowerCase().replace(/\.$/, ""));
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Every http(s) URL in the original text, for deterministic ATS-link parsing. */
export function urlsIn(text: string, max = 20): string[] {
  return [...text.matchAll(URL_RE)].slice(0, max).map((m) => m[0].replace(/[.,;:]+$/, ""));
}
