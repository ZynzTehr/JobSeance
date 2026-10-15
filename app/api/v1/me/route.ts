import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser, requireUserForWrite, unauthorized } from "@/lib/auth/require-user";
import { clearedSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** GET /api/v1/me: the current user and linked providers. Never includes passwordHash. */
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  return user ? Response.json({ user }) : unauthorized();
}

/** DELETE /api/v1/me: deletes the account; reports and linked accounts cascade, checks are kept anonymized. */
export async function DELETE(request: NextRequest) {
  const user = await requireUserForWrite(request);
  if (user instanceof Response) return user;
  await getDb().user.delete({ where: { id: user.id } });
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
}
