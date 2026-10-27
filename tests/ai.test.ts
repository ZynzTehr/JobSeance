import { afterEach, describe, expect, it, vi } from "vitest";
import { aiMode, callStructured } from "@/lib/ai/client";
import { aiPaused, dailyCapMicros, reserveAiCall, resetPauseCache, settleAiCall } from "@/lib/ai/budget";
import { costMicros, modelFor } from "@/lib/ai/config";
import { cleanExtract, PostingExtract } from "@/lib/ai/extract";
import { fixtureKey, readFixture } from "@/lib/ai/replay";
import { emailDomains, redactForAi, urlsIn } from "@/lib/ai/sanitize";
import { replayTransport } from "@/lib/ai/transport";
import { DEMO_POSTING_BRAMBLECLOUD, DEMO_POSTING_DISCORD } from "@/lib/demo-examples";
import { z } from "zod";

const NOW = new Date("2026-10-27T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());

// ---- Mode and models ------------------------------------------------------------

describe("aiMode", () => {
  it("is off without a key, live with one, off when AI_MODE=off or paused", () => {
    expect(aiMode({})).toBe("off");
    expect(aiMode({ ANTHROPIC_API_KEY: "sk-test" })).toBe("live");
    expect(aiMode({ ANTHROPIC_API_KEY: "sk-test", AI_MODE: "off" })).toBe("off");
    expect(aiMode({ ANTHROPIC_API_KEY: "sk-test" }, true)).toBe("off");
  });

  it("replays recorded answers whenever USE_FIXTURES=1, key or not", () => {
    expect(aiMode({ USE_FIXTURES: "1" })).toBe("replay");
    expect(aiMode({ USE_FIXTURES: "1", ANTHROPIC_API_KEY: "sk-test" })).toBe("replay");
  });

  it("defaults to Haiku 5.5 for reading postings, overridable by AI_MODEL", () => {
    expect(modelFor("extract", {})).toBe("claude-haiku-5-5");
    expect(modelFor("extract", { AI_MODEL: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
  });

  it("estimates spend in micro-dollars from list prices", () => {
    expect(costMicros("claude-haiku-5-5", 3_000, 500)).toBe(550); // $0.00055
    expect(costMicros("unknown-model", 1_000, 0)).toBe(4_000); // priced as Opus
  });
});

// ---- Redaction --------------------------------------------------------------------

describe("redactForAi", () => {
  it("masks emails, phones, SSN-like and long numbers, and reduces links to their host", () => {
    const out = redactForAi("Mail jane.doe@acme-careers.com or call (415) 555-0134. SSN 123-45-6789. Apply: https://jobs.lever.co/acme/123?ref=abc 9876543");
    expect(out).toContain("[email]@acme-careers.com");
    expect(out).toContain("[phone]");
    expect(out).toContain("[ssn]");
    expect(out).toContain("[link]@jobs.lever.co");
    expect(out).toContain("[number]");
    expect(out).not.toMatch(/jane\.doe|555-0134|123-45-6789|ref=abc|https?:/);
  });

  it("drops job-site page chrome that can carry the viewer's name", () => {
    const out = redactForAi("Data Analyst\nEasy Apply\nMaria, your profile matches this job\nWe build tools.");
    expect(out).toBe("Data Analyst\nWe build tools.");
  });

  it("finds email domains and URLs in the original text deterministically", () => {
    expect(emailDomains("a@x.com b@Y.example c@x.com d@z.org e@w.net")).toEqual(["x.com", "y.example", "z.org"]);
    expect(urlsIn("see https://job-boards.greenhouse.io/discord/jobs/8806482002.")).toEqual(["https://job-boards.greenhouse.io/discord/jobs/8806482002"]);
  });
});

// ---- Extraction schema -----------------------------------------------------------------

const extract = (o: Partial<PostingExtract> = {}): PostingExtract => ({
  documentKind: "job_posting",
  employerName: "Discord",
  roleTitle: "Commercial Policy Lead",
  location: null,
  employmentType: null,
  isStaffingAgency: false,
  postedAgoText: null,
  ...o,
});

describe("PostingExtract", () => {
  it("rejects extra keys such as a verdict, and unknown document kinds", () => {
    expect(PostingExtract.safeParse({ ...extract(), verdict: "scam" }).success).toBe(false);
    expect(PostingExtract.safeParse({ ...extract(), documentKind: "scam" }).success).toBe(false);
    expect(PostingExtract.safeParse(extract()).success).toBe(true);
  });

  it("cleans answers: trims, and drops anything that looks like an email or link", () => {
    const e = cleanExtract(extract({ employerName: "  Acme   Inc ", roleTitle: "see https://evil.example", location: "hr@acme.com" }));
    expect(e).toMatchObject({ employerName: "Acme Inc", roleTitle: null, location: null });
  });
});

// ---- Structured calls --------------------------------------------------------------------

const Answer = z.strictObject({ ok: z.boolean() });
const call = { step: "test", model: "claude-haiku-5-5", system: "s", user: "u", schema: Answer, maxTokens: 100, timeoutMs: 50 };
const usage = { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const fakeClient = (parse: (...args: unknown[]) => Promise<unknown>) => ({ messages: { parse } }) as never;

describe("callStructured", () => {
  it("returns the parsed answer with its token counts and cost", async () => {
    const r = await callStructured(call, fakeClient(async () => ({ stop_reason: "end_turn", parsed_output: { ok: true }, usage })));
    expect(r).toEqual({ ok: true, value: { ok: true }, inputTokens: 1_000, outputTokens: 100, micros: 150 });
  });

  it.each([
    ["refusal", { stop_reason: "refusal", parsed_output: null, usage }],
    ["max_tokens", { stop_reason: "max_tokens", parsed_output: null, usage }],
    ["invalid", { stop_reason: "end_turn", parsed_output: null, usage }],
    ["invalid", { stop_reason: "end_turn", parsed_output: { ok: true, verdict: "x" }, usage }],
  ])("maps %s without throwing", async (reason, message) => {
    const r = await callStructured(call, fakeClient(async () => message));
    expect(r).toMatchObject({ ok: false, reason });
  });

  it("a hung API call gives up at the deadline in under a second", async () => {
    const hang = (_p: unknown, opts: { signal: AbortSignal }) =>
      new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const started = Date.now();
    const r = await callStructured(call, fakeClient(hang as never));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("logs numbers only, never the prompt or the answer", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await callStructured({ ...call, user: "SECRET-POSTING-TEXT" }, fakeClient(async () => ({ stop_reason: "end_turn", parsed_output: { ok: true }, usage })));
    const line = String(log.mock.calls.at(-1)?.[0]);
    log.mockRestore();
    expect(line).toMatch(/^ai test model=claude-haiku-5-5 mode=live in=1000 out=100 ms=\d+ stop=end_turn outcome=ok$/);
    expect(line).not.toContain("SECRET");
  });
});

// ---- Budget --------------------------------------------------------------------------

/** In-memory stand-in for the three Prisma models the budget uses. */
function budgetDb(paused = false) {
  const days = new Map<string, Record<string, number>>();
  const users = new Map<string, Record<string, number>>();
  const num = (v: unknown, cur: number) =>
    typeof v === "object" && v ? cur + ((v as { increment?: number }).increment ?? 0) - ((v as { decrement?: number }).decrement ?? 0) : cur;
  const db = {
    aiUsage: {
      upsert: async ({ where }: { where: { day: string } }) => days.set(where.day, days.get(where.day) ?? { spendMicros: 0, calls: 0 }),
      updateMany: async ({ where, data }: { where: { day: string; spendMicros?: { lte: number } }; data: Record<string, unknown> }) => {
        const row = days.get(where.day);
        if (!row || (where.spendMicros && !(row.spendMicros <= where.spendMicros.lte))) return { count: 0 };
        for (const [k, v] of Object.entries(data)) row[k] = num(v, row[k] ?? 0);
        return { count: 1 };
      },
    },
    aiUserUsage: {
      upsert: async ({ where }: { where: { userId_day: { userId: string; day: string } } }) => {
        const key = `${where.userId_day.userId}|${where.userId_day.day}`;
        users.set(key, users.get(key) ?? { calls: 0, toolCalls: 0 });
      },
      updateMany: async ({ where, data }: { where: { userId: string; day: string; calls?: { lt: number }; toolCalls?: { lt: number } }; data: Record<string, unknown> }) => {
        const key = `${where.userId}|${where.day}`;
        const row = users.get(key) ?? { calls: 0, toolCalls: 0 };
        if (where.calls && !(row.calls < where.calls.lt)) return { count: 0 };
        if (where.toolCalls && !(row.toolCalls < where.toolCalls.lt)) return { count: 0 };
        for (const [k, v] of Object.entries(data)) row[k] = num(v, row[k] ?? 0);
        users.set(key, row);
        return { count: 1 };
      },
    },
    setting: { findUnique: async () => (paused ? { key: "aiPaused", value: "1" } : null) },
  };
  return { db: db as never, days, users };
}

describe("AI budget", () => {
  it("reads the daily cap from AI_DAILY_USD, defaulting to $2", () => {
    expect(dailyCapMicros({})).toBe(2_000_000);
    expect(dailyCapMicros({ AI_DAILY_USD: "0.5" })).toBe(500_000);
    expect(dailyCapMicros({ AI_DAILY_USD: "nonsense" })).toBe(2_000_000);
  });

  it("stops at the global daily cap", async () => {
    const { db } = budgetDb();
    const reserve = () => reserveAiCall(db, { userId: "u1", micros: 400, now: NOW, capMicros: 1_000, perUser: 100 });
    expect((await reserve()).ok).toBe(true);
    expect((await reserve()).ok).toBe(true);
    expect((await reserve()).ok).toBe(false); // 1,200 > 1,000
  });

  it("stops one account at its daily allowance without spending the global budget", async () => {
    const { db, days } = budgetDb();
    const reserve = (userId: string) => reserveAiCall(db, { userId, micros: 10, now: NOW, capMicros: 1_000_000, perUser: 2 });
    expect((await reserve("u1")).ok).toBe(true);
    expect((await reserve("u1")).ok).toBe(true);
    expect((await reserve("u1")).ok).toBe(false);
    expect(days.get("2026-10-27")).toMatchObject({ spendMicros: 20, calls: 2 }); // the refused call was refunded
    expect((await reserve("u2")).ok).toBe(true);
  });

  it("caps web searches and page reads per account separately from other AI calls", async () => {
    const { db, users } = budgetDb();
    const tool = () => reserveAiCall(db, { userId: "u1", micros: 10, tool: true, now: NOW, capMicros: 1_000_000, perUser: 20, toolsPerUser: 2 });
    expect((await tool()).ok).toBe(true);
    expect((await tool()).ok).toBe(true);
    expect((await tool()).ok).toBe(false);
    // A plain AI call still works for that account.
    expect((await reserveAiCall(db, { userId: "u1", micros: 10, now: NOW, capMicros: 1_000_000, perUser: 20 })).ok).toBe(true);
    expect(users.get("u1|2026-10-27")).toEqual({ calls: 3, toolCalls: 2 });
  });

  it("background calls use the global budget only, never an account's allowance", async () => {
    const { db, users, days } = budgetDb();
    expect((await reserveAiCall(db, { userId: "shadow", micros: 10, skipUser: true, now: NOW, capMicros: 1_000_000, perUser: 0 })).ok).toBe(true);
    expect(users.size).toBe(0);
    expect(days.get("2026-10-27")).toMatchObject({ spendMicros: 10, calls: 1 });
  });

  it("counts searches and fetches when settling", async () => {
    const { db, days } = budgetDb();
    await reserveAiCall(db, { userId: "u1", micros: 80_000, tool: true, now: NOW, capMicros: 1_000_000 });
    await settleAiCall(db, { reservedMicros: 80_000, actualMicros: 42_000, inputTokens: 9_000, outputTokens: 800, searches: 2, fetches: 0, outcome: "ok", now: NOW });
    expect(days.get("2026-10-27")).toMatchObject({ spendMicros: 42_000, searches: 2 });
  });

  it("replaces the estimate with the real cost after the call", async () => {
    const { db, days } = budgetDb();
    await reserveAiCall(db, { userId: "u1", micros: 3_000, now: NOW, capMicros: 1_000_000, perUser: 10 });
    await settleAiCall(db, { reservedMicros: 3_000, actualMicros: 550, inputTokens: 3_000, outputTokens: 500, outcome: "ok", now: NOW });
    expect(days.get("2026-10-27")).toMatchObject({ spendMicros: 550, inputTokens: 3_000, outputTokens: 500 });
  });

  it("honours the admin pause switch", async () => {
    resetPauseCache();
    expect(await aiPaused(budgetDb(true).db, 1)).toBe(true);
    resetPauseCache();
    expect(await aiPaused(budgetDb(false).db, 1)).toBe(false);
    resetPauseCache();
  });
});

// ---- Replay -------------------------------------------------------------------------

describe("replay fixtures", () => {
  it("keys answers by prompt version, model and normalized input", () => {
    expect(fixtureKey("extract", "v1", "m", "A  b")).toBe(fixtureKey("extract", "v1", "m", "a b"));
    expect(fixtureKey("extract", "v1", "m", "a b")).not.toBe(fixtureKey("extract", "v2", "m", "a b"));
  });

  it("finds the demo postings' recorded readings through the manifest, without the network", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const discord = await replayTransport({}).extract(redactForAi(DEMO_POSTING_DISCORD), { userId: "u1" });
    const bramble = await replayTransport({}).extract(redactForAi(DEMO_POSTING_BRAMBLECLOUD), { userId: "u1" });
    expect(discord).toMatchObject({ ok: true, mode: "replay", value: { employerName: "Discord", roleTitle: "Commercial Policy Lead" } });
    expect(bramble).toMatchObject({ ok: true, value: { employerName: "Bramblecloud Software", roleTitle: "Data Analyst" } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("an unknown text has no recorded answer", async () => {
    expect(await readFixture("extract", "extract-0000", "never recorded")).toBeNull();
    expect(await replayTransport({}).extract("never recorded", { userId: "u1" })).toEqual({ ok: false, reason: "no_fixture" });
  });
});
