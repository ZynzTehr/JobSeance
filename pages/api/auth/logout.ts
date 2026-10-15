import type { NextApiRequest, NextApiResponse } from "next";
import { guardAuthPost } from "@/lib/auth/pages";
import { clearedSessionCookie } from "@/lib/auth/session";

/** POST /api/auth/logout: clears the cookie. "Log out everywhere" is /api/v1/me/logout-all. */
export default function logout(req: NextApiRequest, res: NextApiResponse) {
  if (!guardAuthPost(req, res)) return;
  res.setHeader("Set-Cookie", clearedSessionCookie());
  res.status(204).end();
}
