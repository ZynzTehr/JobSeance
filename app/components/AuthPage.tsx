import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthPanel from "./AuthPanel";
import legal from "./legal.module.css";
import ui from "./ui.module.css";
import { MIN_AGE } from "@/lib/legal";
import { OAUTH_ERROR_MESSAGES } from "@/lib/auth/messages";
import { SESSION_COOKIE, oauthEnabled, userFromToken } from "@/lib/auth/session";

type SearchParams = Promise<{ error?: string | string[] }>;

/** Shared by /, /login and /signup: signed-in visitors go straight to the scanner. */
export default async function AuthPage({ mode, searchParams }: { mode: "login" | "signup"; searchParams: SearchParams }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await userFromToken(token)) redirect("/scan");

  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;

  return (
    <AuthPanel
      initialMode={mode}
      initialStatus={code ? (OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_MESSAGES.oauth_failed) : ""}
      oauth={{ google: oauthEnabled("google"), github: oauthEnabled("github") }}
      footer={
        // Inside <main>, right under the card, so it's seen before anyone signs up.
        <p className={`${legal.authNotice} mt-5 max-w-sm px-2`}>
          By creating an account you confirm you&rsquo;re {MIN_AGE} or older and agree to the{" "}
          <Link className={ui.link} href="/terms">
            Terms
          </Link>
          . Read the{" "}
          <Link className={ui.link} href="/privacy">
            Privacy notice
          </Link>
          .
        </p>
      }
    />
  );
}
