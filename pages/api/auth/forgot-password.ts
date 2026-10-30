import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { guardAuthPost, sendError } from "@/lib/auth/pages";
import { guardForm } from "@/lib/bot-guard";
import { FORGOT_MIN_MS, FORGOT_PER_EMAIL, FORGOT_REPLY, NOT_FOUND, requestPasswordReset } from "@/lib/auth/email-flows";
import { emailEnabled } from "@/lib/email";
import { fieldErrors, forgotPasswordSchema } from "@/lib/auth/validation";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /api/auth/forgot-password { email }: 202 with the same body whether or not an account
 * uses the address, has a password, or was already sent a link this hour. 404 while email is off.
 */
export default async function forgotPassword(req: NextApiRequest, res: NextApiResponse) {
  if (!emailEnabled()) return sendError(res, NOT_FOUND);
  if (!guardAuthPost(req, res)) return;

  const ipLimit = rateLimit(`forgot:ip:${clientIp(req.headers)}`, 10, 60 * 60);
  if (!ipLimit.ok) return sendError(res, tooManyRequests(ipLimit.retryAfter));

  const guard = await guardForm(req.body, { purpose: "reset", headers: req.headers, nodeHeaders: req.headers });
  if (!guard.ok) return sendError(res, guard.error);

  const parsed = forgotPasswordSchema.safeParse(guard.body);
  if (!parsed.success) {
    return sendError(res, { status: 400, code: "validation_failed", message: "Enter a valid email.", fields: fieldErrors(parsed.error) });
  }

  const { email } = parsed.data;
  const emailLimit = rateLimit(`forgot:email:${email}`, FORGOT_PER_EMAIL.limit, FORGOT_PER_EMAIL.windowSec);
  await Promise.all([emailLimit.ok ? requestPasswordReset(getDb(), email) : Promise.resolve(), pause(FORGOT_MIN_MS)]);
  res.status(202).json(FORGOT_REPLY);
}
