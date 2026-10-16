import { describe, expect, it } from "vitest";
import { checkPassword } from "@/lib/auth/validation";
import { passwordRules } from "@/lib/auth/password-rules";

const met = (pw: string) => passwordRules(pw).map((r) => r.met);

describe("passwordRules (sign-up checklist)", () => {
  it("shows nothing met before typing", () => {
    expect(met("")).toEqual([false, false, false, false]);
  });
  it("ticks each rule as it's satisfied", () => {
    expect(met("seance")).toEqual([false, false, false, false]);
    expect(met("Seance")).toEqual([false, true, false, false]);
    expect(met("Seance1")).toEqual([false, true, true, false]);
    expect(met("Seance1!")).toEqual([true, true, true, true]);
  });
  it("folds the 72-byte limit into the length rule", () => {
    const pw = "A1!" + "😀".repeat(20); // 23 characters, 83 bytes
    expect(met(pw)[0]).toBe(false);
    expect(checkPassword(pw).ok).toBe(false);
  });
  it("agrees with checkPassword on every case", () => {
    for (const pw of ["", "Short1!", "Seance1!", "seance1!", "SEANCE!!", "Seance11", "A1!" + "a".repeat(61), "A1!" + "a".repeat(62), "Éé1!" + "é".repeat(30), "  Eight-8 "]) {
      expect(passwordRules(pw).every((r) => r.met)).toBe(checkPassword(pw).ok);
    }
  });
});
