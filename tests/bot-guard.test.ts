import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const checkBotId = vi.fn();
vi.mock("botid/server", () => ({ checkBotId: (...args: unknown[]) => checkBotId(...args) }));

import { BOT_ERRORS, guardForm, hasAutomationKey, issueFormToken, looksLikeBot, verifyFormToken } from "@/lib/bot-guard";
import { MAX_FORM_AGE_MS, MIN_FORM_MS } from "@/lib/form-guard";

const KEY = "k".repeat(32);
const T0 = 1_800_000_000_000;

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-".padEnd(40, "x");
});

afterEach(() => {
  vi.unstubAllEnvs();
  checkBotId.mockReset();
});

describe("form token", () => {
  it("accepts its own token after the minimum time and before it expires", () => {
    const token = issueFormToken("auth", T0);
    expect(verifyFormToken(token, "auth", T0 + MIN_FORM_MS)).toBe("ok");
    expect(verifyFormToken(token, "auth", T0 + MAX_FORM_AGE_MS)).toBe("ok");
  });

  it("refuses a token sent too soon or too late", () => {
    const token = issueFormToken("auth", T0);
    expect(verifyFormToken(token, "auth", T0 + MIN_FORM_MS - 1)).toBe("too_fast");
    expect(verifyFormToken(token, "auth", T0 + MAX_FORM_AGE_MS + 1)).toBe("expired");
  });

  it("refuses missing, malformed, tampered and other-form tokens", () => {
    const token = issueFormToken("auth", T0);
    const later = T0 + 10_000;
    expect(verifyFormToken(undefined, "auth", later)).toBe("invalid");
    expect(verifyFormToken("nope", "auth", later)).toBe("invalid");
    expect(verifyFormToken(`${T0 - 60_000}.${token.split(".")[1]}`, "auth", later)).toBe("invalid"); // backdated
    expect(verifyFormToken(`${token}x`, "auth", later)).toBe("invalid");
    expect(verifyFormToken(`${token}.extra`, "auth", later)).toBe("invalid");
    expect(verifyFormToken(token, "flag", later)).toBe("invalid");
  });
});

describe("automation key", () => {
  it("matches only a configured secret of 32+ bytes", () => {
    expect(hasAutomationKey({ "x-automation-key": KEY }, KEY)).toBe(true);
    expect(hasAutomationKey({ "x-automation-key": `${KEY}!` }, KEY)).toBe(false);
    expect(hasAutomationKey({}, KEY)).toBe(false);
    expect(hasAutomationKey({ "x-automation-key": "" }, undefined)).toBe(false);
    expect(hasAutomationKey({ "x-automation-key": "short" }, "short")).toBe(false);
  });
});

describe("guardForm", () => {
  const body = (extra: Record<string, unknown> = {}) => ({ username: "jo", password: "pw", ...extra });
  const later = T0 + 5_000;

  it("strips the guard fields when the token is valid", async () => {
    const result = await guardForm(body({ fax: "", formToken: issueFormToken("auth", T0) }), { purpose: "auth", headers: {}, now: later });
    expect(result).toEqual({ ok: true, body: body() });
  });

  it("refuses a filled decoy field even for trusted or automated requests", async () => {
    vi.stubEnv("AUTOMATION_BYPASS_SECRET", KEY);
    const headers = { "x-automation-key": KEY };
    expect(await guardForm(body({ fax: "555" }), { purpose: "auth", headers })).toEqual({ ok: false, error: BOT_ERRORS.rejected });
    expect(await guardForm(body({ fax: "555" }), { purpose: "flag", headers: {}, trusted: true })).toEqual({ ok: false, error: BOT_ERRORS.rejected });
  });

  it("refuses a missing token, and one sent too fast", async () => {
    expect(await guardForm(body(), { purpose: "auth", headers: {}, now: later })).toEqual({ ok: false, error: BOT_ERRORS.expired });
    const fast = await guardForm(body({ formToken: issueFormToken("auth", T0) }), { purpose: "auth", headers: {}, now: T0 + 500 });
    expect(fast).toEqual({ ok: false, error: BOT_ERRORS.tooFast });
  });

  it("lets the automation key and trusted API clients skip the token", async () => {
    vi.stubEnv("AUTOMATION_BYPASS_SECRET", KEY);
    expect(await guardForm(body(), { purpose: "auth", headers: { "x-automation-key": KEY } })).toEqual({ ok: true, body: body() });
    expect(await guardForm(body(), { purpose: "flag", headers: {}, trusted: true })).toEqual({ ok: true, body: body() });
  });

  it("passes non-object bodies through for the schema to reject", async () => {
    expect(await guardForm("text", { purpose: "auth", headers: {} })).toEqual({ ok: true, body: "text" });
  });

  it("refuses a valid token when BotID says bot", async () => {
    vi.stubEnv("VERCEL", "1");
    checkBotId.mockResolvedValue({ isBot: true });
    const result = await guardForm(body({ formToken: issueFormToken("auth", T0) }), { purpose: "auth", headers: {}, now: later });
    expect(result).toEqual({ ok: false, error: BOT_ERRORS.bot });
  });
});

describe("looksLikeBot", () => {
  it("never calls BotID off Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    expect(await looksLikeBot()).toBe(false);
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("follows BotID's verdict on Vercel and lets requests through if BotID fails", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    checkBotId.mockResolvedValueOnce({ isBot: false });
    expect(await looksLikeBot()).toBe(false);
    checkBotId.mockResolvedValueOnce({ isBot: true });
    expect(await looksLikeBot()).toBe(true);
    checkBotId.mockRejectedValueOnce(new Error("down"));
    expect(await looksLikeBot()).toBe(false);
  });
});

