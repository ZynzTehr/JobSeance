import bcrypt from "bcryptjs";
import type { getDb } from "@/lib/db";
import { BCRYPT_COST } from "@/lib/auth/passport";
import { appUrl } from "@/lib/auth/session";
import { consumeEmailToken, issueEmailToken, revokeEmailTokens } from "@/lib/auth/email-tokens";
import { emailEnabled, sendEmail, type Email } from "@/lib/email";
import { EMAIL_LINK_LIFETIME } from "@/lib/legal";

// Verification and password-reset emails, and what using their links does. Routes call
// these; nothing here reads a request. Logs carry outcome names only, never an address or token.

type Db = ReturnType<typeof getDb>;

export const LINK_LIFETIME = { VERIFY_EMAIL: EMAIL_LINK_LIFETIME.verify, RESET_PASSWORD: EMAIL_LINK_LIFETIME.reset } as const;

/** Every accepted forgot-password request takes at least this long, so its timing doesn't show whether an email went out. */
export const FORGOT_MIN_MS = 1_500;
/** Per address: further requests in the window get the same reply, but no email. */
export const FORGOT_PER_EMAIL = { limit: 3, windowSec: 60 * 60 };

export const FORGOT_REPLY = {
  ok: true,
  message: `If that address belongs to a JobSeance account with a password, we've sent it a link to reset the password. The link lasts ${LINK_LIFETIME.RESET_PASSWORD}.`,
};

/** What every email route answers while email is off: as if it didn't exist. */
export const NOT_FOUND = { status: 404, code: "not_found", message: "Not found." };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain and short: one link, how long it lasts, and what to do if you didn't ask. No images, no tracking. */
function message(to: string, subject: string, lines: { intro: string; action: string; link: string; outro: string }): Email {
  const text = `${lines.intro}\n\n${lines.action}:\n${lines.link}\n\n${lines.outro}\n\nJobSeance\n`;
  const html =
    `<p>${escapeHtml(lines.intro)}</p>` +
    `<p><a href="${escapeHtml(lines.link)}">${escapeHtml(lines.action)}</a></p>` +
    `<p>Or paste this link into your browser:<br>${escapeHtml(lines.link)}</p>` +
    `<p>${escapeHtml(lines.outro)}</p><p>JobSeance</p>`;
  return { to, subject, text, html };
}

export function verificationEmail(to: string, token: string): Email {
  return message(to, "Confirm your email for JobSeance", {
    intro: "Confirm that this is your email address for your JobSeance account.",
    action: "Confirm your email",
    link: `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`,
    outro: `The link works once and lasts ${LINK_LIFETIME.VERIFY_EMAIL}. If you didn't ask for this, ignore this email.`,
  });
}

export function resetEmail(to: string, token: string): Email {
  return message(to, "Reset your JobSeance password", {
    intro: "Someone asked to reset the password for the JobSeance account that uses this email address.",
    action: "Choose a new password",
    link: `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`,
    outro: `The link works once and lasts ${LINK_LIFETIME.RESET_PASSWORD}. If you didn't ask for this, ignore this email; your password stays the same.`,
  });
}

/** Emails a verification link to the account's current address. Never throws; false if email is off or sending failed. */
export async function sendVerificationEmail(db: Db, user: { id: string; email: string }): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    const token = await issueEmailToken(db, { userId: user.id, purpose: "VERIFY_EMAIL", email: user.email });
    return await sendEmail(verificationEmail(user.email, token));
  } catch (error) {
    console.error("verification_email_failed", error instanceof Error ? error.name : "error");
    return false;
  }
}

/**
 * After an email change: links sent to the old address are deleted (using one would be refused
 * anyway, since each checks the current address) and the new address gets a verification link.
 */
export async function emailChanged(db: Db, user: { id: string; email: string }): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    await revokeEmailTokens(db, user.id);
  } catch (error) {
    console.error("revoke_email_tokens_failed", error instanceof Error ? error.name : "error");
  }
  return sendVerificationEmail(db, user);
}

/**
 * Forgot password: emails a reset link only if a password account uses this address.
 * The caller answers the same way whatever happens here. Never throws.
 */
export async function requestPasswordReset(db: Db, email: string): Promise<void> {
  if (!emailEnabled()) return;
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, passwordHash: true } });
    if (!user?.passwordHash) return; // unknown, or Google/GitHub only: nothing to reset
    const token = await issueEmailToken(db, { userId: user.id, purpose: "RESET_PASSWORD", email: user.email });
    await sendEmail(resetEmail(user.email, token));
  } catch (error) {
    console.error("reset_email_failed", error instanceof Error ? error.name : "error");
  }
}

export type VerifyResult = "verified" | "invalid" | "email_changed";

/**
 * Uses a verification link. Marks the email verified only if the link went to the account's
 * current address: Google sign-in auto-links to a verified email, so an old link must not
 * vouch for a new address. The email match is part of the update, so a change mid-request loses.
 */
export async function verifyEmail(db: Db, token: string, now: Date = new Date()): Promise<VerifyResult> {
  const used = await consumeEmailToken(db, token, "VERIFY_EMAIL", now);
  if (!used) return "invalid";
  const updated = await db.user.updateMany({ where: { id: used.userId, email: used.email }, data: { emailVerifiedAt: now } });
  return updated.count === 1 ? "verified" : "email_changed";
}

export type ResetResult = "reset" | "invalid";

/**
 * Uses a reset link with a password that already passed checkPassword. Sets the new hash,
 * bumps tokenVersion so every session and API token stops working, and marks the email verified
 * (opening the link proved access to the inbox). Refused if the account's email changed since.
 */
export async function resetPassword(db: Db, token: string, password: string, now: Date = new Date()): Promise<ResetResult> {
  const used = await consumeEmailToken(db, token, "RESET_PASSWORD", now);
  if (!used) return "invalid";
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const updated = await db.user.updateMany({
    where: { id: used.userId, email: used.email, passwordHash: { not: null } },
    data: { passwordHash, tokenVersion: { increment: 1 }, emailVerifiedAt: now },
  });
  return updated.count === 1 ? "reset" : "invalid";
}
