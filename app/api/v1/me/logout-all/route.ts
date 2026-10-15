import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { requireUserForWrite } from "@/lib/auth/require-user";
import { clearedSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** POST /api/v1/me/logout-all: bumps tokenVersion, so every issued token (cookie or copied Bearer) stops working. */
export async function POST(request: NextRequest) {
  const user = await requireUserForWrite(request);
  if (user instanceof Response) return user;
  await getDb().user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
}
