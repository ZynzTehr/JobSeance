import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterExists, adapterJob, adapterSearch, workdayIdOf } from "@/lib/lookups/adapters";
import { boardExists, fetchBoardJob, fetchBoardList, fixtureName, normalizeBoard, searchBoardJobs, type BoardRef } from "@/lib/lookups/boards";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", name), "utf8"));

const REFS: Record<string, BoardRef & { host?: string }> = {
  workday: { ats: "WORKDAY", board: "nvidia/NVIDIAExternalCareerSite", host: "nvidia.wd5.myworkdayjobs.com" },
  smartrecruiters: { ats: "SMARTRECRUITERS", board: "Ubisoft2" },
  workable: { ats: "WORKABLE", board: "huggingface" },
  recruitee: { ats: "RECRUITEE", board: "bunq" },
  amazon: { ats: "AMAZON", board: "amazon" },
};
const HOSTS: Record<string, string> = {
  workday: "nvidia.wd5.myworkdayjobs.com",
  smartrecruiters: "jobs.smartrecruiters.com",
  workable: "apply.workable.com",
  recruitee: "bunq.recruitee.com",
  amazon: "www.amazon.jobs",
};

/** A fake fetch that records every call and answers with the given bodies in order. */
function fakeFetch(...answers: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)] ?? {};
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("adapter normalizers against recorded fixtures", () => {
  it.each(Object.keys(REFS))("%s: titles, dated jobs, safe links and plain-text descriptions", (key) => {
    const ref = REFS[key];
    const raw = fixture(fixtureName(ref));
    const jobs = normalizeBoard(ref.ats, raw, ref);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.title).toBeTruthy();
      expect(job.externalId).toMatch(/^[a-z0-9][a-z0-9_.-]*$/);
      expect(new URL(job.url).hostname).toBe(HOSTS[key]);
      expect(job.url).toMatch(/^https:\/\//);
      if (job.description) expect(job.description).not.toMatch(/<[a-z]|&lt;|&amp;/i);
    }
    // Every system gives a posting date for at least one job (Workday's comes from the detail call).
    expect(jobs.some((j) => j.postedAt instanceof Date && j.postedAt.getUTCFullYear() > 2015)).toBe(true);
  });

  it("every adapter fixture stays under 200 KB", () => {
    for (const ref of Object.values(REFS)) {
      expect(readFileSync(path.join(process.cwd(), "fixtures", fixtureName(ref))).length).toBeLessThan(200_000);
    }
  });

  it("Workday ids are the end of the job path, lowercased", () => {
    expect(workdayIdOf("/job/US-CA-Santa-Clara/Senior-Engineer_JR2022104-1")).toBe("jr2022104-1");
  });

  it("drops Workday paths that try to climb out of the site", () => {
    const jobs = normalizeBoard(
      "WORKDAY",
      { jobPostings: [{ title: "X", externalPath: "/job/../../admin_JR1" }, { title: "Y", externalPath: "https://evil.com/x" }] },
      REFS.workday,
    );
    expect(jobs).toEqual([]);
  });

  it("skips Recruitee offers that aren't published", () => {
    const jobs = normalizeBoard("RECRUITEE", { offers: [{ slug: "a", title: "A", status: "closed" }, { slug: "b", title: "B" }] }, REFS.recruitee);
    expect(jobs.map((j) => j.externalId)).toEqual(["b"]);
  });

  it("reads amazon.jobs dates written as 'October 23, 2026'", () => {
    const [job] = normalizeBoard("AMAZON", { jobs: [{ id_icims: "10587973", title: "Site Leader", posted_date: "October  23, 2026" }] });
    expect(job.postedAt?.getFullYear()).toBe(2026);
  });
});

describe("fixture mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(Object.keys(REFS))("%s reads its list and one job from disk without calling fetch", async (key) => {
    vi.stubEnv("USE_FIXTURES", "1");
    const spy = vi.spyOn(globalThis, "fetch");
    const ref = REFS[key];
    const list = await fetchBoardList(ref);
    expect(list.jobs.length).toBeGreaterThan(0);
    expect(list.partial).toBe(key === "workday" || key === "smartrecruiters" || key === "amazon");
    const first = list.jobs[0];
    expect(await fetchBoardJob(ref, first.externalId.toUpperCase())).toMatchObject({ externalId: first.externalId });
    expect(await fetchBoardJob(ref, "zz-no-such-job")).toBeNull();
    expect(await boardExists(ref)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("outbound requests", () => {
  it("Workday searches the tenant's own JSON endpoint with a constant body plus the role", async () => {
    const { impl, calls } = fakeFetch({ body: { total: 1, jobPostings: [] } });
    await adapterSearch(REFS.workday, "Senior Engineer", { fetchImpl: impl });
    expect(calls[0].url).toBe("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ appliedFacets: {}, limit: 20, offset: 0, searchText: "Senior Engineer" });
    expect(calls[0].init?.redirect).toBe("error");
  });

  it("Workday refuses a host that doesn't belong to the tenant, before any request", async () => {
    const { impl, calls } = fakeFetch({});
    await expect(adapterSearch({ ats: "WORKDAY", board: "nvidia/site", host: "acme.wd5.myworkdayjobs.com" }, "x", { fetchImpl: impl })).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(adapterSearch({ ats: "WORKDAY", board: "nvidia/site", host: "nvidia.evil.com" }, "x", { fetchImpl: impl })).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(calls).toHaveLength(0);
  });

  it("Workday looks a job up by its requisition number, then reads the detail by the matching path", async () => {
    const path1 = "/job/US-CA-Santa-Clara/Senior-Engineer_JR2001234";
    const { impl, calls } = fakeFetch(
      { body: { total: 2, jobPostings: [{ title: "Other", externalPath: "/job/x/Other_JR2001234-1" }, { title: "Senior Engineer", externalPath: path1 }] } },
      { body: { jobPostingInfo: { title: "Senior Engineer", startDate: "2026-10-01", jobDescription: "<p>Build things</p>" } } },
    );
    const job = await adapterJob(REFS.workday, "JR2001234", { fetchImpl: impl });
    expect(JSON.parse(String(calls[0].init?.body)).searchText).toBe("jr2001234");
    expect(calls[1].url).toBe(`https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite${path1}`);
    expect(job).toMatchObject({ externalId: "jr2001234", descriptionHtml: "<p>Build things</p>" });
    expect(job?.postedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("Workday: a search miss counts as removed only when the pasted job's own path answers 404", async () => {
    const jobPath = "/job/US-CA-Santa-Clara/Senior-Engineer_JR2001234";
    const ref = { ...REFS.workday, jobPath };
    const gone = fakeFetch({ body: { total: 0, jobPostings: [] } }, { status: 404 });
    expect(await adapterJob(ref, "jr2001234", { fetchImpl: gone.impl })).toBeNull();
    expect(gone.calls[1].url).toBe(`https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite${jobPath}`);

    const live = fakeFetch({ body: { total: 0, jobPostings: [] } }, { body: { jobPostingInfo: { title: "Senior Engineer", startDate: "2026-10-01" } } });
    expect(await adapterJob(ref, "jr2001234", { fetchImpl: live.impl })).toMatchObject({ externalId: "jr2001234", title: "Senior Engineer" });

    // No path (or one for another job): a miss is couldn't verify, and no second request is made.
    for (const r of [REFS.workday, { ...REFS.workday, jobPath: "/job/x/Other_JR999" }, { ...REFS.workday, jobPath: "/job/../../x_JR2001234" }]) {
      const miss = fakeFetch({ body: { total: 0, jobPostings: [] } });
      await expect(adapterJob(r, "jr2001234", { fetchImpl: miss.impl })).rejects.toMatchObject({ kind: "bad_body" });
      expect(miss.calls).toHaveLength(1);
    }
  });

  it("SmartRecruiters, Workable, Recruitee and amazon.jobs URLs are constants plus encoded ids", async () => {
    const sr = fakeFetch({ body: { totalFound: 0, content: [] } });
    await adapterSearch(REFS.smartrecruiters, "Game Designer & Lead", { fetchImpl: sr.impl });
    expect(sr.calls[0].url).toBe("https://api.smartrecruiters.com/v1/companies/Ubisoft2/postings?limit=100&offset=0&q=Game%20Designer%20%26%20Lead");

    const wk = fakeFetch({ body: { jobs: [] } });
    await adapterSearch(REFS.workable, "x", { fetchImpl: wk.impl });
    expect(wk.calls[0].url).toBe("https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true");

    const rc = fakeFetch({ body: { offers: [] } });
    await adapterSearch(REFS.recruitee, "x", { fetchImpl: rc.impl });
    expect(rc.calls[0].url).toBe("https://bunq.recruitee.com/api/offers/");

    const am = fakeFetch({ body: { hits: 0, jobs: [] } }, { status: 404 });
    await adapterJob(REFS.amazon, "10587973", { fetchImpl: am.impl });
    expect(am.calls[0].url).toBe("https://www.amazon.jobs/en/search.json?base_query=10587973&result_limit=5&offset=0");
  });

  it("refuses board identifiers that could change the host or path", async () => {
    const { impl, calls } = fakeFetch({});
    for (const board of ["evil.com/x", "a b", "../x", ""]) {
      await expect(adapterSearch({ ats: "RECRUITEE", board }, "x", { fetchImpl: impl })).rejects.toMatchObject({ kind: "not_found" });
      await expect(adapterSearch({ ats: "SMARTRECRUITERS", board }, "x", { fetchImpl: impl })).rejects.toMatchObject({ kind: "not_found" });
    }
    expect(calls).toHaveLength(0);
  });

  it("amazon.jobs: a search miss counts as removed only when the job page answers 404", async () => {
    const gone = fakeFetch({ body: { hits: 0, jobs: [] } }, { status: 404 });
    expect(await adapterJob(REFS.amazon, "10587973", { fetchImpl: gone.impl })).toBeNull();
    expect(gone.calls[1]).toMatchObject({ url: "https://www.amazon.jobs/en/jobs/10587973", init: { method: "HEAD", redirect: "manual" } });

    const live = fakeFetch({ body: { hits: 0, jobs: [] } }, { status: 302 });
    await expect(adapterJob(REFS.amazon, "10587973", { fetchImpl: live.impl })).rejects.toMatchObject({ kind: "bad_status", status: 302 });
  });

  it("never asks amazon.jobs about an id that isn't a number", async () => {
    const { impl, calls } = fakeFetch({});
    expect(await adapterJob(REFS.amazon, "../admin", { fetchImpl: impl })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("search systems", () => {
  it("search uses the system's own search, not the newest page", async () => {
    const { impl, calls } = fakeFetch({ body: { hits: 1, jobs: [{ id_icims: "10587973", title: "Site Leader" }] } });
    const jobs = await searchBoardJobs(REFS.amazon, "Site Leader", { fetchImpl: impl });
    expect(calls[0].url).toContain("base_query=Site%20Leader");
    expect(jobs.map((j) => j.externalId)).toEqual(["10587973"]);
  });
});

describe("board existence", () => {
  it("a 404 means the board doesn't exist", async () => {
    expect(await adapterExists(REFS.workable, { fetchImpl: fakeFetch({ status: 404 }).impl })).toBe(false);
    expect(await adapterExists(REFS.recruitee, { fetchImpl: fakeFetch({ status: 404 }).impl })).toBe(false);
  });

  it("Workday answers an unknown site with 422", async () => {
    expect(await adapterExists(REFS.workday, { fetchImpl: fakeFetch({ status: 422 }).impl })).toBe(false);
  });

  it("SmartRecruiters with no postings is treated as unknown (disabled feeds answer the same way)", async () => {
    expect(await adapterExists(REFS.smartrecruiters, { fetchImpl: fakeFetch({ body: { totalFound: 0, content: [] } }).impl })).toBe(false);
    expect(await adapterExists(REFS.smartrecruiters, { fetchImpl: fakeFetch({ body: { totalFound: 3, content: [] } }).impl })).toBe(true);
  });

  it("server errors and blocks throw, so the check shows couldn't verify instead of 'not found'", async () => {
    await expect(adapterExists(REFS.workday, { fetchImpl: fakeFetch({ status: 403 }).impl })).rejects.toMatchObject({ kind: "bad_status", status: 403 });
    await expect(adapterExists(REFS.workable, { fetchImpl: fakeFetch({ status: 500 }).impl })).rejects.toMatchObject({ kind: "bad_status" });
  });

  it("a hung request times out", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" })))),
    ) as unknown as typeof fetch;
    const started = Date.now();
    await expect(adapterExists(REFS.recruitee, { fetchImpl: hang, timeoutMs: 50 })).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
