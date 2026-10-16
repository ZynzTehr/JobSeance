import { describe, expect, it } from "vitest";
import { checkPassword, fieldErrors, loginSchema, signupSchema } from "@/lib/auth/validation";

const signup = (over: Partial<Record<"username" | "email" | "password", unknown>> = {}) =>
  signupSchema.safeParse({ username: "ada_1", email: "Ada@Example.com ", password: "x", ...over });

describe("signup usernames", () => {
  it("trims and lowercases, so Demo and demo are the same name", () => {
    const parsed = signup({ username: "  Demo " });
    expect(parsed.success && parsed.data.username).toBe("demo");
  });

  it.each([
    ["ab", "Username must be 3–20 letters, numbers or underscores."],
    ["bad name!", "Username must be 3–20 letters, numbers or underscores."],
    ["a".repeat(21), "Username must be 3–20 letters, numbers or underscores."],
    ["admin", "That username is reserved."],
    ["Admin", "That username is reserved."],
  ])("rejects %j", (username, message) => {
    const parsed = signup({ username });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(fieldErrors(parsed.error)).toEqual({ username: message });
  });

  it("normalizes email and rejects unknown keys", () => {
    const parsed = signup();
    expect(parsed.success && parsed.data.email).toBe("ada@example.com");
    expect(signupSchema.safeParse({ username: "ada_1", email: "a@b.co", password: "x", role: "ADMIN" }).success).toBe(false);
  });

  it("rejects a bad email on the email field", () => {
    const parsed = signup({ email: "not-an-email" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(Object.keys(fieldErrors(parsed.error))).toEqual(["email"]);
  });
});

describe("passwords", () => {
  it("accepts exactly 8 characters with the mix and rejects 7", () => {
    expect(checkPassword("Seance1!")).toEqual({ ok: true, password: "Seance1!" });
    expect(checkPassword("Sean1!x")).toEqual({ ok: false, message: "Password must be at least 8 characters." });
  });

  it("rejects 65 characters", () => {
    expect(checkPassword("A1!" + "a".repeat(62))).toEqual({ ok: false, message: "Password must be at most 64 characters." });
  });

  it("names exactly what's missing from the mix", () => {
    expect(checkPassword("alllowercase")).toEqual({ ok: false, message: "Password needs an uppercase letter, a number and a symbol." });
    expect(checkPassword("Uppercase1")).toEqual({ ok: false, message: "Password needs a symbol." });
    expect(checkPassword("Upper-case!")).toEqual({ ok: false, message: "Password needs a number." });
  });

  it("never trims", () => {
    expect(checkPassword("  Eight-8 ")).toEqual({ ok: true, password: "  Eight-8 " });
  });

  it("rejects passwords over 72 bytes instead of letting bcrypt truncate them", () => {
    // 20 emoji = 20 characters but 80 UTF-8 bytes.
    expect(checkPassword("😀".repeat(20)).ok).toBe(false);
  });

  it("normalizes to NFC, so composed and decomposed forms match", () => {
    const decomposed = "Cafe\u0301-password-1";
    const result = checkPassword(decomposed);
    expect(result).toEqual({ ok: true, password: "Café-password-1" });
  });
});

describe("login body", () => {
  it("requires both fields and nothing else", () => {
    expect(loginSchema.safeParse({ username: "demo", password: "pw" }).success).toBe(true);
    expect(loginSchema.safeParse({ username: "demo" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "pw" }).success).toBe(false);
  });
});
