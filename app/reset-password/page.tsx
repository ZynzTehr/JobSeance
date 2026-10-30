import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "../components/ui.module.css";
import ResetPasswordForm from "./ResetPasswordForm";
import { peekEmailToken } from "@/lib/auth/email-tokens";
import { getDb } from "@/lib/db";
import { emailEnabled } from "@/lib/email";

export const metadata: Metadata = {
  title: "Choose a new password · JobSeance",
  description: "Set a new password for your JobSeance account.",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** Opened from the reset email. Looking at the link changes nothing; only submitting the form uses it. */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  if (!emailEnabled()) notFound();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const usable = await peekEmailToken(getDb(), value, "RESET_PASSWORD");

  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-lg px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Account</p>
        <h1 className={`${ui.title} mt-2`}>Choose a new password</h1>
        {usable ? (
          <>
            <p className={`${ui.lede} mt-4`}>This signs you out on every device. Then log in with the new password.</p>
            <section aria-label="New password" className={`${ui.card} ${ui.rise} mt-8 p-5 sm:p-7`}>
              <ResetPasswordForm token={value} />
            </section>
          </>
        ) : (
          <section aria-label="Link problem" className={`${ui.card} ${ui.rise} mt-8 flex flex-col gap-4 p-5 sm:p-7`}>
            <p className={ui.body}>This reset link has expired or was already used. Each link works once.</p>
            <Link className={ui.link} href="/forgot-password">
              Send a new link
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
