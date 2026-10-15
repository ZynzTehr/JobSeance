import type { NextApiRequest, NextApiResponse } from "next";
import { guardAuthPost, sendError } from "@/lib/auth/pages";
import { INVALID_LOGIN, getPassport } from "@/lib/auth/passport";
import { loadPublicUser, sessionCookie, signToken } from "@/lib/auth/session";
import { loginSchema, normalizeUsername } from "@/lib/auth/validation";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };

type LocalUser = { id: string; tokenVersion: number };

export default async function login(req: NextApiRequest, res: NextApiResponse) {
  // 415/403 before passport-local ever reads the body.
  if (!guardAuthPost(req, res)) return;

  const ipLimit = rateLimit(`login:ip:${clientIp(req.headers)}`, 30, 60);
  if (!ipLimit.ok) return sendError(res, tooManyRequests(ipLimit.retryAfter));

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, { status: 400, code: "validation_failed", message: "Enter your username and password." });
  }
  // Slows guessing on one name; never locks the account.
  const nameLimit = rateLimit(`login:user:${normalizeUsername(parsed.data.username)}`, 10, 15 * 60);
  if (!nameLimit.ok) return sendError(res, tooManyRequests(nameLimit.retryAfter));

  const user = await new Promise<LocalUser | false>((resolve, reject) => {
    getPassport().authenticate("local", { session: false }, (error: unknown, found: LocalUser | false) =>
      error ? reject(error) : resolve(found),
    )(req, res);
  });
  if (!user) return sendError(res, { status: 401, code: "invalid_credentials", message: INVALID_LOGIN });

  const token = signToken(user);
  const found = await loadPublicUser(user.id);
  res.setHeader("Set-Cookie", sessionCookie(token));
  res.status(200).json({ user: found?.user, token });
}
