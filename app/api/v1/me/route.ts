import type { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { handle, readBody, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { accountUpdateSchema, fieldError, taken, verifyCurrentPassword } from "@/lib/auth/account";
import { requireUser, requireUserForWrite, unauthorized } from "@/lib/auth/require-user";
import { clearedSessionCookie, loadPublicUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/me: the current user and linked providers. Never includes passwordHash. */
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  return user ? Response.json({ user }) : unauthorized();
}

/**
 * PATCH /api/v1/me: change the username and/or email of a password account; needs the current password.
 * A new email is always unverified: Google sign-in auto-links only to a verified email, so a copied
 * address must never inherit the old address's verification.
 */
export const PATCH = handle(async (request: NextRequest) => {
  const user = await writer(request);
  const body = await readBody(request, accountUpdateSchema);
  const account = await verifyCurrentPassword(user.id, body.currentPassword);

  const { username, email } = body;
  if (username === account.username) throw fieldError(400, "validation_failed", "username", "That's already your username.");
  if (email === account.email) throw fieldError(400, "validation_failed", "email", "That's already your email.");

  const db = getDb();
  // Up-front check gives a clear message; the unique index is the real guard.
  const wanted = [...(username ? [{ username }] : []), ...(email ? [{ email }] : [])];
  const clash = await db.user.findFirst({ where: { OR: wanted, NOT: { id: account.id } }, select: { username: true } });
  if (clash) throw taken(username && clash.username === username ? "username" : "email");

  try {
    await db.user.update({
      where: { id: account.id },
      data: { ...(username ? { username } : {}), ...(email ? { email, emailVerifiedAt: null } : {}) },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
      throw taken(target.includes("username") ? "username" : "email");
    }
    throw error;
  }
  const found = await loadPublicUser(account.id);
  return Response.json({ user: found?.user });
});

/** DELETE /api/v1/me: deletes the account; reports and linked accounts cascade, checks are kept anonymized. */
export async function DELETE(request: NextRequest) {
  const user = await requireUserForWrite(request);
  if (user instanceof Response) return user;
  await getDb().user.delete({ where: { id: user.id } });
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
}
