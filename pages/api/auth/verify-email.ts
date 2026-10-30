import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { guardAuthPost, sendError } from "@/lib/auth/pages";
import { NOT_FOUND, verifyEmail } from "@/lib/auth/email-flows";
import { emailEnabled } from "@/lib/email";
import { fieldErrors, verifyEmailSchema } from "@/lib/auth/validation";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };

const ERRORS = {
  invalid: { status: 400, code: "invalid_token", message: "This link has expired or was already used. Send a new one from your dashboard." },
  email_changed: {
    status: 400,
    code: "email_changed",
    message: "This link was for an email address that's no longer on the account, so nothing changed.",
  },
};

/**
 * POST /api/auth/verify-email { token }: uses a verification link. Works signed in or out, since
 * the link may be opened on another device. Only this POST uses the link; opening the page doesn't.
 */
export default async function verifyEmailRoute(req: NextApiRequest, res: NextApiResponse) {
  if (!emailEnabled()) return sendError(res, NOT_FOUND);
  if (!guardAuthPost(req, res)) return;

  const limit = rateLimit(`verify:ip:${clientIp(req.headers)}`, 30, 15 * 60);
  if (!limit.ok) return sendError(res, tooManyRequests(limit.retryAfter));

  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, { status: 400, code: "validation_failed", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) });
  }

  const result = await verifyEmail(getDb(), parsed.data.token);
  if (result !== "verified") return sendError(res, ERRORS[result]);
  res.status(200).json({ ok: true, message: "Email confirmed." });
}
