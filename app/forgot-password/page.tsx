import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "../components/ui.module.css";
import ForgotPasswordForm from "./ForgotPasswordForm";
import { issueFormToken } from "@/lib/bot-guard";
import { LINK_LIFETIME } from "@/lib/auth/email-flows";
import { emailEnabled } from "@/lib/email";

export const metadata: Metadata = {
  title: "Forgot password · JobSeance",
  description: "Get a link to reset the password of your JobSeance account.",
  robots: { index: false },
};

// Read per request: the page exists only while email is on, and the form token is signed at render time.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (!emailEnabled()) notFound();
  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-lg px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Account</p>
        <h1 className={`${ui.title} mt-2`}>Forgot your password?</h1>
        <p className={`${ui.lede} mt-4`}>
          Enter the email address on your account and we&rsquo;ll send a link to choose a new password. It lasts{" "}
          {LINK_LIFETIME.RESET_PASSWORD}.
        </p>
        <section aria-label="Reset request" className={`${ui.card} ${ui.rise} mt-8 p-5 sm:p-7`}>
          <ForgotPasswordForm formToken={issueFormToken("reset")} />
        </section>
        <p className={`${ui.muted} mt-6`}>
          Signed up with Google or GitHub? Your account has no password; use that button on the{" "}
          <Link className={ui.link} href="/login">
            login page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
