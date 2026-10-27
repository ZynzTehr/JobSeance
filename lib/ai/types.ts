// Shared AI result types. Every failure is a reason, never a thrown error, so a
// check can always finish with "couldn't verify" (0 points).

export type AiMode = "off" | "replay" | "live";

export type AiFailureReason =
  | "off" // AI_MODE=off, no key, or paused by an admin
  | "budget" // daily global or per-account cap reached
  | "timeout"
  | "refusal" // stop_reason "refusal"
  | "max_tokens" // ran out of tokens before the answer
  | "invalid" // the answer didn't match the schema
  | "error" // API or network error
  | "no_fixture"; // replay mode without a recorded answer

export type AiOutcome<T> =
  | { ok: true; value: T; mode: "live" | "replay"; model: string }
  | { ok: false; reason: AiFailureReason };

export const AI_REASON_TEXT: Record<AiFailureReason, string> = {
  off: "AI reading is turned off right now",
  budget: "today's AI limit has been reached",
  timeout: "the AI step took too long",
  refusal: "the AI model declined to read this text",
  max_tokens: "the AI answer was cut off",
  invalid: "the AI answer was incomplete",
  error: "the AI service didn't respond",
  no_fixture: "no saved AI answer exists for this text",
};
