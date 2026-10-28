import { describe, expect, it, vi } from "vitest";
import { careersHostProblem, pendingDiscoveries, resolveFlag } from "@/lib/admin";
import { companyCreate, companyUpdate, flagUpdate } from "@/lib/schemas";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("careers hosts", () => {
  it("must sit under one of the company's official domains", () => {
    expect(careersHostProblem(["jobs.apple.com"], ["apple.com"])).toBeNull();
    expect(careersHostProblem(["metacareers.com"], ["meta.com"])).toMatch(/isn't under one of the company's official domains/);
    expect(careersHostProblem(["metacareers.com"], ["meta.com", "metacareers.com"])).toBeNull();
  });

  it("can't be a job site or a hiring system", () => {
    expect(careersHostProblem(["www.linkedin.com"], ["linkedin.com"])).toMatch(/job site/);
    expect(careersHostProblem(["acme.wd5.myworkdayjobs.com"], ["myworkdayjobs.com"])).toMatch(/hiring system/);
    expect(careersHostProblem(["careers-acme.icims.com"], ["icims.com"])).toMatch(/hiring system/);
  });

  it("schemas accept at most 10 valid hosts and reject unknown keys", () => {
    expect(companyUpdate.safeParse({ careersHosts: ["jobs.apple.com"] }).success).toBe(true);
    expect(companyUpdate.safeParse({ careersHosts: ["not a host"] }).success).toBe(false);
    expect(companyUpdate.safeParse({ careersHosts: Array.from({ length: 11 }, (_, i) => `h${i}.apple.com`) }).success).toBe(false);
    expect(companyUpdate.safeParse({ name: "Renamed" }).success).toBe(false);
    expect(companyUpdate.safeParse({}).success).toBe(false);
    expect(companyCreate.safeParse({ name: "Apple", officialDomains: ["apple.com"], ats: "NONE", careersHosts: ["jobs.apple.com"] }).success).toBe(true);
  });

  it("flag review takes a status and an optional note only", () => {
    expect(flagUpdate.safeParse({ status: "UPHELD", resolutionNote: "Removed the name." }).success).toBe(true);
    expect(flagUpdate.safeParse({ status: "OPEN" }).success).toBe(false);
    expect(flagUpdate.safeParse({ status: "REJECTED", targetId: "x" }).success).toBe(false);
  });
});

/** Fake db for resolveFlag: records every call; flag.count answers per status list. */
function flagDb(counts: { open?: number; upheld?: number } = {}) {
  const calls: { op: string; args: unknown }[] = [];
  const rec = (op: string, result: (args: unknown) => unknown = () => ({ count: 1 })) =>
    vi.fn(async (args: unknown) => (calls.push({ op, args }), result(args)));
  const tx = {
    flag: {
      update: rec("flag.update", () => ({ id: "f1" })),
      count: rec("flag.count", (args) =>
        JSON.stringify(args).includes("UPHELD") ? (counts.upheld ?? 0) : (counts.open ?? 0),
      ),
    },
    outcomeReport: { updateMany: rec("outcomeReport.updateMany") },
    scamReport: { updateMany: rec("scamReport.updateMany") },
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => (calls.push({ op: "$transaction", args: null }), fn(tx))) };
  return { calls, db: db as never };
}

describe("resolveFlag", () => {
  const flag = { id: "f1", targetType: "SCAM_REPORT", targetId: "r1", status: "OPEN", resolutionNote: null };

  it("upheld removes the reported report, inside one transaction, and records when", async () => {
    const { db, calls } = flagDb();
    await resolveFlag(db, flag, { status: "UPHELD", resolutionNote: "Contained a name." }, NOW);
    expect(calls[0].op).toBe("$transaction");
    expect(calls[1]).toMatchObject({ op: "flag.update", args: { data: { status: "UPHELD", resolutionNote: "Contained a name.", resolvedAt: NOW } } });
    expect(calls[2]).toEqual({ op: "scamReport.updateMany", args: { where: { id: "r1" }, data: { visibility: "REMOVED" } } });
  });

  it("rejected makes a hidden report visible again once no other open flag on the same report holds it", async () => {
    const { db, calls } = flagDb({ open: 0 });
    await resolveFlag(db, { ...flag, targetType: "OUTCOME_REPORT" }, { status: "REJECTED" }, NOW);
    // Pin the filter: same report, another flag, still open. Dropping any part would break the rule.
    expect(calls.find((c) => c.op === "flag.count")?.args).toEqual({
      where: { targetType: "OUTCOME_REPORT", targetId: "r1", id: { not: "f1" }, status: { in: ["OPEN", "UNDER_REVIEW"] } },
    });
    expect(calls.at(-1)).toEqual({ op: "outcomeReport.updateMany", args: { where: { id: "r1", visibility: "HIDDEN_PENDING_REVIEW" }, data: { visibility: "VISIBLE" } } });
  });

  it("rejected keeps it hidden while another flag is still open", async () => {
    const { db, calls } = flagDb({ open: 1 });
    await resolveFlag(db, flag, { status: "REJECTED" }, NOW);
    expect(calls.map((c) => c.op)).toEqual(["$transaction", "flag.update", "flag.count"]);
  });

  it("moving a flag off upheld undoes the removal unless another upheld flag stands", async () => {
    const undone = flagDb({ upheld: 0 });
    await resolveFlag(undone.db, { ...flag, status: "UPHELD" }, { status: "REJECTED" }, NOW);
    expect(undone.calls).toContainEqual({ op: "scamReport.updateMany", args: { where: { id: "r1", visibility: "REMOVED" }, data: { visibility: "VISIBLE" } } });

    const reviewing = flagDb({ upheld: 0 });
    await resolveFlag(reviewing.db, { ...flag, status: "UPHELD" }, { status: "UNDER_REVIEW" }, NOW);
    expect(reviewing.calls).toContainEqual({ op: "scamReport.updateMany", args: { where: { id: "r1", visibility: "REMOVED" }, data: { visibility: "HIDDEN_PENDING_REVIEW" } } });

    const stillRemoved = flagDb({ upheld: 1 });
    await resolveFlag(stillRemoved.db, { ...flag, status: "UPHELD" }, { status: "REJECTED" }, NOW);
    expect(stillRemoved.calls.filter((c) => c.op === "scamReport.updateMany" && JSON.stringify(c.args).includes("REMOVED"))).toEqual([]);
  });

  it("under review changes nothing else and clears resolvedAt", async () => {
    const { db, calls } = flagDb();
    await resolveFlag(db, flag, { status: "UNDER_REVIEW" }, NOW);
    expect(calls.map((c) => c.op)).toEqual(["$transaction", "flag.update"]);
    expect(calls[1]).toMatchObject({ args: { data: { resolvedAt: null } } });
  });

  it("flags on companies, checks or the site touch no report", async () => {
    const { db, calls } = flagDb();
    await resolveFlag(db, { ...flag, targetType: "COMPANY" }, { status: "UPHELD" }, NOW);
    expect(calls.map((c) => c.op)).toEqual(["$transaction", "flag.update"]);
  });
});

describe("pendingDiscoveries", () => {
  it("hides boards that are already in the directory", async () => {
    const rows = [
      { key: "acme", ats: "GREENHOUSE", board: "acme" },
      { key: "discord", ats: "GREENHOUSE", board: "Discord" },
    ];
    const db = {
      boardDiscovery: { findMany: vi.fn(async () => rows) },
      company: { findMany: vi.fn(async () => [{ ats: "GREENHOUSE", atsBoard: "discord" }]) },
    } as never;
    expect((await pendingDiscoveries(db, NOW)).map((r) => r.key)).toEqual(["acme"]);
  });
});
