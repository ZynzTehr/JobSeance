import bcrypt from "bcryptjs";
import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@/app/generated/prisma/client";
import { getDb } from "@/lib/db";
import { guardAuthPost, sendError } from "@/lib/auth/pages";
import { BCRYPT_COST } from "@/lib/auth/passport";
import { loadPublicUser, sessionCookie, signToken } from "@/lib/auth/session";
import { checkPassword, fieldErrors, signupSchema } from "@/lib/auth/validation";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };

const taken = (field: "username" | "email") => ({
  status: 409,
  code: "conflict",
  message: field === "username" ? "That username is taken." : "An account with this email already exists.",
  fields: { [field]: field === "username" ? "That username is taken." : "An account with this email already exists." },
});

export default async function signup(req: NextApiRequest, res: NextApiResponse) {
  if (!guardAuthPost(req, res)) return;

  const limit = rateLimit(`signup:ip:${clientIp(req.headers)}`, 30, 60 * 60);
  if (!limit.ok) return sendError(res, tooManyRequests(limit.retryAfter));

  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, { status: 400, code: "validation_failed", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) });
  }
  const password = checkPassword(parsed.data.password);
  if (!password.ok) {
    return sendError(res, { status: 400, code: "validation_failed", message: password.message, fields: { password: password.message } });
  }
  const { username, email } = parsed.data;

  const db = getDb();
  // Up-front checks give a clear message; the unique index is the real guard.
  const clash = await db.user.findFirst({ where: { OR: [{ username }, { email }] }, select: { username: true } });
  if (clash) return sendError(res, taken(clash.username === username ? "username" : "email"));

  const passwordHash = await bcrypt.hash(password.password, BCRYPT_COST);
  try {
    // username and passwordHash are written together: set if and only if.
    const user = await db.user.create({ data: { username, email, passwordHash }, select: { id: true, tokenVersion: true } });
    const token = signToken(user);
    const found = await loadPublicUser(user.id);
    res.setHeader("Set-Cookie", sessionCookie(token));
    res.status(201).json({ user: found?.user, token });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
      return sendError(res, taken(target.includes("username") ? "username" : "email"));
    }
    throw error;
  }
}
