import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Account settings through the real route handlers: Bearer auth via passport-jwt, body
// validation, the current-password check and what gets written. The database is an in-memory fake.

process.env.JWT_SECRET = "account-settings-test-secret-0123456789";

type Row = {
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

const users = new Map<string, Row>();
const updates: { where: { id: string }; data: Record<string, unknown> }[] = [];

function pick(row: Row, select: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) out[key] = key === "accounts" ? [] : row[key as keyof Row];
  return out;
}

const matches = (row: Row, where: Record<string, unknown>): boolean => {
  if (where.OR) return (where.OR as Record<string, unknown>[]).some((w) => matches(row, w)) && (!where.NOT || !matches(row, where.NOT as Record<string, unknown>));
  return Object.entries(where).every(([k, v]) => row[k as keyof Row] === v);
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    user: {
      findUnique: async ({ where, select }: { where: { id?: string; email?: string }; select: Record<string, unknown> }) => {
        const row = where.id ? users.get(where.id) : [...users.values()].find((r) => r.email === where.email);
        return row ? pick(row, select) : null;
      },
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        const row = [...users.values()].find((r) => matches(r, where));
        return row ? pick(row, select) : null;
      },
      update: async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select: Record<string, unknown> }) => {
        updates.push({ where, data });
        const row = users.get(where.id)!;
        for (const [key, value] of Object.entries(data)) {
          (row as Record<string, unknown>)[key] =
            value && typeof value === "object" && "increment" in value ? (row[key as keyof Row] as number) + (value.increment as number) : value;
        }
        return pick(row, select);
      },
    },
    account: {
      findUnique: async () => null, // no Google account linked yet
      create: async () => {
        throw new Error("must not link");
      },
    },
  }),
}));

const me = await import("@/app/api/v1/me/route");
const password = await import("@/app/api/v1/me/password/route");
const { signToken } = await import("@/lib/auth/session");
const { linkOAuthAccount } = await import("@/lib/auth/oauth");

const OLD = "Old-passw0rd!";
const NEW = "New-passw0rd?";
const oldHash = bcrypt.hashSync(OLD, 4); // compare reads the cost from the hash, so tests stay fast

let seq = 0;
function addUser(overrides: Partial<Row> = {}): Row {
  seq += 1;
  const row: Row = {
    id: `user${seq}`, // a fresh id per test: the current-password limiter is per account
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

function call(handler: (r: NextRequest) => Promise<Response>, method: string, path: string, user: Row | string, body: unknown) {
  const token = typeof user === "string" ? user : signToken(user);
  const request = new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return handler(request);
}

const patchMe = (user: Row | string, body: unknown) => call(me.PATCH, "PATCH", "/api/v1/me", user, body);
const changePassword = (user: Row, body: unknown) => call(password.POST, "POST", "/api/v1/me/password", user, body);

beforeEach(() => {
  users.clear();
  updates.length = 0;
});

describe("PATCH /api/v1/me (username and email)", () => {
  it("changes the username, normalized like sign-up", async () => {
    const user = addUser();
    const res = await patchMe(user, { currentPassword: OLD, username: "  Grace_H " });
    expect(res.status).toBe(200);
    expect((await res.json()).user.username).toBe("grace_h");
    expect(updates).toEqual([{ where: { id: user.id }, data: { username: "grace_h" } }]);
  });

  it("clears emailVerifiedAt on every email change, so Google sign-in can't auto-link to a copied address", async () => {
    const user = addUser({ emailVerifiedAt: new Date("2026-10-02T00:00:00Z") });
    const res = await patchMe(user, { currentPassword: OLD, email: " Victim@Gmail.com " });
    expect(res.status).toBe(200);
    expect(updates[0].data).toEqual({ email: "victim@gmail.com", emailVerifiedAt: null });
    expect(users.get(user.id)!.emailVerifiedAt).toBeNull();
    expect((await res.json()).user.emailVerifiedAt).toBeNull();

    // The real owner's later Google sign-in is refused instead of landing in this account.
    const google = { provider: "GOOGLE" as const, providerAccountId: "g-victim", email: "victim@gmail.com", emailVerified: true, name: null };
    expect(await linkOAuthAccount(google)).toEqual({ ok: false, code: "oauth_exists" });
  });

  it("rejects a wrong current password and writes nothing", async () => {
    const user = addUser();
    const res = await patchMe(user, { currentPassword: "Wrong-passw0rd!", username: "grace" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_current_password", message: "Current password is incorrect.", fields: { currentPassword: "Current password is incorrect." } },
    });
    expect(updates).toEqual([]);
  });

  it("applies the sign-up username and email rules", async () => {
    const user = addUser();
    for (const [body, field] of [
      [{ username: "ab" }, "username"],
      [{ username: "admin" }, "username"],
      [{ username: "has space" }, "username"],
      [{ email: "not-an-email" }, "email"],
    ] as const) {
      const res = await patchMe(user, { currentPassword: OLD, ...body });
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()).error.fields)).toEqual([field]);
    }
    expect(updates).toEqual([]);
  });

  it("returns 409 with a field error when the username or email belongs to someone else", async () => {
    const other = addUser();
    const user = addUser();
    const name = await patchMe(user, { currentPassword: OLD, username: other.username!.toUpperCase() });
    expect(name.status).toBe(409);
    expect((await name.json()).error.fields).toEqual({ username: "That username is taken." });
    const email = await patchMe(user, { currentPassword: OLD, email: other.email });
    expect(email.status).toBe(409);
    expect((await email.json()).error.fields).toEqual({ email: "An account with this email already exists." });
    expect(updates).toEqual([]);
  });

  it("refuses a no-op change", async () => {
    const user = addUser();
    const res = await patchMe(user, { currentPassword: OLD, username: user.username });
    expect((await res.json()).error.fields).toEqual({ username: "That's already your username." });
  });

  it("returns 400 for unknown keys and for a body with nothing to change", async () => {
    const user = addUser();
    const unknown = await patchMe(user, { currentPassword: OLD, username: "grace", role: "ADMIN" });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.fields).toEqual({ role: "Unknown field." });
    expect((await patchMe(user, { currentPassword: OLD })).status).toBe(400);
    expect(updates).toEqual([]);
  });

  it("refuses social-only accounts", async () => {
    const user = addUser({ username: null, passwordHash: null });
    const res = await patchMe(user, { currentPassword: "anything", email: "new@example.com" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("social_account");
    expect(updates).toEqual([]);
  });

  it("needs a signed-in user", async () => {
    expect((await patchMe("not-a-token", { currentPassword: OLD, username: "grace" })).status).toBe(401);
  });
});

describe("POST /api/v1/me/password", () => {
  it("stores the new hash, bumps tokenVersion and returns a session for the new version", { timeout: 20_000 }, async () => {
    const user = addUser();
    const before = signToken(user);
    const res = await changePassword(user, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);

    const row = users.get(user.id)!;
    expect(row.tokenVersion).toBe(4);
    expect(await bcrypt.compare(NEW, row.passwordHash!)).toBe(true);
    expect(await bcrypt.compare(OLD, row.passwordHash!)).toBe(false);

    const { token } = await res.json();
    expect((jwt.decode(token) as { tv: number }).tv).toBe(4);
    expect(res.headers.get("set-cookie")).toContain(`jobseance_session=${token}`);

    // The token from before the change no longer works anywhere.
    const stale = await patchMe(before, { currentPassword: NEW, username: "grace" });
    expect(stale.status).toBe(401);
  });

  it("rejects a wrong current password without changing anything", async () => {
    const user = addUser();
    const res = await changePassword(user, { currentPassword: "Wrong-passw0rd!", newPassword: NEW });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ currentPassword: "Current password is incorrect." });
    expect(updates).toEqual([]);
    expect(users.get(user.id)!.tokenVersion).toBe(3);
  });

  it("enforces the sign-up password rules and a different password", async () => {
    const user = addUser();
    const weak = await changePassword(user, { currentPassword: OLD, newPassword: "short" });
    expect(weak.status).toBe(400);
    expect((await weak.json()).error.fields.newPassword).toBe("Password must be at least 8 characters.");
    const noSymbol = await changePassword(user, { currentPassword: OLD, newPassword: "Passw0rdLong" });
    expect((await noSymbol.json()).error.fields.newPassword).toBe("Password needs a symbol.");
    const same = await changePassword(user, { currentPassword: OLD, newPassword: OLD });
    expect((await same.json()).error.fields.newPassword).toBe("Choose a password different from your current one.");
    expect(updates).toEqual([]);
  });

  it("refuses social-only accounts and unknown keys", async () => {
    const social = addUser({ username: null, passwordHash: null });
    expect((await changePassword(social, { currentPassword: "x", newPassword: NEW })).status).toBe(403);
    const user = addUser();
    const extra = await changePassword(user, { currentPassword: OLD, newPassword: NEW, tokenVersion: 0 });
    expect(extra.status).toBe(400);
    expect((await extra.json()).error.fields).toEqual({ tokenVersion: "Unknown field." });
    expect(updates).toEqual([]);
  });

  it("allows 5 current-password checks per 15 minutes per account, then 429 even with the right password", async () => {
    const user = addUser();
    for (let i = 0; i < 5; i++) {
      expect((await changePassword(user, { currentPassword: `Wrong-${i}-passw0rd!`, newPassword: NEW })).status).toBe(400);
    }
    const blocked = await changePassword(user, { currentPassword: OLD, newPassword: NEW });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // The limit is shared with username and email changes.
    expect((await patchMe(user, { currentPassword: OLD, username: "grace" })).status).toBe(429);
    expect(updates).toEqual([]);
  });
});
