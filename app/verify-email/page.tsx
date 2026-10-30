import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ui from "../components/ui.module.css";
import VerifyEmailButton from "./VerifyEmailButton";
import { peekEmailToken } from "@/lib/auth/email-tokens";
import { getDb } from "@/lib/db";
import { emailEnabled } from "@/lib/email";

export const metadata: Metadata = {
  title: "Confirm your email · JobSeance",
  description: "Confirm the email address on your JobSeance account.",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Opened from the verification email. Mail scanners open every link they see, so loading this
 * page changes nothing; the button's POST is what uses the link.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  if (!emailEnabled()) notFound();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const usable = await peekEmailToken(getDb(), value, "VERIFY_EMAIL");

  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-lg px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Account</p>
        <h1 className={`${ui.title} mt-2`}>Confirm your email</h1>
        <section aria-label="Email confirmation" className={`${ui.card} ${ui.rise} mt-8 flex flex-col gap-4 p-5 sm:p-7`}>
          {usable ? (
            <VerifyEmailButton token={value} />
          ) : (
            <>
              <p className={ui.body}>
                This link has expired or was already used. If your email isn&rsquo;t confirmed yet, send a new link from
                your account settings.
              </p>
              <Link className={ui.link} href="/dashboard#settings">
                Go to account settings
              </Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
