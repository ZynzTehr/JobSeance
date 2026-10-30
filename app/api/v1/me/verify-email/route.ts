import type { NextRequest } from "next/server";
import { HttpError, handle, writer } from "@/lib/api";
import { getDb } from "@/lib/db";
import { LINK_LIFETIME, NOT_FOUND, sendVerificationEmail } from "@/lib/auth/email-flows";
import { emailEnabled } from "@/lib/email";
import { rateLimit, tooManyRequests } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Per account, so a stolen session can't use us to flood someone's inbox. */
const RESEND_LIMIT = { limit: 3, windowSec: 60 * 60 };

/**
 * POST /api/v1/me/verify-email: emails a new verification link to the signed-in account's
 * current address, replacing any earlier link. 404 while email is off.
 */
export const POST = handle(async (request: NextRequest) => {
  if (!emailEnabled()) throw new HttpError(NOT_FOUND);
  const user = await writer(request);
  if (user.emailVerifiedAt !== null) {
    throw new HttpError({ status: 409, code: "already_verified", message: "Your email is already verified." });
  }
  const limit = rateLimit(`verify-resend:user:${user.id}`, RESEND_LIMIT.limit, RESEND_LIMIT.windowSec);
  if (!limit.ok) throw new HttpError(tooManyRequests(limit.retryAfter));

  if (!(await sendVerificationEmail(getDb(), { id: user.id, email: user.email }))) {
    throw new HttpError({ status: 502, code: "email_failed", message: "We couldn't send the email. Try again in a few minutes." });
  }
  return Response.json({ ok: true, message: `We sent a link to ${user.email}. It lasts ${LINK_LIFETIME.VERIFY_EMAIL}.` }, { status: 202 });
});
