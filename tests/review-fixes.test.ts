import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { careersHostProblem, dismissDiscovery, officialDomainProblem, pendingDiscoveries, requireAdmin } from "@/lib/admin";
import { CueMatches } from "@/lib/ai/cues";
import { searchCall, searchFailed } from "@/lib/ai/locate";
import { presenceCall } from "@/lib/ai/presence";
import { readPageCall } from "@/lib/ai/read-page";
import { redactForAi } from "@/lib/ai/sanitize";
import { shadowEligible } from "@/lib/ai/shadow";
import { DISCOVERY_PER_HOUR, locator, pageInfoOnly } from "@/lib/checks/run";
import { offTransport } from "@/lib/ai/transport";
import { adapterJob, amazonDate, workdayRequisition } from "@/lib/lookups/adapters";
import { normalizeBoard } from "@/lib/lookups/boards";
import { BOARD_SEARCH_DOMAINS, OTHER_SYSTEM_DOMAINS, parseJobUrl, withJobPath } from "@/lib/lookups/job-url";
import { PARTIAL_STALE_DAYS, syncBoard } from "@/lib/lookups/postings";
import { rateLimit } from "@/lib/http";
import { companyCreate } from "@/lib/schemas";
import type { Score } from "@/lib/scoring/ghost";

// Regression tests for the BMad review of phases 10-13 (one block per fix).

const NOW = new Date("2026-10-28T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());

describe("shadow mode only follows checks whose text Claude already read", () => {
  it("needs a posting Claude read, or a message the user let Claude read", () => {
    const read = { ai: { textSent: true } };
    expect(shadowEligible({ kind: "posting_text" }, read)).toBe(true);
    expect(shadowEligible({ kind: "message", aiRead: true }, read)).toBe(true);
    // A board search or presence check marks AI as used without sending the text.
    expect(shadowEligible({ kind: "posting_text" }, { ai: { textSent: false } })).toBe(false);
    expect(shadowEligible({ kind: "posting_text" }, { ai: null })).toBe(false);
    expect(shadowEligible({ kind: "message", aiRead: false }, read)).toBe(false);
    expect(shadowEligible({ kind: "company_role" }, read)).toBe(false);
  });
});

describe("Workday ids", () => {
  it("drop only a short posting suffix, never a dash inside the requisition number", () => {
    expect(workdayRequisition("jr2022104-1")).toBe("jr2022104");
    expect(workdayRequisition("jr2001234")).toBe("jr2001234");
    expect(workdayRequisition("r-12345")).toBe("r-12345");
    expect(workdayRequisition("jr-0001234")).toBe("jr-0001234");
  });

  it("a job found by searching carries its own path, so its lookup can be confirmed directly", () => {
    const ref = { ats: "WORKDAY" as const, board: "nvidia/NVIDIAExternalCareerSite", host: "nvidia.wd5.myworkdayjobs.com" };
    const url = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Engineer_R-12345";
    expect(withJobPath(ref, url)).toEqual({ ...ref, jobPath: "/job/US-CA-Santa-Clara/Senior-Engineer_R-12345" });
    expect(withJobPath(ref, "https://other.wd5.myworkdayjobs.com/site/job/x/y_R-1")).toEqual(ref); // another tenant: ignored
    expect(withJobPath({ ats: "GREENHOUSE" as const, board: "acme" }, url)).toEqual({ ats: "GREENHOUSE", board: "acme" });
  });

  it("a removed job with a dashed id is confirmed by its own page, searched by its whole number", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      return calls.length === 1 ? Response.json({ total: 0, jobPostings: [] }) : new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const ref = { ats: "WORKDAY" as const, board: "acme/External", host: "acme.wd1.myworkdayjobs.com", jobPath: "/job/Remote/Engineer_R-12345" };
    expect(await adapterJob(ref, "r-12345", { fetchImpl })).toBeNull();
    expect(JSON.parse(calls[0].body!).searchText).toBe("r-12345");
  });
});

describe("failed web searches", () => {
  const result = (content: unknown) => ({ type: "web_search_tool_result", tool_use_id: "s", content });
  it("are failures, not 'nothing found', unless some search still returned results", () => {
    const error = result({ type: "web_search_tool_result_error", error_code: "unavailable" });
    expect(searchFailed([error] as never)).toBe(true);
    expect(searchFailed([error, result([])] as never)).toBe(false);
    expect(searchFailed([result([])] as never)).toBe(false);
    expect(searchFailed([] as never)).toBe(false);
  });
});

describe("unexpected answers from the job APIs", () => {
  it("a missing or non-list body is a bad response, never an empty board", () => {
    for (const ats of ["WORKDAY", "SMARTRECRUITERS", "WORKABLE", "RECRUITEE", "AMAZON", "GREENHOUSE", "ASHBY", "LEVER"] as const) {
      expect(() => normalizeBoard(ats, {}, { board: "acme/site", host: "acme.wd1.myworkdayjobs.com" })).toThrow(expect.objectContaining({ kind: "bad_body" }));
    }
    expect(normalizeBoard("GREENHOUSE", { jobs: [] })).toEqual([]); // a real empty board is still empty
  });

  it("items without a title are skipped instead of crashing the check", () => {
    const jobs = normalizeBoard("WORKABLE", { jobs: [{ shortcode: "ABC123", title: null }, { shortcode: "DEF456", title: "Engineer" }] }, { board: "acme" });
    expect(jobs.map((j) => j.title)).toEqual(["Engineer"]);
    expect(() => normalizeBoard("GREENHOUSE", { jobs: [{ id: 1 }] })).toThrow(expect.objectContaining({ kind: "bad_body" }));
  });

  it("a SmartRecruiters 200 that isn't the posting asked for is a bad response, not a removal", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ message: "something changed" })) as unknown as typeof fetch;
    await expect(adapterJob({ ats: "SMARTRECRUITERS", board: "Acme" }, "744000012345678", { fetchImpl })).rejects.toMatchObject({ kind: "bad_body" });
  });

  it("amazon.jobs dates are read exactly, in UTC, or not at all", () => {
    expect(amazonDate("October 23, 2026")?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(amazonDate("October  3,  2026")?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(amazonDate("February 30, 2026")).toBeNull();
    expect(amazonDate("2026-10-23")).toBeNull();
    expect(amazonDate(undefined)).toBeNull();
  });
});

describe("web tool requests stay inside their allowlists", () => {
  const client = () => {
    const create = vi.fn(async () => ({ stop_reason: "end_turn", content: [], usage: { input_tokens: 1, output_tokens: 1 } }));
    return { anthropic: { messages: { create } } as never, create };
  };
  const tools = (create: ReturnType<typeof vi.fn>) => (create.mock.calls[0] as unknown as [{ tools: unknown[] }])[0].tools;

  it("page reads fetch one page on the allowlisted host only", async () => {
    const { anthropic, create } = client();
    await readPageCall("https://jobs.apple.com/en-us/details/1", "jobs.apple.com", "claude-sonnet-5-5", undefined, anthropic);
    expect(tools(create)).toEqual([expect.objectContaining({ type: "web_fetch_20260209", allowed_domains: ["jobs.apple.com"], max_uses: 1, allowed_callers: ["direct"] })]);
  });

  it("presence checks search the company's careers hosts only, at most twice", async () => {
    const { anthropic, create } = client();
    await presenceCall("Engineer", ["jobs.apple.com"], "claude-sonnet-5-5", undefined, anthropic);
    expect(tools(create)).toEqual([expect.objectContaining({ type: "web_search_20260209", allowed_domains: ["jobs.apple.com"], max_uses: 2 })]);
  });

  it("board searches look on hiring-system sites only, at most three times", async () => {
    const { anthropic, create } = client();
    await searchCall("Acme", null, "claude-sonnet-5-5", undefined, anthropic);
    expect(tools(create)).toEqual([
      expect.objectContaining({ type: "web_search_20260209", allowed_domains: [...BOARD_SEARCH_DOMAINS, ...OTHER_SYSTEM_DOMAINS], max_uses: 3 }),
    ]);
  });

  it("the other-systems search is narrowed to those systems' sites", async () => {
    const { anthropic, create } = client();
    await searchCall("Acme", null, "claude-sonnet-5-5", undefined, anthropic, OTHER_SYSTEM_DOMAINS);
    expect(tools(create)).toEqual([expect.objectContaining({ allowed_domains: [...OTHER_SYSTEM_DOMAINS], max_uses: 3 })]);
  });
});

describe("page reads never reassure", () => {
  const score = (signals: { id: string; points: number }[], band: Score["band"] = "LOW"): Score => ({
    score: signals.reduce((s, x) => s + x.points, 0),
    band,
    signals: signals.map((s) => ({ ...s, status: "found" as const, fact: "f", source: "s", checkedAt: NOW.toISOString() })),
  });

  it("phrase hits from a page become information, and the band says there isn't enough data", () => {
    const out = pageInfoOnly(score([{ id: "S-PAY-TO-WORK", points: 30 }], "CAUTION"), true);
    expect(out).toMatchObject({ score: null, band: "NOT_ENOUGH_DATA" });
    expect(out.signals[0]).toMatchObject({ points: 0, kind: "info" });
  });

  it("community reports still count", () => {
    const out = pageInfoOnly(score([{ id: "S-PAY-TO-WORK", points: 30 }, { id: "G-COMMUNITY", points: 10 }], "CAUTION"), true);
    expect(out).toMatchObject({ score: 10, band: "LOW" });
  });

  it("a page that couldn't be read is never 'Low'", () => {
    expect(pageInfoOnly(score([]), false)).toMatchObject({ score: null, band: "NOT_ENOUGH_DATA" });
  });
});

describe("search-system boards on company pages", () => {
  const fakeDb = () => {
    const ops: { op: string; args: unknown }[] = [];
    const posting = {
      createMany: (args: unknown) => (ops.push({ op: "createMany", args }), "c"),
      updateMany: (args: unknown) => (ops.push({ op: "updateMany", args }), "u"),
    };
    return { ops, db: { posting, $transaction: async (list: unknown[]) => list } as never };
  };
  const job = { externalId: "jr1", title: "Engineer", location: null, url: "https://x", postedAt: null, internalJobId: null, description: null };
  const ref = { ats: "WORKDAY" as const, board: "acme/site", host: "acme.wd1.myworkdayjobs.com" };

  it("a partial list never marks a job removed; jobs it hasn't shown for a week drop to unknown", async () => {
    const { ops, db } = fakeDb();
    await syncBoard({ id: "c1" }, ref, [job], [], NOW, true, db);
    const stale = ops.filter((o) => o.op === "updateMany").map((o) => o.args as { where: Record<string, unknown>; data: { state: string } });
    expect(stale.some((a) => a.data.state === "NOT_FOUND")).toBe(false);
    expect(stale).toContainEqual({
      where: { ats: "WORKDAY", board: "acme/site", state: "LIVE", externalId: { notIn: ["jr1"] }, lastSeenAt: { lt: new Date(NOW.getTime() - PARTIAL_STALE_DAYS * 86_400_000) } },
      data: { state: "UNKNOWN" },
    });
  });

  it("a full board still marks missing jobs removed", async () => {
    const { ops, db } = fakeDb();
    await syncBoard({ id: "c1" }, { ats: "GREENHOUSE", board: "acme" }, [job], [], NOW, false, db);
    expect(ops.some((o) => o.op === "updateMany" && (o.args as { data: { state: string } }).data.state === "NOT_FOUND")).toBe(true);
  });
});

describe("admin hardening", () => {
  it("signed-out requests to admin endpoints get the same 404 as everyone else", async () => {
    for (const mode of ["read", "write"] as const) {
      const request = new NextRequest("http://localhost:3000/api/v1/admin/ai-usage", { method: mode === "write" ? "POST" : "GET" });
      await expect(requireAdmin(request, mode)).rejects.toMatchObject({ api: { status: 404 } });
    }
  });

  it("careers hosts must be a careers subdomain, or a domain that exists for jobs", () => {
    expect(careersHostProblem(["microsoft.com"], ["microsoft.com"])).toMatch(/careers subdomain/);
    expect(careersHostProblem(["careers.microsoft.com"], ["microsoft.com"])).toBeNull();
    expect(careersHostProblem(["metacareers.com"], ["meta.com", "metacareers.com"])).toBeNull();
    expect(careersHostProblem(["acme.greenhouse.io"], ["greenhouse.io"])).toMatch(/hiring system/);
  });

  it("a shared hiring domain can't be a company's official domain", () => {
    expect(officialDomainProblem(["greenhouse.io"])).toMatch(/shared by many employers/);
    expect(officialDomainProblem(["jobs.lever.co"])).toMatch(/shared/);
    expect(officialDomainProblem(["acme.com", "amazon.jobs"])).toBeNull();
  });

  it("amazon.jobs can only be Amazon's own board", () => {
    const base = { name: "Acme", officialDomains: ["acme.com"], ats: "AMAZON" };
    expect(companyCreate.safeParse({ ...base, atsBoard: "acme" }).success).toBe(false);
    expect(companyCreate.safeParse({ ...base, atsBoard: "amazon" }).success).toBe(true);
  });

  it("dismissing a board hides it from every check for 90 days", async () => {
    const upsert = vi.fn(async () => ({}));
    await dismissDiscovery("acme", { boardDiscovery: { upsert } } as never, NOW);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "acme" },
        update: expect.objectContaining({ status: "NOT_FOUND", method: "dismissed", board: null, employerName: "", expiresAt: new Date(NOW.getTime() + 90 * 86_400_000) }),
      }),
    );
  });

  it("boards already in the directory can't hide pending ones from the list", async () => {
    const listed = Array.from({ length: 60 }, (_, i) => ({ key: `l${i}`, ats: "GREENHOUSE", board: `listed${i}` }));
    const rows = [...listed, { key: "pending", ats: "GREENHOUSE", board: "newco" }];
    const db = {
      boardDiscovery: { findMany: vi.fn(async () => rows) },
      company: { findMany: vi.fn(async () => listed.map((r) => ({ ats: r.ats, atsBoard: r.board }))) },
    } as never;
    expect((await pendingDiscoveries(db, NOW)).map((r) => r.key)).toEqual(["pending"]);
  });
});

describe("unlisted-company lookups are rate limited per account", () => {
  it("past the hourly limit nothing is probed and the reason is shown", async () => {
    const userId = "rate-limit-test-user";
    for (let i = 0; i < DISCOVERY_PER_HOUR; i++) rateLimit(`discover:user:${userId}`, DISCOVERY_PER_HOUR, 3600);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await locator(userId, NOW, offTransport, Date.now())("Acme", "Engineer", true);
    expect(out).toMatchObject({ located: false, aiFailure: "limit" });
    expect(out.rows[0]).toMatchObject({ id: "A-LOCATE", status: "couldnt_verify", fact: expect.stringMatching(/looked up many companies/) });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("cue answers and masking", () => {
  it("a scam-dense text can mark many sentences without the answer becoming invalid", () => {
    const matches = Array.from({ length: 80 }, (_, i) => ({ rule: "S-PAY-TO-WORK", sentence: i % 40, confidence: 0.95 }));
    expect(CueMatches.safeParse({ matches }).success).toBe(true);
  });

  it("masking stays fast on hostile input (it used to take time growing with the square of the length)", () => {
    for (const s of ["1".repeat(20_000), "a".repeat(20_000), "a.".repeat(10_000)]) {
      const started = performance.now();
      redactForAi(s);
      expect(performance.now() - started).toBeLessThan(100);
    }
    expect(redactForAi("Mail jane.doe@acme.co.uk now")).toBe("Mail [email]@acme.co.uk now");
  });
});

describe("link formats of systems we read but can't map", () => {
  it.each(["https://wd5.myworkdaysite.com/recruiting/acme/External/job/Remote/Engineer_R1", "https://acme.workable.com/jobs/123", "https://careers.smartrecruiters.com/Acme/job"])(
    "%s gets a specific message",
    (url) => {
      const r = parseJobUrl(url);
      expect("error" in r && r.message).toMatch(/^We read (Workday|Workable|SmartRecruiters), but not links in this format/);
    },
  );
});
