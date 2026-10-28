// AI settings in one place: models, prices for spend estimates, timeouts and caps.
// The AI only gathers facts; scores come from lib/scoring/* (spec: no LLM verdict).

export const PROMPT_VERSION = "2026-10-27.1";
/** Prompts for finding boards, presence checks and page reads (phase 11). */
export const LOCATE_PROMPT_VERSION = "2026-10-28.1";
/** Prompt for the shadow-mode warning-sign cues (phase 13). */
export const CUES_PROMPT_VERSION = "2026-10-27.1";

/** Default models. AI_MODEL overrides extraction and guesses, AI_MODEL_LOCATE the web tools. Opus is deliberately not used (cost). */
export const AI_MODELS = {
  extract: "claude-haiku-5-5",
  guess: "claude-haiku-5-5",
  cues: "claude-haiku-5-5",
  // Web search and fetch with direct callers only; Sonnet 5.5 supports the 20260209 tool versions.
  locate: "claude-sonnet-5-5",
} as const;
export type AiStep = keyof typeof AI_MODELS;

/** USD per million tokens, for spend estimates only (Anthropic list prices, Oct 2026). */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};
/** Web search: $10 per 1,000 searches, in micro-dollars per search. Fetches have no per-use fee. */
export const SEARCH_MICROS = 10_000;

/** The kinds of AI call, each with its own worst case. */
export type CallKind = "extract" | "guess" | "search" | "presence" | "page" | "cues";

/** Most input tokens a call of each kind can send (prompt plus pasted text, search results or a fetched page). */
const INPUT_CEILING: Record<CallKind, number> = { extract: 8_000, guess: 1_000, search: 25_000, presence: 20_000, page: 15_000, cues: 4_000 };

/**
 * Spend reserved before a call: its worst case for the model actually used (output limit,
 * input ceiling, search fees), so a call can't push the day past the cap. Refined to the real
 * cost when the call settles.
 */
export function reserveMicros(kind: CallKind, model: string): number {
  const searches = kind === "search" ? MAX_USES.search : kind === "presence" ? MAX_USES.presence : 0;
  return costMicros(model, INPUT_CEILING[kind], MAX_TOKENS[kind], searches);
}

export const AI_TIMEOUT_MS = { extract: 20_000, guess: 10_000, search: 30_000, presence: 25_000, page: 25_000, cues: 10_000 } as const;

export const AI_LIMITS = {
  /** Default global daily cap when AI_DAILY_USD is unset. */
  dailyUsd: 2,
  /** AI-assisted checks per account per UTC day. */
  perUserPerDay: 20,
  /** Web-search and page-read calls per account per UTC day (each also counts as an AI call; a search call runs at most 3 searches). */
  toolsPerUserPerDay: 5,
  /** Share of the daily cap web searches and page reads may use, so reading pasted postings stays available. */
  toolShareOfCap: 0.6,
  /** How long the admin pause switch is cached in memory. */
  pauseCacheMs: 60_000,
} as const;

/** Thinking counts toward max_tokens on Claude 5.5 models, so leave room. */
export const MAX_TOKENS = { extract: 4096, guess: 2048, search: 8000, presence: 6000, page: 6000, cues: 4096 } as const;

/** Max web searches per call; page reads fetch one page. */
export const MAX_USES = { search: 3, presence: 2, page: 1 } as const;

export function modelFor(step: AiStep, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (step === "locate") return env.AI_MODEL_LOCATE?.trim() || AI_MODELS.locate;
  return env.AI_MODEL?.trim() || AI_MODELS[step];
}

/** Estimated cost in micro-dollars from token counts (unknown models priced as Opus), plus search fees. */
export function costMicros(model: string, inputTokens: number, outputTokens: number, searches = 0): number {
  const p = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK["claude-opus-5-5"];
  return Math.ceil(inputTokens * p.input + outputTokens * p.output) + searches * SEARCH_MICROS;
}
