import bcrypt from "bcryptjs";
import type { NextApiRequest, NextApiResponse } from "next";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Email verification and password reset: the Postmark sender, the one-time tokens, the flows
// and every route, against an in-memory database and a stubbed fetch. Nothing reaches the network.

process.env.JWT_SECRET = "email-flows-test-secret-0123456789abcdef";
const AUTOMATION_KEY = "email-flows-automation-key-0123456789abcdef";
process.env.AUTOMATION_BYPASS_SECRET = AUTOMATION_KEY;

type UserRow = {
  id: string;
  username: string | null;
  email: string;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
  name: string | null;
  role: "USER";
  tokenVersion: number;
  createdAt: Date;
};
type TokenRow = {
  id: string;
  userId: string;
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD";
  tokenHash: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};
type Where = Record<string, unknown>;

const users = new Map<string, UserRow>();
const tokens: TokenRow[] = [];

/** Just enough of Prisma's where syntax for these queries: equality, { not }, { gt }, OR and NOT. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Where[]).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Where);
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; gt?: Date };
      if ("not" in c) return value !== c.not;
      if ("gt" in c) return value instanceof Date && value > c.gt!;
    }
    return value === cond;
  });
}

function pick(row: Record<string, unknown>, select?: Record<string, unknown>) {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) out[key] = key === "accounts" ? [] : row[key];
  return out;
}

function applyData(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === "object" && "increment" in value ? (row[key] as number) + (value.increment as number) : value;
  }
}

let ids = 0;
const fakeDb = {
  user: {
    create: async ({ data, select }: { data: { username: string; email: string; passwordHash: string }; select?: Record<string, unknown> }) => {
      const row = addUser({ username: data.username, email: data.email, passwordHash: data.passwordHash, tokenVersion: 0 });
      return pick(row, select);
    },
    findUnique: async ({ where, select }: { where: { id?: string; email?: string }; select?: Record<string, unknown> }) => {
      const row = where.id ? users.get(where.id) : [...users.values()].find((u) => u.email === where.email);
      return row ? pick(row, select) : null;
    },
    findFirst: async ({ where, select }: { where: Where; select?: Record<string, unknown> }) => {
      const row = [...users.values()].find((u) => matches(u, where));
      return row ? pick(row, select) : null;
    },
    update: async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = users.get(where.id)!;
      applyData(row, data);
      return pick(row, select);
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const rows = [...users.values()].filter((u) => matches(u, where));
      for (const row of rows) applyData(row, data);
      return { count: rows.length };
    },
  },
  emailToken: {
    create: async ({ data }: { data: Omit<TokenRow, "id" | "usedAt" | "createdAt"> }) => {
      ids += 1;
      const row: TokenRow = { id: `tok${ids}`, usedAt: null, createdAt: new Date(), ...data };
      tokens.push(row);
      return { id: row.id };
    },
    deleteMany: async ({ where }: { where: Where }) => {
      const before = tokens.length;
      for (let i = tokens.length - 1; i >= 0; i -= 1) if (matches(tokens[i], where)) tokens.splice(i, 1);
      return { count: before - tokens.length };
    },
    findFirst: async ({ where, select }: { where: Where; select?: Record<string, unknown> }) => {
      const row = tokens.find((t) => matches(t, where));
      return row ? pick(row, select) : null;
    },
    findUnique: async ({ where, select }: { where: { tokenHash: string }; select?: Record<string, unknown> }) => {
      const row = tokens.find((t) => t.tokenHash === where.tokenHash);
      return row ? pick(row, select) : null;
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const rows = tokens.filter((t) => matches(t, where));
      for (const row of rows) applyData(row, data);
      return { count: rows.length };
    },
  },
  account: { findUnique: async () => null },
  $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
};

vi.mock("@/lib/db", () => ({ getDb: () => fakeDb }));

const { POSTMARK_URL, emailEnabled, postmarkBody, sendEmail } = await import("@/lib/email");
const { EMAIL_TOKEN_TTL_MS, consumeEmailToken, hashToken, issueEmailToken, peekEmailToken } = await import("@/lib/auth/email-tokens");
const { FORGOT_REPLY, resetPassword, verifyEmail } = await import("@/lib/auth/email-flows");
const { EMAIL_LINK_LIFETIME, processors } = await import("@/lib/legal");
const forgotRoute = (await import("@/pages/api/auth/forgot-password")).default;
const resetRoute = (await import("@/pages/api/auth/reset-password")).default;
const signupRoute = (await import("@/pages/api/auth/signup")).default;
const verifyRoute = (await import("@/pages/api/auth/verify-email")).default;
const resendRoute = await import("@/app/api/v1/me/verify-email/route");
const meRoute = await import("@/app/api/v1/me/route");
const { signToken } = await import("@/lib/auth/session");

type Db = Parameters<typeof issueEmailToken>[0];
const db = fakeDb as unknown as Db;

const ON = { EMAIL_ENABLED: "1", POSTMARK_SERVER_TOKEN: "pm-server-token-test", EMAIL_FROM: "JobSeance <accounts@jobseance.example>" };
const PASSWORD = "Old-passw0rd!";
const NEW_PASSWORD = "New-passw0rd?";
const oldHash = bcrypt.hashSync(PASSWORD, 4);

let seq = 0;
function addUser(overrides: Partial<UserRow> = {}): UserRow {
  seq += 1;
  const row: UserRow = {
    id: `user${seq}`,
    username: `ada${seq}`,
    email: `ada${seq}@example.com`,
    emailVerifiedAt: null,
    passwordHash: oldHash,
    name: null,
    role: "USER",
    tokenVersion: 3,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
  users.set(row.id, row);
  return row;
}

/** A stubbed fetch that records Postmark calls and answers with `status`. */
function stubPostmark(status = 200, body: unknown = { ErrorCode: 0, Message: "OK" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, sent: () => calls.map((c) => JSON.parse(String(c.init.body)) as Record<string, unknown>) };
}

let ipSeq = 0;
async function callPages(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, body: unknown, extraHeaders: Record<string, string> = {}) {
  ipSeq += 1;
  const req = {
    method: "POST",
    headers: { "content-type": "application/json", "x-automation-key": AUTOMATION_KEY, "x-real-ip": `10.0.0.${ipSeq}`, ...extraHeaders },
    body,
  } as unknown as NextApiRequest;
  const out = { status: 200, json: undefined as unknown };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(value: unknown) {
      out.json = value;
      return res;
    },
    setHeader() {
      return res;
    },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return out;
}

function callApp(handler: (r: NextRequest) => Promise<Response>, method: string, path: string, user: UserRow, body: unknown) {
  return handler(
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${signToken(user)}` },
      body: JSON.stringify(body),
    }),
  );
}

const linkToken = (email: Record<string, unknown>) => String(email.TextBody).match(/token=([\w-]+)/)?.[1] ?? "";

beforeEach(() => {
  users.clear();
  tokens.length = 0;
  for (const key of Object.keys(ON)) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of Object.keys(ON)) delete process.env[key];
});

describe("emailEnabled and the Postmark sender", () => {
  it("is on only when all three settings are set and EMAIL_ENABLED is exactly 1", () => {
    expect(emailEnabled(ON)).toBe(true);
    expect(emailEnabled({})).toBe(false);
    expect(emailEnabled({ ...ON, EMAIL_ENABLED: "true" })).toBe(false);
    expect(emailEnabled({ ...ON, EMAIL_ENABLED: "0" })).toBe(false);
    expect(emailEnabled({ ...ON, POSTMARK_SERVER_TOKEN: "" })).toBe(false);
    expect(emailEnabled({ ...ON, EMAIL_FROM: undefined })).toBe(false);
  });

  it("makes no network call while off or under USE_FIXTURES=1", async () => {
    const { fetchMock } = stubPostmark();
    const email = { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" };
    expect(await sendEmail(email, {})).toBe(false);
    expect(await sendEmail(email, { ...ON, EMAIL_ENABLED: "" })).toBe(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendEmail(email, { ...ON, USE_FIXTURES: "1" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts Postmark's documented request shape with tracking off", async () => {
    const { calls } = stubPostmark();
    const email = { to: "grace@example.com", subject: "Hello", text: "plain", html: "<p>html</p>" };
    expect(await sendEmail(email, ON)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(POSTMARK_URL);
    expect(POSTMARK_URL).toBe("https://api.postmarkapp.com/email");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": ON.POSTMARK_SERVER_TOKEN,
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      From: ON.EMAIL_FROM,
      To: "grace@example.com",
      Subject: "Hello",
      TextBody: "plain",
      HtmlBody: "<p>html</p>",
      MessageStream: "outbound",
      TrackOpens: false,
      TrackLinks: "None",
    });
    expect(postmarkBody("f", email).MessageStream).toBe("outbound");
  });

  it("returns false on a Postmark error and logs only numbers, never the address or Postmark's message", async () => {
    stubPostmark(422, { ErrorCode: 300, Message: "Invalid 'To' address: 'grace@example.com'." });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ to: "grace@example.com", subject: "s", text: "t", html: "h" }, ON)).toBe(false);
    expect(errors).toHaveBeenCalledWith("email_send_failed status=422 code=300");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("grace");
  });

  it("returns false when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("connect ECONNREFUSED"))));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ to: "a@example.com", subject: "s", text: "t", html: "h" }, ON)).toBe(false);
  });
});

describe("one-time email tokens", () => {
  const NOW = new Date("2026-10-30T12:00:00Z");

  it("stores only the SHA-256 hash of a 32-byte base64url token, with the documented lifetimes", async () => {
    const user = addUser();
    const verify = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email }, NOW);
    const reset = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email }, NOW);
    expect(verify).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(verify, "base64url")).toHaveLength(32);
    expect(tokens.map((t) => t.tokenHash)).toEqual([hashToken(verify), hashToken(reset)]);
    expect(JSON.stringify(tokens)).not.toContain(verify);
    expect(tokens[0].expiresAt.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(tokens[1].expiresAt.getTime() - NOW.getTime()).toBe(30 * 60 * 1000);
    expect(EMAIL_TOKEN_TTL_MS).toEqual({ VERIFY_EMAIL: 86_400_000, RESET_PASSWORD: 1_800_000 });
    expect(EMAIL_LINK_LIFETIME).toEqual({ verify: "24 hours", reset: "30 minutes" });
  });

  it("works once, and two requests racing with one token get one success", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email }, NOW);
    const results = await Promise.all([consumeEmailToken(db, token, "VERIFY_EMAIL", NOW), consumeEmailToken(db, token, "VERIFY_EMAIL", NOW)]);
    expect(results.filter(Boolean)).toEqual([{ userId: user.id, email: user.email }]);
    expect(await consumeEmailToken(db, token, "VERIFY_EMAIL", NOW)).toBeNull();
  });

  it("refuses an expired token, a token for the other purpose and a malformed one", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email }, NOW);
    expect(await consumeEmailToken(db, token, "VERIFY_EMAIL", NOW)).toBeNull();
    expect(await consumeEmailToken(db, token, "RESET_PASSWORD", new Date(NOW.getTime() + 30 * 60 * 1000))).toBeNull();
    expect(await consumeEmailToken(db, "not-a-token", "RESET_PASSWORD", NOW)).toBeNull();
    expect(await consumeEmailToken(db, token, "RESET_PASSWORD", NOW)).not.toBeNull(); // still unused until then
  });

  it("a new token replaces the user's unused one of the same purpose only", async () => {
    const user = addUser();
    const first = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email }, NOW);
    const reset = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email }, NOW);
    const second = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email }, NOW);
    expect(await consumeEmailToken(db, first, "VERIFY_EMAIL", NOW)).toBeNull();
    expect(await consumeEmailToken(db, second, "VERIFY_EMAIL", NOW)).not.toBeNull();
    expect(await consumeEmailToken(db, reset, "RESET_PASSWORD", NOW)).not.toBeNull();
  });

  it("peeking (what opening the page does) never uses the token", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email }, NOW);
    expect(await peekEmailToken(db, token, "VERIFY_EMAIL", NOW)).toBe(true);
    expect(await peekEmailToken(db, token, "VERIFY_EMAIL", NOW)).toBe(true);
    expect(await peekEmailToken(db, token, "RESET_PASSWORD", NOW)).toBe(false);
    expect(await peekEmailToken(db, undefined, "VERIFY_EMAIL", NOW)).toBe(false);
    expect(await consumeEmailToken(db, token, "VERIFY_EMAIL", NOW)).not.toBeNull();
    expect(await peekEmailToken(db, token, "VERIFY_EMAIL", NOW)).toBe(false);
  });
});

describe("verifyEmail and resetPassword", () => {
  it("verifies only when the link went to the account's current address", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email });
    users.get(user.id)!.email = "new-address@example.com"; // changed after the link was sent
    expect(await verifyEmail(db, token)).toBe("email_changed");
    expect(users.get(user.id)!.emailVerifiedAt).toBeNull();

    const fresh = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: "new-address@example.com" });
    expect(await verifyEmail(db, fresh)).toBe("verified");
    expect(users.get(user.id)!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("reset sets the new hash, bumps tokenVersion and marks the email verified", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email });
    expect(await resetPassword(db, token, NEW_PASSWORD)).toBe("reset");
    const row = users.get(user.id)!;
    expect(row.tokenVersion).toBe(4);
    expect(await bcrypt.compare(NEW_PASSWORD, row.passwordHash!)).toBe(true);
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await resetPassword(db, token, "Another-passw0rd!")).toBe("invalid");
    expect(users.get(user.id)!.tokenVersion).toBe(4);
  });

  it("reset is refused once the account's email has changed, and nothing is written", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email });
    users.get(user.id)!.email = "someone-else@example.com";
    expect(await resetPassword(db, token, NEW_PASSWORD)).toBe("invalid");
    expect(users.get(user.id)!).toMatchObject({ passwordHash: oldHash, tokenVersion: 3, emailVerifiedAt: null });
  });
});

describe("while email is off (the default)", () => {
  it("every email route is a 404 and nothing is sent", async () => {
    const { fetchMock } = stubPostmark();
    const user = addUser();
    for (const [route, body] of [
      [forgotRoute, { email: user.email }],
      [resetRoute, { token: "x".repeat(43), newPassword: NEW_PASSWORD }],
      [verifyRoute, { token: "x".repeat(43) }],
    ] as const) {
      const res = await callPages(route, body);
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ error: { code: "not_found", message: "Not found." } });
    }
    const resend = await callApp(resendRoute.POST, "POST", "/api/v1/me/verify-email", user, {});
    expect(resend.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(0);
  });

  it("changing the email sends nothing and reports no verification", async () => {
    const { fetchMock } = stubPostmark();
    const user = addUser();
    const res = await callApp(meRoute.PATCH, "PATCH", "/api/v1/me", user, { currentPassword: PASSWORD, email: "grace@example.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).verificationSent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("while email is on", () => {
  beforeEach(() => Object.assign(process.env, ON));

  it("forgot-password answers identically for a password account, an unknown address and a social-only account", async () => {
    const { sent } = stubPostmark();
    const withPassword = addUser({ email: "has-password@example.com" });
    addUser({ email: "social@example.com", username: null, passwordHash: null });

    const started = Date.now();
    const [a, b, c] = await Promise.all([
      callPages(forgotRoute, { email: " Has-Password@Example.com " }),
      callPages(forgotRoute, { email: "nobody@example.com" }),
      callPages(forgotRoute, { email: "social@example.com" }),
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400); // the minimum reply time
    for (const res of [a, b, c]) expect(res).toEqual({ status: 202, json: FORGOT_REPLY });

    const emails = sent();
    expect(emails.map((e) => e.To)).toEqual([withPassword.email]);
    expect(emails[0].Subject).toBe("Reset your JobSeance password");
    expect(emails[0].TextBody).toContain("lasts 30 minutes");
    expect(emails[0].TextBody).toContain("If you didn't ask for this, ignore this email");
    expect(emails[0].TextBody).toContain("/reset-password?token=");
    expect(tokens.map((t) => [t.userId, t.purpose])).toEqual([[withPassword.id, "RESET_PASSWORD"]]);
  });

  it("forgot-password hides a Postmark failure behind the same reply", async () => {
    stubPostmark(500, { ErrorCode: 701, Message: "Internal error" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    addUser({ email: "fails@example.com" });
    const res = await callPages(forgotRoute, { email: "fails@example.com" });
    expect(res).toEqual({ status: 202, json: FORGOT_REPLY });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("fails@");
  });

  it("forgot-password still runs the form guard and validates the address", async () => {
    stubPostmark();
    const decoy = await callPages(forgotRoute, { email: "a@example.com", fax: "555" });
    expect(decoy.status).toBe(400);
    const noToken = await callPages(forgotRoute, { email: "a@example.com" }, { "x-automation-key": "" });
    expect((noToken.json as { error: { code: string } }).error.code).toBe("form_expired");
    const bad = await callPages(forgotRoute, { email: "not an email" });
    expect(bad.status).toBe(400);
    const extra = await callPages(forgotRoute, { email: "a@example.com", admin: true });
    expect(extra.status).toBe(400);
  });

  it("reset-password: a weak password keeps the link; a good one sets it and signs out everywhere", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email });

    const weak = await callPages(resetRoute, { token, newPassword: "short" });
    expect(weak.status).toBe(400);
    expect((weak.json as { error: { fields: Record<string, string> } }).error.fields.newPassword).toBeTruthy();
    expect(tokens[0].usedAt).toBeNull();

    const ok = await callPages(resetRoute, { token, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(users.get(user.id)!.tokenVersion).toBe(4);

    const again = await callPages(resetRoute, { token, newPassword: NEW_PASSWORD });
    expect(again.status).toBe(400);
    expect((again.json as { error: { code: string } }).error.code).toBe("invalid_token");
  });

  it("verify-email route uses the link once", async () => {
    const user = addUser();
    const token = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email });
    expect((await callPages(verifyRoute, { token })).status).toBe(200);
    expect(users.get(user.id)!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await callPages(verifyRoute, { token })).status).toBe(400);
  });

  it("the settings button emails the current address, and a Postmark failure is a plain 502", async () => {
    const user = addUser();
    const { sent } = stubPostmark();
    const res = await callApp(resendRoute.POST, "POST", "/api/v1/me/verify-email", user, {});
    expect(res.status).toBe(202);
    const [email] = sent();
    expect(email.To).toBe(user.email);
    expect(email.Subject).toBe("Confirm your email for JobSeance");
    expect(email.TextBody).toContain("lasts 24 hours");

    // The link from that email verifies the account.
    expect(await verifyEmail(db, linkToken(email))).toBe("verified");

    const other = addUser();
    stubPostmark(422, { ErrorCode: 406, Message: "You tried to send to recipient(s) that have been marked as inactive." });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await callApp(resendRoute.POST, "POST", "/api/v1/me/verify-email", other, {});
    expect(failed.status).toBe(502);
    const body = JSON.stringify(await failed.json());
    expect(body).not.toMatch(/inactive|406|postmark/i);
  });

  it("an email change sends a link to the new address and revokes links sent to the old one", async () => {
    const user = addUser();
    const oldLink = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email });
    const { sent } = stubPostmark();
    const res = await callApp(meRoute.PATCH, "PATCH", "/api/v1/me", user, { currentPassword: PASSWORD, email: "grace@example.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).verificationSent).toBe(true);
    expect(sent().map((e) => e.To)).toEqual(["grace@example.com"]);
    expect(users.get(user.id)!.emailVerifiedAt).toBeNull();
    expect(await resetPassword(db, oldLink, NEW_PASSWORD)).toBe("invalid");
  });

  it("sign-up emails a verification link, and still creates the account if Postmark fails", async () => {
    const { sent } = stubPostmark();
    const ok = await callPages(signupRoute, { username: "new_ada", email: "new-ada@example.com", password: PASSWORD });
    expect(ok.status).toBe(201);
    expect(sent().map((e) => e.To)).toEqual(["new-ada@example.com"]);
    expect(await verifyEmail(db, linkToken(sent()[0]))).toBe("verified");

    stubPostmark(500, { ErrorCode: 700, Message: "Down" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stillOk = await callPages(signupRoute, { username: "new_grace", email: "new-grace@example.com", password: PASSWORD });
    expect(stillOk.status).toBe(201);
  });

  it("lists Postmark as a processor only while email is on", () => {
    expect(processors(true).map((p) => p.name)).toContain("Postmark");
    expect(processors(false).map((p) => p.name)).not.toContain("Postmark");
    expect(processors(false).find((p) => p.name === "Vercel")!.receives).not.toContain("password reset");
  });
});
