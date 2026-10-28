import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@/app/generated/prisma/client";

// lookupPosting's one-hour Posting cache. Only a LIVE copy short-circuits: a board sync (a company
// page or the daily sweep) stamps fetchedAt on jobs it marks removed, so a fresh NOT_FOUND row must
// be checked live again instead of reading as "Live on the board".

const rows = new Map<string, Record<string, unknown>>();
const writes: { op: string; args: { data?: Record<string, unknown>; update?: Record<string, unknown> } }[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    posting: {
      findUnique: async ({ where }: { where: { ats_board_externalId: { externalId: string } } }) => rows.get(where.ats_board_externalId.externalId) ?? null,
      update: async (args: { data: Record<string, unknown> }) => (writes.push({ op: "update", args }), {}),
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => (writes.push({ op: "upsert", args }), { id: "p1", ...args.create, ...args.update }),
    },
  }),
}));

const { lookupPosting } = await import("@/lib/lookups/postings");

const NOW = new Date("2026-10-29T10:40:00Z");
const JOB = "8806482002";
const ref = { ats: "GREENHOUSE" as const, board: "discord" };
const company = { id: "c1" } as Company;
const row = (state: "LIVE" | "NOT_FOUND" | "UNKNOWN") => ({
  id: "p1",
  externalId: JOB,
  title: "Commercial Policy Lead",
  location: "San Francisco Bay Area",
  url: `https://job-boards.greenhouse.io/discord/jobs/${JOB}`,
  postedAt: new Date("2026-09-15T16:52:11Z"),
  internalJobId: "6524134002",
  description: "Lead commercial policy.",
  state,
  fetchedAt: new Date(NOW.getTime() - 10 * 60_000), // synced 10 minutes ago: inside the hour
});

// Greenhouse answers the job (live) or 404s it (removed); the board itself always exists.
function greenhouse(jobLive: boolean) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes(`/jobs/${JOB}`)) {
      return jobLive
        ? Response.json({ id: Number(JOB), title: "Commercial Policy Lead", absolute_url: `https://job-boards.greenhouse.io/discord/jobs/${JOB}`, location: { name: "San Francisco Bay Area" }, first_published: "2026-09-15T12:52:11-04:00", internal_job_id: 6524134002, content: "<p>Lead commercial policy.</p>" })
        : new Response("", { status: 404 });
    }
    return Response.json({ name: "Discord" });
  }) as typeof fetch;
  return { calls, opts: { now: NOW, fetch: { fetchImpl } } };
}

beforeEach(() => {
  vi.stubEnv("USE_FIXTURES", "0"); // the saved Discord board would answer instead of the fake fetch
  rows.clear();
  writes.length = 0;
});

describe("posting cache", () => {
  it("serves a fresh LIVE copy without asking the board", async () => {
    rows.set(JOB, row("LIVE"));
    const gh = greenhouse(true);
    expect(await lookupPosting(ref, JOB, company, gh.opts)).toMatchObject({ found: true, source: "cache" });
    expect(gh.calls).toEqual([]);
  });

  it("checks a job a board sync just marked removed live again, and never reports it as live", async () => {
    rows.set(JOB, row("NOT_FOUND"));
    const gh = greenhouse(false);
    const r = await lookupPosting(ref, JOB, company, gh.opts);
    expect(r).toMatchObject({ found: false, previous: { externalId: JOB, title: "Commercial Policy Lead" } });
    expect(gh.calls.some((u) => u.includes(`/jobs/${JOB}`))).toBe(true);
    expect(writes).toContainEqual({ op: "update", args: expect.objectContaining({ data: { state: "NOT_FOUND", fetchedAt: NOW } }) });
  });

  it("a removed job that is back on the board reads as live again and counts as relisted", async () => {
    rows.set(JOB, row("NOT_FOUND"));
    const gh = greenhouse(true);
    expect(await lookupPosting(ref, JOB, company, gh.opts)).toMatchObject({ found: true, source: "live" });
    const upsert = writes.find((w) => w.op === "upsert");
    expect(upsert?.args.update).toMatchObject({ state: "LIVE", relistedCount: { increment: 1 } });
  });

  it("a search system's UNKNOWN row is checked live too, without counting a relist", async () => {
    rows.set(JOB, row("UNKNOWN"));
    const gh = greenhouse(true);
    expect(await lookupPosting(ref, JOB, company, gh.opts)).toMatchObject({ found: true, source: "live" });
    expect(writes.find((w) => w.op === "upsert")?.args.update).not.toHaveProperty("relistedCount");
  });
});
