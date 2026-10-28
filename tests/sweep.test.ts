import { describe, expect, it } from "vitest";
import { syncBoard } from "@/lib/lookups/postings";
import { runSweep, SWEEP_COMPANIES, SWEEP_TIMEOUT_MS } from "@/lib/lookups/sweep";

// The daily board sweep and the repost history it maintains, against a fake Prisma client.

const NOW = new Date("2026-10-28T10:30:00Z");

type Op = { op: string; args: { where?: Record<string, unknown>; data?: Record<string, unknown> | unknown[] } };

// Records every write; $transaction answers each with a count read off its shape.
function fakeDb(companies: object[], existing: Record<string, { externalId: string }[]> = {}) {
  const ops: Op[] = [];
  const calls: { op: string; args: unknown }[] = [];
  const write = (op: string) => (args: Op["args"]) => (ops.push({ op, args }), { op, args });
  const db = {
    company: { findMany: async (args: unknown) => (calls.push({ op: "company.findMany", args }), companies) },
    posting: {
      findMany: async ({ where }: { where: { ats: string; board: string } }) => existing[`${where.ats}:${where.board}`] ?? [],
      createMany: write("createMany"),
      updateMany: write("updateMany"),
    },
    $transaction: async (list: Op[]) =>
      list.map(({ args: { data = {} } }) => ({
        count: Array.isArray(data) ? data.length : "relistedCount" in data ? 2 : "removedAt" in data ? 1 : 0,
      })),
  };
  return { db: db as never, ops, calls };
}

const job = (externalId: string) => ({ externalId, title: "Engineer", location: null, url: "https://x", postedAt: null, internalJobId: null, description: null });
const discord = { id: "c1", slug: "discord", ats: "GREENHOUSE", atsBoard: "discord", atsHost: null, isFictional: false };
const nvidia = { id: "c2", slug: "nvidia", ats: "WORKDAY", atsBoard: "nvidia/Site", atsHost: "nvidia.wd5.myworkdayjobs.com", isFictional: false };
const down = { id: "c3", slug: "down", ats: "LEVER", atsBoard: "down", atsHost: null, isFictional: false };

describe("daily board sweep", () => {
  it("refreshes every real board, counts a board that is down and keeps going", async () => {
    const { db, ops, calls } = fakeDb([discord, down, nvidia]);
    const fetched: string[] = [];
    const fetchList = async (ref: { ats: string; board: string; host?: string }, opts?: { timeoutMs?: number }) => {
      fetched.push(`${ref.ats}:${ref.board}${ref.host ? `@${ref.host}` : ""} ${opts?.timeoutMs}ms`);
      if (ref.board === "down") throw new Error("503 from the board: never logged");
      return { jobs: [job("j1")], total: 1, partial: ref.ats === "WORKDAY" };
    };
    const counts = await runSweep(db, NOW, fetchList as never);
    expect(SWEEP_COMPANIES).toEqual({ isFictional: false, ats: { not: "NONE" }, atsBoard: { not: null } });
    expect(calls[0]).toEqual({ op: "company.findMany", args: { where: SWEEP_COMPANIES, orderBy: { slug: "asc" } } });
    // A sweep waits longer than a check does: a 6 MB board must not fail every day.
    expect(SWEEP_TIMEOUT_MS).toBeGreaterThan(5000);
    expect(fetched).toEqual([`GREENHOUSE:discord ${SWEEP_TIMEOUT_MS}ms`, `LEVER:down ${SWEEP_TIMEOUT_MS}ms`, `WORKDAY:nvidia/Site@nvidia.wd5.myworkdayjobs.com ${SWEEP_TIMEOUT_MS}ms`]);
    expect(counts).toEqual({ boards: 3, synced: 2, failed: 1, added: 2, relisted: 4, removed: 1 });
    // The Workday board is a search page: nothing on it is marked removed.
    const removed = ops.filter((o) => o.op === "updateMany" && o.args.data && "removedAt" in o.args.data);
    expect(removed.map((o) => o.args.where?.board)).toEqual(["discord"]);
  });
});

describe("repost history on a board sync", () => {
  it("counts a job back after it was removed, and stamps the day a job left a full board", async () => {
    const { db, ops } = fakeDb([]);
    const r = await syncBoard({ id: "c1" }, { ats: "GREENHOUSE", board: "discord" }, [job("j1")], [{ externalId: "old" }], NOW, false, db);
    expect(r).toEqual({ added: 1, relisted: 2, removed: 1 });
    const updates = ops.filter((o) => o.op === "updateMany").map((o) => o.args);
    expect(updates).toEqual([
      { where: { ats: "GREENHOUSE", board: "discord", externalId: { in: ["j1"] }, state: { not: "LIVE" } }, data: { relistedCount: { increment: 1 } } },
      { where: { ats: "GREENHOUSE", board: "discord", externalId: { in: ["j1"] } }, data: { state: "LIVE", lastSeenAt: NOW, fetchedAt: NOW } },
      { where: { ats: "GREENHOUSE", board: "discord", state: "LIVE", externalId: { notIn: ["j1"] } }, data: { removedAt: NOW } },
      { where: { ats: "GREENHOUSE", board: "discord", externalId: { notIn: ["j1"] } }, data: { state: "NOT_FOUND", fetchedAt: NOW } },
    ]);
  });

  it("a search system's newest page never stamps a removal", async () => {
    const { db, ops } = fakeDb([]);
    const r = await syncBoard({ id: "c1" }, { ats: "WORKDAY", board: "n/s", host: "n.wd5.myworkdayjobs.com" }, [job("j1")], [], NOW, true, db);
    expect(r.removed).toBe(0);
    expect(ops.filter((o) => o.op === "updateMany").some((o) => o.args.data && "removedAt" in o.args.data)).toBe(false);
  });
});
