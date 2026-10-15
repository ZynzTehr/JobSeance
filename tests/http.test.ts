import { describe, expect, it } from "vitest";
import { checkRequest, clientIp, rateLimit } from "@/lib/http";

const env = { APP_URL: "https://job-seance.vercel.app" };
const json = { "content-type": "application/json" };

describe("checkRequest", () => {
  it("lets safe methods through untouched", () => {
    expect(checkRequest("GET", {}, "write", env)).toBeNull();
  });

  it("returns 415 for a form-encoded write, before any origin check", () => {
    const result = checkRequest(
      "POST",
      { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      "auth",
      env,
    );
    expect(result?.status).toBe(415);
  });

  it("accepts JSON with a charset parameter", () => {
    expect(checkRequest("POST", { "content-type": "application/json; charset=utf-8" }, "auth", env)).toBeNull();
  });

  describe("auth routes (signup, login, logout)", () => {
    it("pass with no Origin, like Postman and curl", () => {
      expect(checkRequest("POST", json, "auth", env)).toBeNull();
    });
    it("pass from our own origin", () => {
      expect(checkRequest("POST", { ...json, origin: "https://job-seance.vercel.app" }, "auth", env)).toBeNull();
    });
    it("get 403 from a foreign origin", () => {
      expect(checkRequest("POST", { ...json, origin: "https://evil.example" }, "auth", env)?.status).toBe(403);
    });
    it("get 403 when the browser says cross-site", () => {
      expect(checkRequest("POST", { ...json, "sec-fetch-site": "cross-site" }, "auth", env)?.status).toBe(403);
    });
  });

  describe("cookie-authenticated writes", () => {
    it("get 403 with no Origin", () => {
      expect(checkRequest("DELETE", json, "write", env)?.status).toBe(403);
    });
    it("pass when same-origin", () => {
      expect(checkRequest("POST", { ...json, "sec-fetch-site": "same-origin" }, "write", env)).toBeNull();
    });
    it("pass with a Bearer header and no Origin (the cookie is ignored then)", () => {
      expect(checkRequest("POST", { ...json, authorization: "Bearer abc" }, "write", env)).toBeNull();
    });
    it("accept the preview's own URL when APP_URL is unset", () => {
      const preview = { VERCEL_URL: "job-seance-abc.vercel.app" };
      expect(checkRequest("POST", { ...json, origin: "https://job-seance-abc.vercel.app" }, "write", preview)).toBeNull();
    });
  });

  it("reads Web Headers too", () => {
    const headers = new Headers({ "content-type": "text/plain" });
    expect(checkRequest("POST", headers, "write", env)?.status).toBe(415);
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIp({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })).toBe("1.1.1.1");
    expect(clientIp({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })).toBe("2.2.2.2");
    expect(clientIp({})).toBe("unknown");
  });
});

describe("rateLimit", () => {
  it("allows the limit, then returns retryAfter until the window resets", () => {
    const key = `test:${Math.random()}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, 2, 60, t0)).toEqual({ ok: true });
    expect(rateLimit(key, 2, 60, t0 + 1)).toEqual({ ok: true });
    expect(rateLimit(key, 2, 60, t0 + 10_000)).toEqual({ ok: false, retryAfter: 50 });
    expect(rateLimit(key, 2, 60, t0 + 60_000)).toEqual({ ok: true });
  });
});
