import { createHash, randomBytes } from "node:crypto";
import type { EmailTokenPurpose } from "@/app/generated/prisma/client";
import type { getDb } from "@/lib/db";

// One-time links for email verification and password reset. The token is 32 random
// bytes (base64url) that only ever exist in the email; we store its SHA-256 hash.
// Each token works once: the update that marks it used also checks it's unused and unexpired.

type Db = ReturnType<typeof getDb>;

export type { EmailTokenPurpose };

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 60 * 60 * 1000,
  RESET_PASSWORD: 30 * 60 * 1000,
};

/** 32 bytes in base64url without padding is always 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Replaces the user's unused tokens of this purpose with a new one and returns it (the only copy). */
export async function issueEmailToken(
  db: Db,
  input: { userId: string; purpose: EmailTokenPurpose; email: string },
  now: Date = new Date(),
): Promise<string> {
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[input.purpose]);
  await db.$transaction([
    db.emailToken.deleteMany({ where: { userId: input.userId, purpose: input.purpose, usedAt: null } }),
    db.emailToken.create({ data: { ...input, tokenHash, expiresAt }, select: { id: true } }),
  ]);
  return token;
}

/** Deletes every unused token the user has, e.g. when the account's email address changes. */
export async function revokeEmailTokens(db: Db, userId: string): Promise<void> {
  await db.emailToken.deleteMany({ where: { userId, usedAt: null } });
}

/** True while the token is unused and unexpired. Reads only, so a link scanner's GET changes nothing. */
export async function peekEmailToken(db: Db, token: unknown, purpose: EmailTokenPurpose, now: Date = new Date()): Promise<boolean> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
  const found = await db.emailToken.findFirst({
    where: { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Marks the token used and returns who it was for, or null if it's unknown, expired, already
 * used or for another purpose. Two requests racing with one token: only one update matches.
 */
export async function consumeEmailToken(
  db: Db,
  token: string,
  purpose: EmailTokenPurpose,
  now: Date = new Date(),
): Promise<{ userId: string; email: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const tokenHash = hashToken(token);
  const claimed = await db.emailToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;
  return db.emailToken.findUnique({ where: { tokenHash }, select: { userId: true, email: true } });
}
