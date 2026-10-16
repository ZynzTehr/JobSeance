import { describe, expect, it } from "vitest";
import { checkPassword } from "@/lib/auth/validation";
import { passwordRules } from "@/lib/auth/password-rules";

const met = (pw: string) => passwordRules(pw).map((r) => r.met);

describe("passwordRules (sign-up checklist)", () => {
  it("shows nothing met before typing", () => {
    expect(met("")).toEqual([false, false, false]);
  });
  it("marks length and bytes as met for a short password", () => {
    expect(met("short pass")).toEqual([false, true, true]);
  });
  it("meets everything at 15 characters", () => {
    expect(met("a".repeat(15))).toEqual([true, true, true]);
  });
  it("fails the byte rule for 20 emoji (80 bytes), like the server", () => {
    const pw = "😀".repeat(20);
    expect(met(pw)).toEqual([true, true, false]);
    expect(checkPassword(pw).ok).toBe(false);
  });
  it("agrees with checkPassword on every case", () => {
    for (const pw of ["", "x".repeat(14), "x".repeat(15), "x".repeat(64), "x".repeat(65), "é".repeat(36), "é".repeat(37)]) {
      expect(passwordRules(pw).every((r) => r.met)).toBe(checkPassword(pw).ok);
    }
  });
});
