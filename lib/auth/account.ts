import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { emailField, usernameField } from "@/lib/auth/validation";
import { rateLimit, tooManyRequests } from "@/lib/http";

// Account settings for password accounts: every change needs the current password.

export const WRONG_PASSWORD = "Current password is incorrect.";
export const PASSWORD_CHECKS = { limit: 5, windowSec: 15 * 60 };

const currentPassword = z.string().min(1, "Enter your current password.").max(1000);

export const accountUpdateSchema = z
  .strictObject({ currentPassword, username: usernameField.optional(), email: emailField.optional() })
  .refine((b) => b.username !== undefined || b.email !== undefined, { message: "Send a new username or email.", path: ["body"] });

export const passwordChangeSchema = z.strictObject({ currentPassword, newPassword: z.string().max(1000) });

export const fieldError = (status: number, code: string, field: string, message: string) =>
  new HttpError({ status, code, message, fields: { [field]: message } });

export const taken = (field: "username" | "email") =>
  fieldError(409, "conflict", field, field === "username" ? "That username is taken." : "An account with this email already exists.");

/**
 * Loads the account and checks its current password. A stolen session gets 5 guesses per
 * 15 minutes per account; a wrong guess says only that the password is incorrect.
 */
export async function verifyCurrentPassword(userId: string, password: string) {
  const limit = rateLimit(`account-password:user:${userId}`, PASSWORD_CHECKS.limit, PASSWORD_CHECKS.windowSec);
  if (!limit.ok) throw new HttpError(tooManyRequests(limit.retryAfter));

  const account = await getDb().user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, passwordHash: true },
  });
  if (!account) throw new HttpError({ status: 401, code: "unauthorized", message: "Sign in to continue." });
  if (!account.passwordHash) {
    throw new HttpError({
      status: 403,
      code: "social_account",
      message: "Your account signs in with Google or GitHub, so it has no password to change it with.",
    });
  }
  if (!(await bcrypt.compare(password.normalize("NFC"), account.passwordHash))) {
    throw fieldError(400, "invalid_current_password", "currentPassword", WRONG_PASSWORD);
  }
  return { id: account.id, username: account.username, email: account.email };
}
