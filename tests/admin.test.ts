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

function flagDb(openFlags = 0) {
  const calls: { op: string; args: unknown }[] = [];
  const rec = (op: string, result: unknown = { count: 1 }) => vi.fn(async (args: unknown) => (calls.push({ op, args }), result));
  return {
    calls,
    db: {
      flag: { update: rec("flag.update", { id: "f1" }), count: rec("flag.count", openFlags) },
      outcomeReport: { updateMany: rec("outcomeReport.updateMany") },
      scamReport: { updateMany: rec("scamReport.updateMany") },
    } as never,
  };
}

describe("resolveFlag", () => {
  const flag = { id: "f1", targetType: "SCAM_REPORT", targetId: "r1", resolutionNote: null };

  it("upheld removes the reported report and records when", async () => {
    const { db, calls } = flagDb();
    await resolveFlag(db, flag, { status: "UPHELD", resolutionNote: "Contained a name." }, NOW);
    expect(calls[0]).toMatchObject({ op: "flag.update", args: { data: { status: "UPHELD", resolutionNote: "Contained a name.", resolvedAt: NOW } } });
    expect(calls[1]).toEqual({ op: "scamReport.updateMany", args: { where: { id: "r1" }, data: { visibility: "REMOVED" } } });
  });

  it("rejected makes a hidden report visible again once no other flag holds it", async () => {
    const { db, calls } = flagDb(0);
    await resolveFlag(db, { ...flag, targetType: "OUTCOME_REPORT" }, { status: "REJECTED" }, NOW);
    expect(calls.at(-1)).toEqual({ op: "outcomeReport.updateMany", args: { where: { id: "r1", visibility: "HIDDEN_PENDING_REVIEW" }, data: { visibility: "VISIBLE" } } });
  });

  it("rejected keeps it hidden while another flag is still open", async () => {
    const { db, calls } = flagDb(1);
    await resolveFlag(db, flag, { status: "REJECTED" }, NOW);
    expect(calls.map((c) => c.op)).toEqual(["flag.update", "flag.count"]);
  });

  it("under review changes nothing else and clears resolvedAt", async () => {
    const { db, calls } = flagDb();
    await resolveFlag(db, flag, { status: "UNDER_REVIEW" }, NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ args: { data: { resolvedAt: null } } });
  });

  it("flags on companies, checks or the site touch no report", async () => {
    const { db, calls } = flagDb();
    await resolveFlag(db, { ...flag, targetType: "COMPANY" }, { status: "UPHELD" }, NOW);
    expect(calls.map((c) => c.op)).toEqual(["flag.update"]);
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
