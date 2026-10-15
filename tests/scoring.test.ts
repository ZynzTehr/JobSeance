import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkBoardJob, checkSchema, normalizeTitle, slugify } from "@/lib/checks/run";
import { normalizeBoard } from "@/lib/lookups/boards";
import { rdapLookup } from "@/lib/lookups/domains";
import { CONFIG_VERSION } from "@/lib/scoring/config";
import { communityPoints, scoreGhost, type BoardStatus, type CommunityReport } from "@/lib/scoring/ghost";
import { scoreScam, warningCount, type SenderFacts } from "@/lib/scoring/scam";

const now = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const live: BoardStatus = { kind: "live", boardName: "Discord's Greenhouse board", source: "boards-api.greenhouse.io" };
const gone: BoardStatus = { ...live, kind: "not_found", detail: "Job 1 is no longer on Discord's Greenhouse board" };

const report = (userId: string, o: Partial<CommunityReport> = {}): CommunityReport => ({
  userId,
  stage: "APPLIED",
  outcome: "NO_RESPONSE",
  appliedAt: daysAgo(100),
  lastInterviewAt: null,
  createdAt: daysAgo(10),
  ...o,
});

describe("ghost rubric: worked examples", () => {
  it("live posting, 20 days old, no reports → 0, Low", () => {
    const r = scoreGhost({ board: live, postedAt: daysAgo(20), description: "Build things.", community: [], now });
    expect([r.score, r.band]).toEqual([0, "LOW"]);
  });

  it("live, 120 days old, 'join our talent community' → 25, Caution", () => {
    const r = scoreGhost({ board: live, postedAt: daysAgo(120), description: "Join our talent community today.", community: [], now });
    expect(r.signals.filter((s) => s.points).map((s) => [s.id, s.points])).toEqual([
      ["G-AGE", 10],
      ["G-EVERGREEN", 15],
    ]);
    expect([r.score, r.band]).toEqual([25, "CAUTION"]);
  });

  it("job gone, 200 days old, 4 of 5 applied-stage reports ghosted → 53, High", () => {
    const community = [1, 2, 3, 4].map((i) => report(`u${i}`)).concat(report("u5", { outcome: "REJECTED" }));
    const r = scoreGhost({ board: gone, postedAt: daysAgo(200), description: null, community, now });
    expect(r.signals.map((s) => [s.id, s.points])).toEqual([
      ["G-BOARD", 25],
      ["G-AGE", 15],
      ["G-COMMUNITY", 13],
    ]);
    expect([r.score, r.band]).toEqual([53, "HIGH"]);
  });

  it("seeded Bramblecloud 'Data Analyst' → 61, High", () => {
    const interviewed = [0, 1, 2, 3, 4].map((i) =>
      report(`r${i}`, { stage: "INTERVIEWED", appliedAt: daysAgo(150 + i * 5), lastInterviewAt: daysAgo(60 + i * 15) }),
    );
    const rejected = report("r5", { outcome: "REJECTED", appliedAt: daysAgo(160) });
    const r = scoreGhost({
      board: { kind: "no_board", companyName: "Bramblecloud Software" },
      postedAt: daysAgo(210),
      description: "Data Analyst. We are collecting resumes for future openings.",
      community: [...interviewed, rejected],
      now,
    });
    expect(r.signals.filter((s) => s.points).map((s) => [s.id, s.points])).toEqual([
      ["G-AGE", 15],
      ["G-NO-VACANCY", 25],
      ["G-COMMUNITY", 21],
    ]);
    expect([r.score, r.band]).toEqual([61, "HIGH"]);
    expect(r.community).toMatchObject({ reports: 6, shown: true, ghosted: 5 });
  });
});

describe("ghost rubric: honesty rules", () => {
  it("a failed lookup scores 0 and says couldn't verify", () => {
    const r = scoreGhost({ board: { ...live, kind: "couldnt_verify" }, postedAt: null, description: null, community: [], now });
    expect(r.signals).toEqual([expect.objectContaining({ id: "G-BOARD", points: 0, status: "couldnt_verify" })]);
    expect(r.band).toBe("NOT_ENOUGH_DATA");
  });

  it("no-vacancy wording replaces evergreen", () => {
    const r = scoreGhost({ board: live, postedAt: null, description: "Talent pool. Not an existing vacancy.", community: [], now });
    expect(r.signals.map((s) => s.id)).toEqual(["G-BOARD", "G-NO-VACANCY"]);
  });

  it("a Greenhouse post with no internal job ID counts as evergreen", () => {
    const r = scoreGhost({ board: live, postedAt: daysAgo(5), description: "x", greenhouseInternalJobId: null, community: [], now });
    expect(r.score).toBe(15);
  });

  it("age bands use the board's date: 60 → 0, 61 → 5, 180 → 10, 181 → 15", () => {
    const pts = (d: number) =>
      scoreGhost({ board: live, postedAt: daysAgo(d), description: null, community: [], now }).signals.find((s) => s.id === "G-AGE")!.points;
    expect([pts(60), pts(61), pts(90), pts(91), pts(180), pts(181)]).toEqual([0, 5, 5, 10, 10, 15]);
  });

  it("community needs 3 distinct users, uses one report per user, and ignores old ones", () => {
    expect(communityPoints([report("a"), report("a"), report("b")], now)).toMatchObject({ shown: false, reports: 2 });
    expect(communityPoints([report("a"), report("b"), report("c", { createdAt: daysAgo(200) })], now).shown).toBe(false);
  });

  it("not ghosted until 45 days have passed", () => {
    const fresh = ["a", "b", "c"].map((u) => report(u, { appliedAt: daysAgo(30) }));
    expect(communityPoints(fresh, now)).toMatchObject({ shown: true, ghosted: 0, points: 0 });
  });

  it("an offer or hire subtracts 20 and the total never goes below 0", () => {
    const reports = [report("a", { outcome: "HIRED" }), report("b", { outcome: "OFFER" }), report("c", { outcome: "REJECTED" })];
    const r = scoreGhost({ board: live, postedAt: daysAgo(10), description: null, community: reports, now });
    expect(r.signals.find((s) => s.id === "G-COMMUNITY")?.points).toBe(-20);
    expect(r.score).toBe(0);
  });
});

// ---- Scam rules -------------------------------------------------------------------

const demo = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "demo-scam-message.json"), "utf8"));
const bramblecloudSender: SenderFacts = {
  domain: "bramblecloud-careers.example",
  rdapStatus: "OK",
  rdapSource: "RDAP (cached)",
  ageDays: 6,
  hasMx: true,
  nullMx: false,
  freeMail: false,
  disposable: false,
  atsSender: false,
  lookalike: { official: "bramblecloud.example", reason: "brand_suffix" },
  officialFor: [],
  reporters: 3,
};
const bramblecloud = { slug: "bramblecloud", name: "Bramblecloud Software", officialDomains: ["bramblecloud.example"] };
const scam = (o: Partial<Parameters<typeof scoreScam>[0]> = {}) =>
  scoreScam({ text: null, sender: null, claimed: null, namesEmployer: false, notOnBoard: null, now, ...o });

describe("scam rules: demo message", () => {
  const r = scam({ text: demo.text, sender: bramblecloudSender, claimed: bramblecloud, namesEmployer: true });

  it("fires exactly the 8 expected rules, capped at 100, High", () => {
    expect(r.signals.map((s) => [s.id, s.points])).toEqual([
      ["S-PAY-TO-WORK", 30],
      ["S-FAKE-CHECK", 30],
      ["S-CHAT-ONLY", 15],
      ["S-NO-INTERVIEW", 10],
      ["S-LOOKALIKE", 25],
      ["S-DOMAIN-NEW", 25],
      ["S-MISMATCH", 15],
      ["S-REPORTED", 25],
    ]);
    expect([r.score, r.band, warningCount(r)]).toEqual([100, "HIGH", 8]);
  });

  it("every rule shows its source; seven cite the FTC or FBI and one is our own data", () => {
    for (const s of r.signals) expect(s.source).toBeTruthy();
    expect(r.signals.filter((s) => /ftc\.gov|ic3\.gov/.test(s.cite ?? "")).map((s) => s.id)).toHaveLength(7);
    expect(r.signals.find((s) => !s.cite)?.id).toBe("S-REPORTED");
  });

  it("facts quote only phrase-list entries and the registrable domain", () => {
    const facts = r.signals.map((s) => s.fact).join(" | ");
    expect(facts).toContain("Matched phrases: 'deposit the check', 'mobile deposit', 'send the remaining'");
    expect(facts).toContain("bramblecloud-careers.example registered 6 days ago");
    expect(facts).not.toMatch(/talent@|Hello from|balance to the vendor/);
  });
});

describe("scam rules: sender domains", () => {
  it("free mail while naming an employer fires S-FREEMAIL and skips S-MISMATCH", () => {
    const sender = { ...bramblecloudSender, domain: "gmail.com", ageDays: 11_000, lookalike: null, freeMail: true, reporters: 9 };
    const r = scam({ sender, claimed: bramblecloud, namesEmployer: true });
    expect(r.signals.filter((s) => s.points).map((s) => s.id)).toEqual(["S-FREEMAIL"]); // no S-REPORTED for free mail
  });

  it("an official domain is a 0-point positive fact, never a subtraction", () => {
    const sender = { ...bramblecloudSender, domain: "bramblecloud.example", ageDays: 4000, lookalike: null, officialFor: ["bramblecloud"] };
    const r = scam({ sender, claimed: bramblecloud, namesEmployer: true });
    expect(r.score).toBe(0);
    expect(r.signals.find((s) => s.id === "S-MISMATCH")).toMatchObject({ points: 0, fact: expect.stringContaining("matches") });
  });

  it("ATS senders are never mismatches", () => {
    const sender = { ...bramblecloudSender, domain: "greenhouse-mail.io", ageDays: 4000, lookalike: null, atsSender: true, reporters: 0 };
    expect(scam({ sender, claimed: bramblecloud, namesEmployer: true }).score).toBe(0);
  });

  it("young domains get 10, dead or null-MX domains 20, disposable 30, 1–2 reporters 15", () => {
    const base = { ...bramblecloudSender, lookalike: null, reporters: 0 };
    const pts = (o: Partial<SenderFacts>) => scam({ sender: { ...base, ...o } }).signals.filter((s) => s.points).map((s) => [s.id, s.points]);
    expect(pts({ ageDays: 90 })).toEqual([["S-DOMAIN-NEW", 10]]);
    expect(pts({ ageDays: 900, nullMx: true, hasMx: false })).toEqual([["S-DEAD-DOMAIN", 20]]);
    expect(pts({ ageDays: 900, disposable: true })).toEqual([["S-DISPOSABLE", 30]]);
    expect(pts({ ageDays: 900, reporters: 2 })).toEqual([["S-REPORTED", 15]]);
  });

  it("an RDAP failure is couldn't verify with 0 points", () => {
    const r = scam({ sender: { ...bramblecloudSender, rdapStatus: "ERROR", ageDays: null, lookalike: null, reporters: 0 } });
    expect(r.signals).toEqual([expect.objectContaining({ id: "S-DOMAIN-NEW", points: 0, status: "couldnt_verify" })]);
  });
});

describe("scam rules: phrases", () => {
  it.each([
    ["S-TASK-SCAM", "Complete 40 app optimization tasks a day and earn commission per task."],
    ["S-PII-EARLY", "Before we talk, send your SSN and routing number."],
    ["S-RESHIP", "You will receive laptops at home and keep the laptop online."],
    ["S-PAYMENT-METHOD", "We pay you in Bitcoin; buy gift cards for supplies."],
    ["S-RUN-CODE", "For the interview, clone the repo, run npm install and open it in VS Code."],
    ["S-TOO-GOOD", "Earn $500/day from home, no experience."],
    ["S-PAY-TO-WORK", "There is a small training fee."],
  ])("%s fires on scam wording", (id, text) => {
    expect(scam({ text }).signals.map((s) => s.id)).toContain(id);
  });

  it("S-RUN-CODE adds the sandbox note", () => {
    expect(scam({ text: "Run npm install first." }).signals[0].note).toMatch(/sandbox/);
  });

  it("ordinary job-description words don't fire", () => {
    const text =
      "Work on performance optimization and signal processing. Our crypto team builds Bitcoin infrastructure. Level up your skills. Text messaging features. Competitive salary of $150,000 per year.";
    expect(scam({ text }).signals).toEqual([]);
  });

  it("no phrase rule fires on the 15 real postings in the fixtures", () => {
    const jobs = [
      ...normalizeBoard("GREENHOUSE", JSON.parse(readFileSync("fixtures/greenhouse-discord.json", "utf8"))),
      ...normalizeBoard("LEVER", JSON.parse(readFileSync("fixtures/lever-spotify.json", "utf8"))),
      ...normalizeBoard("ASHBY", JSON.parse(readFileSync("fixtures/ashby-ramp.json", "utf8"))),
    ];
    const fired = jobs.flatMap((j) => scam({ text: j.description }).signals.map((s) => `${j.externalId}: ${s.id} ${s.fact}`));
    expect(fired).toEqual([]);
  });
});

// ---- Timeouts ----------------------------------------------------------------------

const hang = vi.fn(
  (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
) as unknown as typeof fetch;

describe("timeouts", () => {
  it("a hung job board gives couldn't verify and 0 points in under a second", async () => {
    const started = Date.now();
    const r = await checkBoardJob({ ats: "GREENHOUSE", board: "discord" }, "8806482002", null, {
      now,
      fetch: { fetchImpl: hang, timeoutMs: 50 },
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.ghost.signals).toEqual([expect.objectContaining({ id: "G-BOARD", points: 0, status: "couldnt_verify" })]);
    expect(r.ghost.band).toBe("NOT_ENOUGH_DATA");
    expect(r.scam.score).toBe(0);
  });

  it("a hung RDAP server gives couldn't verify and 0 points in under a second", async () => {
    const started = Date.now();
    const rdap = await rdapLookup("example.com", { fetchImpl: hang, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(rdap.status).toBe("ERROR");
    const r = scam({ sender: { ...bramblecloudSender, rdapStatus: rdap.status, ageDays: null, lookalike: null, reporters: 0 } });
    expect(r.signals).toEqual([expect.objectContaining({ id: "S-DOMAIN-NEW", points: 0, status: "couldnt_verify" })]);
  });
});

// ---- Request shape -------------------------------------------------------------------

describe("checkSchema", () => {
  it("accepts the three spec shapes", () => {
    expect(checkSchema.safeParse({ kind: "url", url: "https://job-boards.greenhouse.io/discord/jobs/8806482002" }).success).toBe(true);
    expect(checkSchema.safeParse({ kind: "company_role", company: "bramblecloud", role: "Data Analyst" }).success).toBe(true);
    expect(checkSchema.safeParse(demo).success).toBe(true);
  });

  it("rejects unknown keys, unknown kinds, empty and oversized text", () => {
    expect(checkSchema.safeParse({ kind: "url", url: "https://x", extra: 1 }).success).toBe(false);
    expect(checkSchema.safeParse({ kind: "pdf" }).success).toBe(false);
    expect(checkSchema.safeParse({ kind: "message", text: "   " }).success).toBe(false);
    expect(checkSchema.safeParse({ kind: "message", text: "a".repeat(20_001) }).success).toBe(false);
    expect(checkSchema.safeParse({ ...demo, channel: "PIGEON" }).success).toBe(false);
  });

  it("slugifies company names and normalizes titles", () => {
    expect(slugify("  Bramblecloud Software ")).toBe("bramblecloud-software");
    expect(slugify("Café Ünïcode")).toBe("cafe-unicode");
    expect(normalizeTitle("Data  Analyst (Remote)")).toBe("data analyst remote");
  });

  it("has a config version", () => {
    expect(CONFIG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
