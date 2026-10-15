import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBoardJob, fetchBoardJobs, htmlToText, normalizeBoard } from "@/lib/lookups/boards";
import { getJson, UpstreamError } from "@/lib/lookups/fetch";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", name), "utf8"));

describe("normalizers against fixtures", () => {
  it("Greenhouse: demo job with internal ID, location, date and plain-text description", () => {
    const job = normalizeBoard("GREENHOUSE", fixture("greenhouse-discord.json")).find((j) => j.externalId === "8806482002");
    expect(job).toMatchObject({ title: "Commercial Policy Lead", url: expect.stringContaining("8806482002") });
    expect(job?.postedAt).toBeInstanceOf(Date);
    expect(job?.description).toBeTruthy();
    expect(job?.description).not.toMatch(/<[a-z]|&lt;|&amp;/i);
  });

  it("Lever: demo posting from epoch-ms createdAt", () => {
    const job = normalizeBoard("LEVER", fixture("lever-spotify.json")).find(
      (j) => j.externalId === "223f9722-3579-4ff2-b123-e4cc7b0c1a64",
    );
    expect(job).toMatchObject({ title: "Art Director - Mexico", internalJobId: null });
    expect(job?.postedAt?.getUTCFullYear()).toBeGreaterThan(2015);
  });

  it("Ashby: demo job", () => {
    const job = normalizeBoard("ASHBY", fixture("ashby-ramp.json")).find(
      (j) => j.externalId === "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    );
    expect(job).toMatchObject({ title: "Security Engineer, Cloud" });
  });

  it("every fixture stays under 200 KB", () => {
    for (const f of ["greenhouse-discord.json", "lever-spotify.json", "ashby-ramp.json"]) {
      expect(readFileSync(path.join(process.cwd(), "fixtures", f)).length).toBeLessThan(200_000);
    }
  });
});

describe("htmlToText", () => {
  it("decodes escaped HTML, strips tags and keeps line breaks", () => {
    expect(htmlToText("&lt;p&gt;Salary: $120k &amp;amp; equity&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Remote&lt;/li&gt;&lt;/ul&gt;")).toBe(
      "Salary: $120k & equity\nRemote",
    );
  });

  it("drops scripts and returns null for empty content", () => {
    expect(htmlToText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBeNull();
  });

  it("clips to 20,000 characters", () => {
    expect(htmlToText("a".repeat(25_000))?.length).toBe(20_000);
  });
});

describe("fixture mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads boards and single jobs from disk without calling fetch", async () => {
    vi.stubEnv("USE_FIXTURES", "1");
    const spy = vi.spyOn(globalThis, "fetch");
    const jobs = await fetchBoardJobs({ ats: "GREENHOUSE", board: "discord" });
    expect(jobs.map((j) => j.externalId)).toContain("8806482002");
    expect(await fetchBoardJob({ ats: "ASHBY", board: "ramp" }, "34413F8D-26BF-4BBC-8ADE-EB309A0E2245")).not.toBeNull();
    expect(await fetchBoardJob({ ats: "LEVER", board: "spotify" }, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("treats a board without a fixture, or an unsafe name, as not found", async () => {
    vi.stubEnv("USE_FIXTURES", "1");
    await expect(fetchBoardJobs({ ats: "GREENHOUSE", board: "nope" })).rejects.toMatchObject({ kind: "not_found" });
    await expect(fetchBoardJobs({ ats: "GREENHOUSE", board: "../package" })).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("getJson", () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it("sends our user agent and refuses redirects", async () => {
    const fetchImpl = ok({ a: 1 });
    await expect(getJson("https://api.example.test/x", { fetchImpl })).resolves.toEqual({ a: 1 });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe("JobSeance/0.1");
  });

  it("maps 404, 500, bad JSON, network errors and timeouts", async () => {
    const status = (s: number, body = "") => vi.fn(async () => new Response(body, { status: s }));
    await expect(getJson("https://x.test/", { fetchImpl: status(404) })).rejects.toMatchObject({ kind: "not_found" });
    await expect(getJson("https://x.test/", { fetchImpl: status(500) })).rejects.toMatchObject({ kind: "bad_status", status: 500 });
    await expect(getJson("https://x.test/", { fetchImpl: status(200, "<html>") })).rejects.toMatchObject({ kind: "bad_body" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(getJson("https://x.test/", { fetchImpl: down })).rejects.toMatchObject({ kind: "network" });
  });

  it("gives up after the timeout", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const error: unknown = await getJson("https://x.test/", { fetchImpl: hang as typeof fetch, timeoutMs: 20 }).catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).kind).toBe("timeout");
  });
});
