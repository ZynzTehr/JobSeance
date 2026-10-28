import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { costMicros } from "@/lib/ai/config";
import type { AiFailureReason, AiMode } from "@/lib/ai/types";

// The only place that talks to the Anthropic API. Server-only, lazily built, no
// retries (one deadline per check), and every failure comes back as a reason.

type Env = Readonly<Record<string, string | undefined>>;

/** Replay when USE_FIXTURES=1, off when AI_MODE=off or there's no key, live otherwise. */
export function aiMode(env: Env = process.env, paused = false): AiMode {
  if (env.USE_FIXTURES === "1") return "replay";
  if (env.AI_MODE?.trim().toLowerCase() === "off" || paused) return "off";
  return env.ANTHROPIC_API_KEY?.trim() ? "live" : "off";
}

let client: Anthropic | null = null;

/** Built on first use with the explicit key, so a shell profile or other credential is never picked up. */
export function getAnthropic(env: Env = process.env): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
}

export type StructuredCall<S extends z.ZodType> = {
  step: string;
  model: string;
  system: string;
  user: string;
  schema: S;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type StructuredResult<T> =
  | { ok: true; value: T; inputTokens: number; outputTokens: number; micros: number }
  | { ok: false; reason: AiFailureReason; inputTokens: number; outputTokens: number; micros: number };

/** One structured-output request. Logs numbers only: never the prompt or the answer. */
export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>, anthropic: Anthropic = getAnthropic()): Promise<StructuredResult<z.infer<S>>> {
  const started = Date.now();
  const signal = call.signal ? AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs)]) : AbortSignal.timeout(call.timeoutMs);
  let inputTokens = 0;
  let outputTokens = 0;
  let stop = "none";
  let err = "";
  let result: StructuredResult<z.infer<S>>;
  try {
    const message = await anthropic.messages.parse(
      {
        model: call.model,
        max_tokens: call.maxTokens,
        system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: call.user }],
        output_config: { effort: "low", format: zodOutputFormat(call.schema) },
      },
      { signal, timeout: call.timeoutMs },
    );
    inputTokens = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    outputTokens = message.usage.output_tokens;
    stop = message.stop_reason ?? "none";
    const micros = costMicros(call.model, inputTokens, outputTokens);
    if (message.stop_reason === "refusal") result = { ok: false, reason: "refusal", inputTokens, outputTokens, micros };
    else if (message.stop_reason === "max_tokens") result = { ok: false, reason: "max_tokens", inputTokens, outputTokens, micros };
    else if (message.parsed_output == null) result = { ok: false, reason: "invalid", inputTokens, outputTokens, micros };
    else {
      const checked = call.schema.safeParse(message.parsed_output);
      result = checked.success
        ? { ok: true, value: checked.data, inputTokens, outputTokens, micros }
        : { ok: false, reason: "invalid", inputTokens, outputTokens, micros };
    }
  } catch (error) {
    const timedOut = signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError;
    err = error instanceof Anthropic.APIError ? `${error.constructor.name}:${error.status ?? ""}` : (error as Error)?.name ?? "Error";
    result = { ok: false, reason: timedOut ? "timeout" : error instanceof Anthropic.RateLimitError ? "budget" : "error", inputTokens, outputTokens, micros: 0 };
  }
  console.info(
    `ai ${call.step} model=${call.model} mode=live in=${inputTokens} out=${outputTokens} ms=${Date.now() - started} stop=${stop} outcome=${result.ok ? "ok" : result.reason}${err ? ` err=${err}` : ""}`,
  );
  return result;
}

export type ToolCallInput = {
  step: string;
  model: string;
  system: string;
  user: string;
  /** Server tools only (web_search, web_fetch); there are no client tools to run. */
  tools: Anthropic.Messages.ToolUnion[];
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type ToolCallResult = {
  ok: boolean;
  reason?: AiFailureReason;
  /** Every content block from every turn, so callers read engine results, not the model's prose. */
  content: Anthropic.Messages.ContentBlock[];
  inputTokens: number;
  outputTokens: number;
  searches: number;
  fetches: number;
  micros: number;
};

/**
 * One request with server tools. A paused turn is not resumed: a resume would start a fresh
 * max_uses and could double the searches; the results already returned are enough, since only
 * engine result blocks are read. A refusal, max_tokens stop or error is a failure: callers then
 * use nothing from it. Logs numbers only.
 */
export async function callWithTools(call: ToolCallInput, anthropic: Anthropic = getAnthropic()): Promise<ToolCallResult> {
  const started = Date.now();
  const signal = call.signal ? AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs)]) : AbortSignal.timeout(call.timeoutMs);
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: call.user }];
  const content: Anthropic.Messages.ContentBlock[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  let fetches = 0;
  let stop = "none";
  let err = "";
  let reason: AiFailureReason | undefined;
  try {
    {
      const message = await anthropic.messages.create(
        {
          model: call.model,
          max_tokens: call.maxTokens,
          system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
          messages,
          tools: call.tools,
          output_config: { effort: "low" },
        },
        { signal, timeout: call.timeoutMs },
      );
      inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
      outputTokens += message.usage.output_tokens;
      searches += message.usage.server_tool_use?.web_search_requests ?? 0;
      fetches += message.usage.server_tool_use?.web_fetch_requests ?? 0;
      content.push(...message.content);
      stop = message.stop_reason ?? "none";
    }
    if (stop === "refusal") reason = "refusal";
    else if (stop === "max_tokens") reason = "max_tokens";
  } catch (error) {
    const timedOut = signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError;
    err = error instanceof Anthropic.APIError ? `${error.constructor.name}:${error.status ?? ""}` : (error as Error)?.name ?? "Error";
    reason = timedOut ? "timeout" : error instanceof Anthropic.RateLimitError ? "budget" : "error";
  }
  const micros = costMicros(call.model, inputTokens, outputTokens, searches);
  console.info(
    `ai ${call.step} model=${call.model} mode=live in=${inputTokens} out=${outputTokens} searches=${searches} fetches=${fetches} ms=${Date.now() - started} stop=${stop} outcome=${reason ?? "ok"}${err ? ` err=${err}` : ""}`,
  );
  return { ok: !reason, ...(reason ? { reason } : {}), content, inputTokens, outputTokens, searches, fetches, micros };
}
