import { describe, expect, it } from "vitest";
import { normalizeRole } from "@/lib/api";
import { excerpt, redact } from "@/lib/redact";
import { aggregate, type AggregateRow } from "@/lib/reports";
import { companyCreate, flagCreate, reportCreate, reportUpdate, scamReportUpdate } from "@/lib/schemas";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const row = (userId: string, over: Partial<AggregateRow> = {}): AggregateRow => ({
  userId,
  outcome: "APPLIED",
  stageReached: "APPLIED",
  appliedAt: daysAgo(10),
  lastInterviewAt: null,
  ...over,
});

describe("community aggregate", () => {
  it("hides the breakdown below 3 distinct reporters, even with many reports", () => {
    const result = aggregate([row("a"), row("a"), row("b"), row("b")], NOW);
    expect(result).toEqual({ reports: 4, shown: false, reason: "Not rated: fewer than 3 people have reported" });
  });

  it("counts outcomes, stages and the ghosted share once 3 people reported", () => {
    const result = aggregate(
      [
        row("a", { outcome: "NO_RESPONSE", appliedAt: daysAgo(60) }), // ghosted: 60 days since applying
        row("b", { outcome: "NO_RESPONSE", stageReached: "INTERVIEWED", appliedAt: daysAgo(90), lastInterviewAt: daysAgo(20) }), // only 20 since interview
        row("c", { outcome: "REJECTED" }),
        row("d", { outcome: "NO_RESPONSE", appliedAt: daysAgo(45) }), // exactly 45 days counts
      ],
      NOW,
    );
    expect(result).toEqual({
      reports: 4,
      shown: true,
      byOutcome: { NO_RESPONSE: 3, REJECTED: 1 },
      byStage: { APPLIED: 3, INTERVIEWED: 1 },
      ghostedShare: 0.5,
    });
  });

  it("never exposes users, role titles, dates or notes", () => {
    const keys = Object.keys(aggregate([row("a"), row("b"), row("c")], NOW)).sort();
    expect(keys).toEqual(["byOutcome", "byStage", "ghostedShare", "reports", "shown"]);
  });
});

describe("redaction", () => {
  it("keeps the email domain but drops the local part", () => {
    expect(redact("Write to hr.team+jobs@bramblecloud-careers.example now")).toBe("Write to [email]@bramblecloud-careers.example now");
  });

  it("removes SSNs, phone numbers and long digit runs", () => {
    expect(redact("SSN 123-45-6789, call (555) 123-4567, acct 12345678")).toBe("SSN [ssn], call [phone], acct [number]");
  });

  it("caps excerpts at 500 characters and tidies whitespace", () => {
    const out = excerpt(`Hello\n\n   there ${"x".repeat(600)}`);
    expect(out.length).toBe(500);
    expect(out.startsWith("Hello there x")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("report schemas", () => {
  const base = { company: "quietwater", roleTitle: "Data Analyst", appliedAt: "2026-09-01", firstHand: true };

  it("accepts a first-hand report", () => {
    expect(reportCreate.safeParse(base).success).toBe(true);
  });

  it("requires the first-hand confirmation", () => {
    const parsed = reportCreate.safeParse({ ...base, firstHand: false });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe("Confirm this is your own first-hand experience.");
  });

  it.each([
    ["an email", "Recruiter was jane@quietwater.example"],
    ["a phone number", "Call them at 555 123 4567"],
  ])("rejects a note containing %s", (_label, note) => {
    const parsed = reportCreate.safeParse({ ...base, note });
    expect(parsed.error?.issues[0].message).toBe("Leave out email addresses and phone numbers.");
  });

  it("rejects future dates and interviews before applying", () => {
    expect(reportCreate.safeParse({ ...base, appliedAt: "2099-01-01" }).error?.issues[0].message).toBe("That date is in the future.");
    expect(reportCreate.safeParse({ ...base, lastInterviewAt: "2026-08-01" }).error?.issues[0].path).toEqual(["lastInterviewAt"]);
  });

  it("rejects unknown keys and empty updates", () => {
    expect(reportCreate.safeParse({ ...base, userId: "someone-else" }).error?.issues[0].code).toBe("unrecognized_keys");
    expect(reportUpdate.safeParse({}).success).toBe(false);
    expect(reportUpdate.safeParse({ outcome: "NO_RESPONSE" }).success).toBe(true);
    expect(scamReportUpdate.safeParse({}).success).toBe(false);
  });
});

describe("company and flag schemas", () => {
  it("requires a board token exactly when the company uses an ATS", () => {
    const company = { name: "Acme", officialDomains: ["acme.com"] };
    expect(companyCreate.safeParse({ ...company, ats: "GREENHOUSE" }).success).toBe(false);
    expect(companyCreate.safeParse({ ...company, ats: "GREENHOUSE", atsBoard: "acme" }).success).toBe(true);
    expect(companyCreate.safeParse({ ...company, ats: "NONE", atsBoard: "acme" }).success).toBe(false);
    expect(companyCreate.safeParse({ ...company, ats: "NONE" }).success).toBe(true);
  });

  it("only takes the listed flag reasons", () => {
    const flag = { targetType: "COMPANY", targetId: "quietwater", details: "Wrong" };
    expect(flagCreate.safeParse({ ...flag, reason: "personal_info" }).success).toBe(true);
    expect(flagCreate.safeParse({ ...flag, reason: "i_disagree" }).success).toBe(false);
  });
});

describe("normalizeRole", () => {
  it("makes duplicates collide regardless of case and spacing", () => {
    expect(normalizeRole("  Senior   Data Analyst ")).toBe("senior data analyst");
  });
});
