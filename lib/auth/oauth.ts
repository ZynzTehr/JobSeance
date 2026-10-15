import { Prisma } from "@/app/generated/prisma/client";
import { getDb } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/validation";

// Spec "Account linking order". Provider tokens are never stored.

export type OAuthProfile = {
  provider: "GOOGLE" | "GITHUB";
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

export type LinkResult =
  | { ok: true; user: { id: string; tokenVersion: number } }
  | { ok: false; code: "oauth_exists" | "oauth_failed" };

const userFields = { id: true, tokenVersion: true } as const;

export async function linkOAuthAccount(profile: OAuthProfile): Promise<LinkResult> {
  const db = getDb();
  const email = normalizeEmail(profile.email);
  const key = { provider: profile.provider, providerAccountId: profile.providerAccountId };

  // 1. Known (provider, id): sign that user in. Never overwrite User.email.
  const account = await db.account.findUnique({
    where: { provider_providerAccountId: key },
    select: { id: true, user: { select: userFields } },
  });
  if (account) {
    await db.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    return { ok: true, user: account.user };
  }

  // 2. Same email: auto-link only Google-verified to an already-verified user. Never GitHub.
  const existing = await db.user.findUnique({ where: { email }, select: { ...userFields, emailVerifiedAt: true } });
  if (existing) {
    const canLink = profile.provider === "GOOGLE" && profile.emailVerified && existing.emailVerifiedAt !== null;
    if (!canLink) return { ok: false, code: "oauth_exists" };
    await db.account.create({
      data: { ...key, userId: existing.id, email, emailVerified: true, lastLoginAt: new Date() },
    });
    return { ok: true, user: { id: existing.id, tokenVersion: existing.tokenVersion } };
  }

  // 3. New user + account. Verified only when Google says so. No username or password.
  const verified = profile.provider === "GOOGLE" && profile.emailVerified;
  try {
    const user = await db.user.create({
      data: {
        email,
        name: profile.name,
        emailVerifiedAt: verified ? new Date() : null,
        accounts: { create: { ...key, email, emailVerified: profile.emailVerified, lastLoginAt: new Date() } },
      },
      select: userFields,
    });
    return { ok: true, user };
  } catch (error) {
    // Lost a race with a parallel sign-in for the same email or account.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, code: "oauth_exists" };
    }
    throw error;
  }
}
