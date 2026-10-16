import { describe, expect, it } from "vitest";
import { autoGrowHeight } from "@/app/components/AutoGrowTextarea";

describe("autoGrowHeight", () => {
  it("falls back to the one-line rows=1 size when empty", () => {
    expect(autoGrowHeight("", 120, 1, 1)).toBe("");
  });

  it("adds the borders to scrollHeight for a border-box textarea", () => {
    expect(autoGrowHeight("hello", 46, 1, 1)).toBe("48px");
    expect(autoGrowHeight("a\nb\nc", 92.4, 1, 1)).toBe("95px");
  });

  it("ignores a missing measurement", () => {
    expect(autoGrowHeight("hello", 0, 1, 1)).toBe("");
    expect(autoGrowHeight("hello", Number.NaN, 1, 1)).toBe("");
  });
});
