// AI settings in one place: models, prices for spend estimates, timeouts and caps.
// The AI only gathers facts; scores come from lib/scoring/* (spec: no LLM verdict).

export const PROMPT_VERSION = "2026-10-27.1";

/** Default models. AI_MODEL overrides extraction; Opus is deliberately not used (cost). */
export const AI_MODELS = {
  extract: "claude-haiku-5-5",
} as const;

/** USD per million tokens, for spend estimates only (Anthropic list prices, Oct 2026). */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** Spend reserved before a call (micro-dollars), refined with real token counts after it. */
export const RESERVE_MICROS = { extract: 3_000 } as const;

export const AI_TIMEOUT_MS = { extract: 20_000 } as const;

export const AI_LIMITS = {
  /** Default global daily cap when AI_DAILY_USD is unset. */
  dailyUsd: 2,
  /** AI-assisted checks per account per UTC day. */
  perUserPerDay: 20,
  /** How long the admin pause switch is cached in memory. */
  pauseCacheMs: 60_000,
} as const;

/** Thinking counts toward max_tokens on Claude 5.5 models, so leave room. */
export const MAX_TOKENS = { extract: 4096 } as const;

export function modelFor(step: keyof typeof AI_MODELS, env: Readonly<Record<string, string | undefined>> = process.env): string {
  return (step === "extract" && env.AI_MODEL?.trim()) || AI_MODELS[step];
}

/** Estimated cost in micro-dollars from token counts (unknown models priced as Opus). */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK["claude-opus-5-5"];
  return Math.ceil(inputTokens * p.input + outputTokens * p.output);
}
