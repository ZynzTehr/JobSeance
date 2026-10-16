import { describe, expect, it } from "vitest";
import { isFixedTarget, parsePrefill, REASON_LABEL, REASONS_FOR, SUBJECTS, subjectOf } from "@/app/report-a-problem/options";
import { FLAG_REASONS, FLAG_TARGETS, flagCreate } from "@/lib/schemas";

describe("Report a problem options", () => {
  it("labels every reason the API accepts, and offers only those", () => {
    expect(Object.keys(REASON_LABEL).sort()).toEqual([...FLAG_REASONS].sort());
    for (const reasons of Object.values(REASONS_FOR)) for (const r of reasons) expect(FLAG_REASONS).toContain(r);
    expect(REASONS_FOR.CHECK).toContain("score_wrong");
    expect(REASONS_FOR.SITE).toEqual(["privacy_request", "other"]);
  });

  it("covers every target type", () => {
    const subjects = SUBJECTS.map((s) => s.value);
    for (const t of FLAG_TARGETS) expect(subjects).toContain(subjectOf(t));
  });

  it("every offered target/reason pair passes the API schema", () => {
    for (const t of FLAG_TARGETS)
      for (const reason of REASONS_FOR[subjectOf(t)])
        expect(flagCreate.safeParse({ targetType: t, targetId: "x", reason, details: "d" }).success).toBe(true);
  });
});

describe("parsePrefill", () => {
  it("reads a check link as a fixed target", () => {
    const p = parsePrefill({ type: "CHECK", id: "abc123" }, FLAG_TARGETS);
    expect(p).toEqual({ type: "CHECK", id: "abc123", label: null });
    expect(isFixedTarget(p)).toBe(true);
  });

  it("accepts a lowercase type and keeps the company label", () => {
    expect(parsePrefill({ type: "company", id: "acme", label: "Acme Inc" }, FLAG_TARGETS)).toEqual({
      type: "COMPANY",
      id: "acme",
      label: "Acme Inc",
    });
  });

  it("ignores unknown types, and drops over-long ids", () => {
    expect(parsePrefill({ type: "NOPE", id: "x" }, FLAG_TARGETS)).toBeNull();
    expect(parsePrefill({}, FLAG_TARGETS)).toBeNull();
    const long = parsePrefill({ type: "CHECK", id: "a".repeat(101) }, FLAG_TARGETS);
    expect(long).toEqual({ type: "CHECK", id: null, label: null });
    expect(isFixedTarget(long)).toBe(false);
  });

  it("takes the first value of repeated params, and needs no id for the site", () => {
    expect(parsePrefill({ type: ["SITE", "CHECK"], id: "ignored" }, FLAG_TARGETS)).toEqual({ type: "SITE", id: null, label: null });
    expect(isFixedTarget(parsePrefill({ type: "SITE" }, FLAG_TARGETS))).toBe(true);
  });
});
