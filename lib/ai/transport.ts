import { z } from "zod";
import { aiMode, type ToolCallResult } from "@/lib/ai/client";
import { LOCATE_PROMPT_VERSION, modelFor, PROMPT_VERSION, RESERVE_MICROS, type AiStep } from "@/lib/ai/config";
import { aiPaused, reserveAiCall, settleAiCall } from "@/lib/ai/budget";
import { cleanExtract, extractCall, MessageExtract, messageCall, PostingExtract } from "@/lib/ai/extract";
import { BoardGuesses, boardsFromHits, guessCall, searchCall, searchHits, validGuesses, type SearchHit } from "@/lib/ai/locate";
import { presenceCall, presenceHits } from "@/lib/ai/presence";
import { pageFrom, readPageCall, type PageRead } from "@/lib/ai/read-page";
import { fixtureKey, readFixture } from "@/lib/ai/replay";
import type { AiFailureReason, AiOutcome } from "@/lib/ai/types";
import type { BoardLink } from "@/lib/lookups/job-url";
import { getDb } from "@/lib/db";

type Env = Readonly<Record<string, string | undefined>>;
type Ctx = { userId: string; signal?: AbortSignal };

// The seam between checks and the AI. Checks call an AiTransport; tests pass a stub,
// USE_FIXTURES=1 replays recorded answers, and only the live transport spends money.

export type AiTransport = {
  /** Reads redacted posting text into lookup keys. */
  extract(redactedText: string, ctx: Ctx): Promise<AiOutcome<PostingExtract>>;
  /** Reads a redacted recruiter message (opt-in). Callers must ground the answer in the original text. */
  extractMessage(redactedText: string, ctx: Ctx): Promise<AiOutcome<MessageExtract>>;
  /** Phase 11: candidate boards for an employer from the model's knowledge (verified by the caller). */
  guessBoards?(employer: string, ctx: Ctx): Promise<AiOutcome<BoardLink[]>>;
  /** Phase 11: candidate boards from a web search limited to the hiring systems' hosts. */
  searchBoards?(employer: string, role: string | null, ctx: Ctx): Promise<AiOutcome<BoardLink[]>>;
  /** Phase 11: search results for a title on a directory company's own careers hosts. */
  presence?(title: string, hosts: string[], ctx: Ctx): Promise<AiOutcome<SearchHit[]>>;
  /** Phase 11: one job page on an allowlisted careers host, read by Anthropic's fetch tool. */
  readPage?(url: string, host: string, ctx: Ctx): Promise<AiOutcome<PageRead>>;
};

const off = async () => ({ ok: false as const, reason: "off" as const });

export const offTransport: AiTransport = {
  extract: off,
  extractMessage: off,
  guessBoards: off,
  searchBoards: off,
  presence: off,
  readPage: off,
};

// ---- Replay -----------------------------------------------------------------------

const Hits = z.strictObject({ hits: z.array(z.strictObject({ url: z.string().max(2048), title: z.string().max(300), pageAge: z.string().max(60).nullable() })).max(20) });
const Page = z.strictObject({
  isJobPosting: z.boolean(),
  title: z.string().max(200).nullable(),
  location: z.string().max(120).nullable(),
  postedText: z.string().max(80).nullable(),
  pageText: z.string().max(20_000),
  url: z.string().max(2048),
  retrievedAt: z.string().max(40).nullable(),
});

export function replayTransport(env: Env = process.env): AiTransport {
  async function replay<S extends z.ZodType, T>(step: string, version: string, model: string, input: string, schema: S, map: (v: z.infer<S>) => T): Promise<AiOutcome<T>> {
    const found = await readFixture(step, fixtureKey(step, version, model, input), input);
    if (!found) return { ok: false, reason: "no_fixture" };
    const parsed = schema.safeParse(found.value);
    return parsed.success ? { ok: true, value: map(parsed.data), mode: "replay", model: found.model } : { ok: false, reason: "invalid" };
  }
  const guess = modelFor("guess", env);
  const locate = modelFor("locate", env);
  return {
    extract: (text) => replay("extract", PROMPT_VERSION, modelFor("extract", env), text, PostingExtract, cleanExtract),
    extractMessage: (text) => replay("extract_message", PROMPT_VERSION, modelFor("extract", env), text, MessageExtract, (v) => v),
    guessBoards: (employer) => replay("guess", LOCATE_PROMPT_VERSION, guess, employer, BoardGuesses, validGuesses),
    searchBoards: (employer, role) => replay("search", LOCATE_PROMPT_VERSION, locate, `${employer}\n${role ?? ""}`, Hits, (v) => boardsFromHits(v.hits)),
    presence: (title, hosts) => replay("presence", LOCATE_PROMPT_VERSION, locate, `${title}\n${hosts.join(",")}`, Hits, (v) => v.hits),
    readPage: (url) => replay("page", LOCATE_PROMPT_VERSION, locate, url, Page, (v) => v),
  };
}

// ---- Live -------------------------------------------------------------------------

/** The value of a successful structured call (`toOutcome` only runs when the call succeeded). */
const okValue = <T>(r: unknown) => (r as { value: T }).value;

type Metered = { ok: boolean; reason?: AiFailureReason; inputTokens: number; outputTokens: number; micros: number; searches?: number; fetches?: number };

export function liveTransport(env: Env = process.env, db = getDb()): AiTransport {
  /** Reserve budget, call, then settle the real cost. Over budget is a reason, never an error. */
  async function metered<R extends Metered, T>(
    { userId, step, reserve, tool }: { userId: string; step: AiStep; reserve: number; tool: boolean },
    run: (model: string) => Promise<R>,
    toOutcome: (result: R) => AiOutcome<T> | { ok: true; value: T },
  ): Promise<AiOutcome<T>> {
    const model = modelFor(step, env);
    const reservation = await reserveAiCall(db, { userId, micros: reserve, tool }).catch(() => ({ ok: false }) as const);
    if (!reservation.ok) return { ok: false, reason: "budget" };
    const result = await run(model);
    const out = result.ok ? toOutcome(result) : ({ ok: false, reason: result.reason ?? "error" } as const);
    await settleAiCall(db, {
      reservedMicros: reserve,
      actualMicros: result.micros,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      searches: result.searches ?? 0,
      fetches: result.fetches ?? 0,
      outcome: out.ok ? "ok" : out.reason,
    });
    return out.ok ? { ok: true, value: out.value, mode: "live", model } : out;
  }
  const value = <T>(v: T) => ({ ok: true as const, value: v });
  return {
    extract: (text, { userId, signal }) =>
      metered({ userId, step: "extract", reserve: RESERVE_MICROS.extract, tool: false }, (m) => extractCall(text, m, signal), (r) => value(cleanExtract(okValue<PostingExtract>(r)))),
    extractMessage: (text, { userId, signal }) =>
      metered({ userId, step: "extract", reserve: RESERVE_MICROS.extract, tool: false }, (m) => messageCall(text, m, signal), (r) => value(okValue<MessageExtract>(r))),
    guessBoards: (employer, { userId, signal }) =>
      metered({ userId, step: "guess", reserve: RESERVE_MICROS.guess, tool: false }, (m) => guessCall(employer, m, signal), (r) => value(validGuesses(okValue<BoardGuesses>(r)))),
    searchBoards: (employer, role, { userId, signal }) =>
      metered({ userId, step: "locate", reserve: RESERVE_MICROS.search, tool: true }, (m) => searchCall(employer, role, m, signal), (r: ToolCallResult) => value(boardsFromHits(searchHits(r.content)))),
    presence: (title, hosts, { userId, signal }) =>
      metered({ userId, step: "locate", reserve: RESERVE_MICROS.presence, tool: true }, (m) => presenceCall(title, hosts, m, signal), (r: ToolCallResult) => value(presenceHits(r.content, hosts))),
    readPage: (url, host, { userId, signal }) =>
      metered({ userId, step: "locate", reserve: RESERVE_MICROS.page, tool: true }, (m) => readPageCall(url, host, m, signal), (r: ToolCallResult) => {
        const page = pageFrom(r.content, host);
        return page.ok ? value(page.value) : { ok: false as const, reason: page.reason };
      }),
  };
}

/** The transport for this request: replay, live, or off (no key, AI_MODE=off, admin pause). */
export async function currentTransport(env: Env = process.env): Promise<AiTransport> {
  const first = aiMode(env);
  if (first === "replay") return replayTransport(env);
  if (first === "off") return offTransport;
  const db = getDb();
  return aiMode(env, await aiPaused(db)) === "live" ? liveTransport(env, db) : offTransport;
}
