import { describe, expect, it, vi } from "vitest";
import { boardSearch, otherHits, type SearchHit } from "@/lib/ai/locate";
import type { AiTransport } from "@/lib/ai/transport";
import { systemRows } from "@/lib/checks/locate";
import { checkPostingText, postingTextSchema, type PostingDeps } from "@/lib/checks/posting";
import { pickByTitle } from "@/lib/checks/run";
import { discoverBoard, mentionsEmployer, type DiscoveryDeps } from "@/lib/lookups/discovery";
import { classifyHost, otherSystemOf } from "@/lib/lookups/job-url";

// Hiring systems we can name but not read (iCIMS, Taleo, UKG, ...): the search names them and
// looks for the title, every row is 0 points with no link, and a missing title is asked for.

const NOW = new Date("2026-10-28T12:00:00Z");
const hit = (url: string, title: string, pageAge: string | null = null): SearchHit => ({ url, title, pageAge });
const ok = (value: SearchHit[]) => ({ ok: true as const, value, mode: "live" as const, model: "claude-sonnet-5-5" });
const rowDeps = { now: NOW, pickByTitle };

const REYES = [
  hit("https://careers-reyesholdings.icims.com/jobs/1234/software-developer/job", "Software Developer in Chicago, IL | Careers at Reyes Holdings", "2 weeks ago"),
  hit("https://careers-reyesholdings.icims.com/jobs/5678/merchandiser/job", "Merchandiser in Eagan, MN | Careers at Reyes Holdings"),
  hit("https://acme.taleo.net/careersection/jobdetail.ftl?job=1", "Software Developer - Acme"),
];

describe("otherSystemOf", () => {
  it.each([
    ["https://careers-reyesholdings.icims.com/jobs/1/x/job", "iCIMS", "reyesholdings"],
    ["https://uscareers-acme.icims.com/jobs/1/x/job", "iCIMS", "acme"],
    ["https://acme.taleo.net/careersection/2/jobdetail.ftl", "Taleo", "acme"],
    ["https://jobs.jobvite.com/acme/job/oAbC", "Jobvite", "acme"],
    ["https://acme.bamboohr.com/careers/12", "BambooHR", "acme"],
    ["https://career4.successfactors.com/career?company=AcmeCorp", "SuccessFactors", "AcmeCorp"],
    ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/1", "Dayforce", "acme"],
    ["https://acme.jobs.personio.de/job/1", "Personio", "acme"],
    ["https://recruiting.ultipro.com/ACM1000ACME/JobBoard/abc", "UKG Pro", null],
    ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x", "ADP", null],
    ["https://ehxx.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1", "Oracle Recruiting", null],
    ["https://careers.icims.com/jobs", "iCIMS", null],
    ["https://easyapply-sheetz.icims.com/jobs/1/x/job", "iCIMS", "sheetz"],
    ["https://internal-reyesholdings.icims.com/jobs/1/x/job", "iCIMS", "reyesholdings"],
  ])("%s → %s (%s)", (url, name, account) => {
    expect(otherSystemOf(url)).toEqual({ name, account });
  });

  it("ignores systems we read, job sites, a vendor's own website and junk", () => {
    expect(otherSystemOf("https://job-boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(otherSystemOf("https://www.linkedin.com/jobs/view/1")).toBeNull();
    expect(otherSystemOf("https://www.adp.com/what-we-offer.aspx")).toBeNull();
    expect(otherSystemOf("not a url")).toBeNull();
    expect(otherSystemOf("https://jobs.jobvite.com/%E0%A4%A/job/1")).toEqual({ name: "Jobvite", account: null });
  });

  it("the URL tab names the new systems too", () => {
    expect(classifyHost("recruiting.ultipro.com")).toEqual({ kind: "other_ats", name: "UKG Pro" });
    expect(classifyHost("jobs.dayforcehcm.com")).toEqual({ kind: "other_ats", name: "Dayforce" });
  });
});

describe("mentionsEmployer", () => {
  it("matches the account or a title that names the company", () => {
    expect(mentionsEmployer("reyesholdings", "", "Reyes Holdings, LLC")).toBe(true);
    expect(mentionsEmployer("reyes", "", "Reyes Holdings")).toBe(true);
    expect(mentionsEmployer(null, "Developer | Careers at Reyes Holdings", "Reyes Holdings")).toBe(true);
  });

  it("looks past a brand phrase like \"Family of Businesses\" (how the posting's Benefits section names it)", () => {
    expect(mentionsEmployer("reyesholdings", "", "Reyes Family of Businesses")).toBe(true);
    expect(mentionsEmployer(null, "Reyes Holdings, L.L.C", "Reyes Family of Businesses")).toBe(true);
    expect(mentionsEmployer("martinbrower", "Driver | Martin Brower", "Reyes Family of Businesses")).toBe(false);
  });

  it("\"Companies\" and \"Enterprises\" are read like Inc", () => {
    expect(mentionsEmployer("lowes", "", "Lowe's Companies, Inc.")).toBe(true);
    expect(mentionsEmployer(null, "Careers at Lowe's Companies", "Lowe's")).toBe(true);
  });

  it("a different company that starts with the same name is not this one", () => {
    // Seen live: Lowes Foods for Lowe's; Gallagher Manufacturing for Gallagher; Delta Dental of Iowa for Delta Dental.
    expect(mentionsEmployer("lowesfoods", "Lowes Foods", "Lowe's Companies")).toBe(false);
    expect(mentionsEmployer("Gallagher-Manufacturing-Inc", "Gallagher Manufacturing Inc - Warehouse Associate", "Gallagher")).toBe(false);
    expect(mentionsEmployer("Delta-Dental-of-Iowa", "Delta Dental of Iowa - Outreach", "Delta Dental")).toBe(false);
    // Seen live: Paylocity's "Reyes-TX-Inc" for "Reyes Family of Businesses".
    expect(mentionsEmployer("Reyes-TX-Inc", "Careers | Reyes TX Inc", "Reyes Family of Businesses")).toBe(false);
    expect(mentionsEmployer("acmefoodsdallas", "", "Acme Foods")).toBe(false);
    expect(mentionsEmployer("acmefoodsinc", "", "Acme Foods")).toBe(true);
    expect(mentionsEmployer(null, "Driver - Acme Foods Inc", "Acme Foods")).toBe(true);
    expect(mentionsEmployer(null, "Driver - Acme Foodservice", "Acme Foods")).toBe(false);
  });

  it("doesn't match other companies, fragments or very short names", () => {
    expect(mentionsEmployer("rey", "", "Reyes Holdings")).toBe(false);
    expect(mentionsEmployer("acme", "Software Developer - Acme", "Reyes Holdings")).toBe(false);
    expect(mentionsEmployer(null, "Reyesholdings fan page", "Reyes Holdings")).toBe(false);
    expect(mentionsEmployer("ab", "AB", "AB")).toBe(false);
  });
});

describe("search results are split by what we can do with them", () => {
  it("boards we read are probed; other systems are kept for naming; anything else is dropped", () => {
    const out = boardSearch([
      hit("https://jobs.lever.co/acme/1", "Engineer"),
      hit("https://careers-acme.icims.com/jobs/1/x/job", "Engineer | Acme"),
      hit("http://careers-acme.icims.com/jobs/2/x/job", "Plain http"),
      hit("https://example.com/acme", "Not a hiring system"),
    ]);
    expect(out.boards).toEqual([{ ats: "LEVER", board: "acme" }]);
    expect(out.others.map((h) => h.title)).toEqual(["Engineer | Acme"]);
    expect(otherHits([])).toEqual([]);
  });
});

describe("systemRows", () => {
  it("names the system and finds the listing, with no link and no points", () => {
    const rows = systemRows(ok(REYES), "Reyes Holdings", "Software Developer", false, rowDeps);
    expect(rows.map((r) => [r.id, r.points, r.status, r.kind])).toEqual([
      ["A-SYSTEM", 0, "found", "info"],
      ["A-LISTING", 0, "found", "info"],
    ]);
    expect(rows[0].fact).toMatch(/appear on iCIMS \(account "reyesholdings"\), a hiring system we can't read yet/);
    expect(rows[1].fact).toMatch(/"Software Developer in Chicago, IL \| Careers at Reyes Holdings".*search result dated 2 weeks ago.*nothing counted/);
    for (const r of rows) expect(r.sourceUrl).toBeUndefined();
  });

  it("a title that isn't listed is not conclusive, and no title means no listing row", () => {
    const missing = systemRows(ok(REYES), "Reyes Holdings", "Data Scientist", false, rowDeps);
    expect(missing[1]).toMatchObject({ id: "A-LISTING", status: "couldnt_verify", points: 0, fact: expect.stringMatching(/not conclusive/) });
    expect(systemRows(ok(REYES), "Reyes Holdings", null, false, rowDeps).map((r) => r.id)).toEqual(["A-SYSTEM"]);
  });

  it("results about another company don't count as this one's", () => {
    const rows = systemRows(ok(REYES.slice(2)), "Reyes Holdings", "Software Developer", false, rowDeps);
    expect(rows).toEqual([expect.objectContaining({ id: "A-SYSTEM", status: "couldnt_verify", fact: expect.stringMatching(/didn't turn up/) })]);
  });

  it("AI off adds nothing; a failed search says why", () => {
    expect(systemRows({ ok: false, reason: "off" }, "Reyes Holdings", null, false, rowDeps)).toEqual([]);
    expect(systemRows({ ok: false, reason: "budget" }, "Reyes Holdings", null, false, rowDeps)[0]).toMatchObject({
      id: "A-SYSTEM",
      status: "couldnt_verify",
      fact: expect.stringMatching(/^Couldn't search other hiring systems/),
    });
  });
});

describe("the board search hands its other-system results on", () => {
  it("keeps them on the discovery result; a cached answer has none (null)", async () => {
    const store = new Map();
    const d: DiscoveryDeps = {
      ai: {
        extract: async () => ({ ok: false, reason: "off" }),
        extractMessage: async () => ({ ok: false, reason: "off" }),
        guessBoards: async () => ({ ok: true, value: [], mode: "live", model: "claude-haiku-5-5" }),
        searchBoards: async () => ({ ok: true, value: { boards: [], others: REYES.slice(0, 1) }, mode: "live", model: "claude-sonnet-5-5" }),
      },
      userId: "u1",
      now: NOW,
      probe: async () => null,
      cache: { get: async (k) => store.get(k) ?? null, put: async (row) => void store.set(row.key, row) },
      canSearch: () => true,
    };
    expect((await discoverBoard("Reyes Holdings", null, d)).others).toEqual(REYES.slice(0, 1));
    expect((await discoverBoard("Reyes Holdings", null, d)).others).toBeNull();
  });
});

describe("pasted posting without a title", () => {
  const extracted = { documentKind: "job_posting" as const, employerName: "Reyes Holdings", roleTitle: null, location: null, employmentType: null, isStaffingAgency: false, postedAgoText: null };
  const ai: AiTransport = {
    extract: async () => ({ ok: true, value: extracted, mode: "replay", model: "claude-haiku-5-5" }),
    extractMessage: async () => ({ ok: false, reason: "off" }),
  };
  const deps = (o: Partial<PostingDeps> = {}): PostingDeps => ({
    ai,
    userId: "u1",
    now: NOW,
    findCompany: async () => null,
    findCompanyExact: async () => null,
    companyBoard: vi.fn(),
    lookupJob: vi.fn(),
    resolveLink: async () => null,
    community: async () => [],
    sender: async () => null,
    pickByTitle,
    locate: vi.fn(async () => ({ rows: [], ai: { used: false, model: null, mode: null } })),
    ...o,
  });
  const input = (extra: Record<string, string> = {}) => postingTextSchema.parse({ kind: "posting_text", text: "About the job\nDevelop solutions on the Microsoft stack.", ...extra });

  it("asks for the title instead of guessing one", async () => {
    const out = await checkPostingText(input(), deps());
    expect(out.gathered.find((g) => g.id === "A-TITLE")).toMatchObject({ points: 0, status: "couldnt_verify", fact: expect.stringMatching(/above "About the job"/) });
    expect(out.ghost.band).toBe("NOT_ENOUGH_DATA");
  });

  it("a title typed on its own is used with the company Claude read", async () => {
    const d = deps();
    const out = await checkPostingText(input({ role: "Software Developer" }), d);
    expect(d.locate).toHaveBeenCalledWith("Reyes Holdings", "Software Developer", false);
    expect(out.gathered.map((g) => g.id)).not.toContain("A-TITLE");
  });
});
