import { describe, expect, it } from "vitest";
import { jobPageUrl, parseJobUrl } from "@/lib/lookups/job-url";

describe("parseJobUrl", () => {
  it.each([
    ["https://job-boards.greenhouse.io/discord/jobs/8806482002", "GREENHOUSE", "discord", "8806482002"],
    ["https://jobs.lever.co/spotify/223f9722-3579-4ff2-b123-e4cc7b0c1a64", "LEVER", "spotify", "223f9722-3579-4ff2-b123-e4cc7b0c1a64"],
    ["https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245", "ASHBY", "ramp", "34413f8d-26bf-4bbc-8ade-eb309a0e2245"],
  ])("maps demo URL %s to its board token and job ID", (url, ats, board, jobId) => {
    expect(parseJobUrl(url)).toMatchObject({ kind: "board", ats, board, jobId });
  });

  it("rejects a credentials trick whose real host is evil.com", () => {
    expect(parseJobUrl("https://boards.greenhouse.io@evil.com/x")).toMatchObject({ error: "unsupported_url" });
  });

  it.each([
    "http://boards.greenhouse.io/discord/jobs/8806482002",
    "https://boards.greenhouse.io:8443/discord/jobs/8806482002",
    "https://user:pw@boards.greenhouse.io/discord/jobs/8806482002",
    "https://boards.greenhouse.io.evil.com/discord/jobs/8806482002",
    "https://evil.com/boards.greenhouse.io/discord/jobs/8806482002",
    "https://boards.greenhouse.io/discord/jobs/8806482002/../../x",
    "https://boards.greenhouse.io/discord/jobs/abc",
    "https://jobs.lever.co/spotify/not-a-uuid",
    "https://www.linkedin.com/jobs/view/123",
  ])("rejects %s", (url) => {
    expect(parseJobUrl(url)).toHaveProperty("error");
  });

  it("calls non-URLs invalid", () => {
    expect(parseJobUrl("discord commercial policy lead")).toMatchObject({ error: "invalid_url" });
  });

  it("accepts the classic Greenhouse host and lowercases the board", () => {
    expect(parseJobUrl("https://boards.greenhouse.io/Discord/jobs/8806482002/")).toMatchObject({
      ats: "GREENHOUSE",
      board: "discord",
      jobId: "8806482002",
    });
  });

  it("keeps Lever site case, lowercases the job ID and notes the EU region", () => {
    expect(parseJobUrl("https://jobs.eu.lever.co/SomeCo/223F9722-3579-4FF2-B123-E4CC7B0C1A64/apply")).toEqual({
      kind: "board",
      ats: "LEVER",
      board: "SomeCo",
      jobId: "223f9722-3579-4ff2-b123-e4cc7b0c1a64",
      region: "eu",
    });
  });

  it("recognizes a company-site gh_jid link", () => {
    expect(parseJobUrl("https://stripe.com/jobs/search?gh_jid=6042172")).toEqual({
      kind: "gh_jid",
      hostname: "stripe.com",
      jobId: "6042172",
    });
  });

  it("builds public job page links", () => {
    expect(jobPageUrl("LEVER", "spotify", "abc", "eu")).toBe("https://jobs.eu.lever.co/spotify/abc");
    expect(jobPageUrl("GREENHOUSE", "discord", "1")).toBe("https://job-boards.greenhouse.io/discord/jobs/1");
  });
});
