import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuthPanel from "./AuthPanel";
import { OAUTH_ERROR_MESSAGES } from "@/lib/auth/messages";
import { SESSION_COOKIE, oauthEnabled, userFromToken } from "@/lib/auth/session";

type SearchParams = Promise<{ error?: string | string[] }>;

/** Shared by /login and /signup: signed-in visitors go straight to the dashboard. */
export default async function AuthPage({ mode, searchParams }: { mode: "login" | "signup"; searchParams: SearchParams }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await userFromToken(token)) redirect("/dashboard");

  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;

  return (
    <AuthPanel
      initialMode={mode}
      initialStatus={code ? (OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_MESSAGES.oauth_failed) : ""}
      oauth={{ google: oauthEnabled("google"), github: oauthEnabled("github") }}
    />
  );
}
