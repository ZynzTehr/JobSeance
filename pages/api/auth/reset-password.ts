import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { guardAuthPost, sendError } from "@/lib/auth/pages";
import { NOT_FOUND, resetPassword } from "@/lib/auth/email-flows";
import { emailEnabled } from "@/lib/email";
import { checkPassword, fieldErrors, resetPasswordSchema } from "@/lib/auth/validation";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };

const INVALID_LINK = {
  status: 400,
  code: "invalid_token",
  message: "This reset link has expired or was already used. Ask for a new one.",
};

/**
 * POST /api/auth/reset-password { token, newPassword }: sets a new password from an emailed link,
 * signs the account out everywhere, and leaves the person to log in. 404 while email is off.
 */
export default async function resetPasswordRoute(req: NextApiRequest, res: NextApiResponse) {
  if (!emailEnabled()) return sendError(res, NOT_FOUND);
  if (!guardAuthPost(req, res)) return;

  const limit = rateLimit(`reset:ip:${clientIp(req.headers)}`, 20, 15 * 60);
  if (!limit.ok) return sendError(res, tooManyRequests(limit.retryAfter));

  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, { status: 400, code: "validation_failed", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) });
  }
  // Rules first, so a password that can't be used doesn't spend the link.
  const password = checkPassword(parsed.data.newPassword);
  if (!password.ok) {
    return sendError(res, { status: 400, code: "validation_failed", message: password.message, fields: { newPassword: password.message } });
  }

  const result = await resetPassword(getDb(), parsed.data.token, password.password);
  if (result !== "reset") return sendError(res, INVALID_LINK);
  res.status(200).json({ ok: true, message: "Password changed. Log in with your new password." });
}
