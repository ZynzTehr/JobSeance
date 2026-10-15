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
  it("accepts exactly 15 characters and rejects 14", () => {
    expect(checkPassword("a".repeat(15))).toEqual({ ok: true, password: "a".repeat(15) });
    expect(checkPassword("a".repeat(14))).toEqual({ ok: false, message: "Password must be at least 15 characters." });
  });

  it("rejects 65 characters", () => {
    expect(checkPassword("a".repeat(65))).toEqual({ ok: false, message: "Password must be at most 64 characters." });
  });

  it("never trims", () => {
    expect(checkPassword("  fourteen-chr ")).toEqual({ ok: true, password: "  fourteen-chr " });
  });

  it("rejects passwords over 72 bytes instead of letting bcrypt truncate them", () => {
    // 20 emoji = 20 characters but 80 UTF-8 bytes.
    expect(checkPassword("😀".repeat(20)).ok).toBe(false);
  });

  it("normalizes to NFC, so composed and decomposed forms match", () => {
    const decomposed = "cafe\u0301-password-long";
    const result = checkPassword(decomposed);
    expect(result).toEqual({ ok: true, password: "café-password-long" });
  });
});

describe("login body", () => {
  it("requires both fields and nothing else", () => {
    expect(loginSchema.safeParse({ username: "demo", password: "pw" }).success).toBe(true);
    expect(loginSchema.safeParse({ username: "demo" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "pw" }).success).toBe(false);
  });
});
