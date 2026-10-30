import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { handle, readBody, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { fieldError, passwordChangeSchema, verifyCurrentPassword } from "@/lib/auth/account";
import { BCRYPT_COST } from "@/lib/auth/passport";
import { loadPublicUser, sessionCookie, signToken } from "@/lib/auth/session";
import { checkPassword } from "@/lib/auth/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/me/password: change a password account's password; needs the current one.
 * Bumps tokenVersion, so every other session and copied token stops working, then sends this
 * request a fresh cookie and token signed with the new version so it stays signed in.
 */
export const POST = handle(async (request: NextRequest) => {
  const user = await writer(request);
  const body = await readBody(request, passwordChangeSchema);
  // Rules first: a password that can't be used doesn't spend one of the current-password checks.
  const next = checkPassword(body.newPassword);
  if (!next.ok) throw fieldError(400, "validation_failed", "newPassword", next.message);

  const account = await verifyCurrentPassword(user.id, body.currentPassword);
  if (next.password === body.currentPassword.normalize("NFC")) {
    throw fieldError(400, "validation_failed", "newPassword", "Choose a password different from your current one.");
  }

  const passwordHash = await bcrypt.hash(next.password, BCRYPT_COST);
  const updated = await getDb().user.update({
    where: { id: account.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
    select: { id: true, tokenVersion: true },
  });
  const token = signToken(updated);
  const found = await loadPublicUser(updated.id);
  return Response.json({ user: found?.user, token }, { headers: { "Set-Cookie": sessionCookie(token) } });
});
