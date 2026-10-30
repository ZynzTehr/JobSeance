import { describe, expect, it } from "vitest";
import { isAuthorizedCron, RETENTION, runCleanup } from "@/lib/cleanup";

const NOW = new Date("2026-10-15T12:00:00Z");
const SECRET = "s3cret-value";

type Call = { op: string; args: unknown };

// Records what runCleanup asks Prisma for; each op returns a marker that the
// fake $transaction turns into a { count } result.
function fakeDb(counts = { check: 3, scamReport: 2, flag: 1, aiUsage: 4, aiUserUsage: 5, boardDiscovery: 6, aiShadow: 7, emailToken: 8 }) {
  const calls: Call[] = [];
  const op = (model: keyof typeof counts, name: string) => (args: unknown) => {
    calls.push({ op: `${model}.${name}`, args });
    return { model };
  };
  const db = {
    check: { deleteMany: op("check", "deleteMany") },
    scamReport: { updateMany: op("scamReport", "updateMany") },
    flag: { deleteMany: op("flag", "deleteMany") },
    aiUsage: { deleteMany: op("aiUsage", "deleteMany") },
    aiUserUsage: { deleteMany: op("aiUserUsage", "deleteMany") },
    boardDiscovery: { deleteMany: op("boardDiscovery", "deleteMany") },
    aiShadow: { deleteMany: op("aiShadow", "deleteMany") },
    emailToken: { deleteMany: op("emailToken", "deleteMany") },
    $transaction: (ops: { model: keyof typeof counts }[]) => {
      calls.push({ op: "$transaction", args: ops.length });
      return Promise.resolve(ops.map((o) => ({ count: counts[o.model] })));
    },
  };
  return { db: db as unknown as Parameters<typeof runCleanup>[0], calls };
}

const argsOf = (calls: Call[], op: string) => calls.find((c) => c.op === op)?.args;

describe("cron authorization", () => {
  it("refuses everything when CRON_SECRET is unset or empty", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });

  it("refuses a missing header", () => {
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("refuses a wrong secret of the same length", () => {
    expect(isAuthorizedCron(`Bearer ${"x".repeat(SECRET.length)}`, SECRET)).toBe(false);
  });

  it("refuses the bare secret without the Bearer prefix", () => {
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
  });

  it("refuses a header of a different length", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer s3", SECRET)).toBe(false);
  });

  it("accepts exactly Bearer <secret>", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
});

describe("retention cleanup", () => {
  it("uses the documented retention periods", () => {
    expect(RETENTION).toEqual({ checkDays: 30, excerptDays: 90, resolvedFlagDays: 90, aiUsageDays: 90, shadowDays: 30 });
  });

  it("runs all eight operations in one array transaction and returns the counts", async () => {
    const { db, calls } = fakeDb();
    const result = await runCleanup(db, NOW);
    expect(result).toEqual({ checksDeleted: 3, excerptsCleared: 2, flagsDeleted: 1, aiUsageDeleted: 9, discoveriesDeleted: 6, shadowDeleted: 7, emailTokensDeleted: 8 });
    expect(calls.map((c) => c.op)).toEqual([
      "check.deleteMany",
      "scamReport.updateMany",
      "flag.deleteMany",
      "aiUsage.deleteMany",
      "aiUserUsage.deleteMany",
      "boardDiscovery.deleteMany",
      "aiShadow.deleteMany",
      "emailToken.deleteMany",
      "$transaction",
    ]);
    expect(argsOf(calls, "$transaction")).toBe(8);
  });

  it("deletes emailed link tokens once used or expired", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "emailToken.deleteMany")).toEqual({ where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: NOW } }] } });
  });

  it("deletes shadow-mode rows after 30 days", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "aiShadow.deleteMany")).toEqual({ where: { createdAt: { lt: new Date(NOW.getTime() - 30 * 86_400_000) } } });
  });

  it("deletes board-search results once they expire", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "boardDiscovery.deleteMany")).toEqual({ where: { expiresAt: { lt: NOW } } });
  });

  it("deletes AI usage counters (numbers only) after 90 days", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "aiUsage.deleteMany")).toEqual({ where: { day: { lt: "2026-07-17" } } });
    expect(argsOf(calls, "aiUserUsage.deleteMany")).toEqual({ where: { day: { lt: "2026-07-17" } } });
  });

  it("deletes checks older than 30 days that are anonymous or unsaved", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "check.deleteMany")).toEqual({
      where: {
        createdAt: { lt: new Date("2026-09-15T12:00:00Z") },
        OR: [{ userId: null }, { saved: false }],
      },
    });
  });

  it("keeps saved checks of signed-in users", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    const { where } = argsOf(calls, "check.deleteMany") as {
      where: { OR: Record<string, unknown>[] };
    };
    // A row matches the OR only if one branch matches it.
    const matches = (row: { userId: string | null; saved: boolean }) =>
      where.OR.some((cond) => Object.entries(cond).every(([k, v]) => row[k as keyof typeof row] === v));
    expect(matches({ userId: "u1", saved: true })).toBe(false);
    expect(matches({ userId: "u1", saved: false })).toBe(true);
    expect(matches({ userId: null, saved: true })).toBe(true);
    expect(matches({ userId: null, saved: false })).toBe(true);
  });

  it("clears scam report excerpts 90 days after the report was created", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "scamReport.updateMany")).toEqual({
      where: { createdAt: { lt: new Date("2026-07-17T12:00:00Z") }, redactedExcerpt: { not: null } },
      data: { redactedExcerpt: null },
    });
  });

  it("deletes only resolved flags 90 days after resolution", async () => {
    const { db, calls } = fakeDb();
    await runCleanup(db, NOW);
    expect(argsOf(calls, "flag.deleteMany")).toEqual({
      where: { status: { in: ["UPHELD", "REJECTED"] }, resolvedAt: { lt: new Date("2026-07-17T12:00:00Z") } },
    });
  });
});
