import cookieSession from "cookie-session";
import type { NextApiRequest, NextApiResponse } from "next";
import { getPassport, type OAuthOutcome } from "@/lib/auth/passport";
import { appUrl, oauthEnabled, sessionCookie, signToken } from "@/lib/auth/session";
import { checkRequest, errorBody, type ApiError } from "@/lib/http";

export function sendError(res: NextApiResponse, e: ApiError) {
  if (e.retryAfter !== undefined) res.setHeader("Retry-After", String(e.retryAfter));
  res.status(e.status).json(errorBody(e));
}

/** Method + content type + origin checks for signup, login and logout. Returns false if it replied. */
export function guardAuthPost(req: NextApiRequest, res: NextApiResponse): boolean {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendError(res, { status: 405, code: "method_not_allowed", message: "Use POST." });
    return false;
  }
  const problem = checkRequest("POST", req.headers, "auth");
  if (problem) {
    sendError(res, problem);
    return false;
  }
  return true;
}


type Provider = "google" | "github";

// passport-oauth2 keeps state + PKCE verifier in req.session, so only the OAuth
// routes get a short-lived signed cookie session. No express-session.
function withOAuthSession(req: NextApiRequest, res: NextApiResponse, next: () => void) {
  // Behind Vercel's proxy the socket is plain HTTP; without this the Secure cookie is silently dropped.
  if (req.headers["x-forwarded-proto"] === "https") (req as unknown as { protocol: string }).protocol = "https";
  const secret = process.env.OAUTH_COOKIE_SECRET ?? "";
  if (Buffer.byteLength(secret) < 32) throw new Error("OAUTH_COOKIE_SECRET must be at least 32 bytes.");
  cookieSession({
    name: "jobseance_oauth",
    keys: [secret],
    maxAge: 10 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https://"),
  })(req as never, res as never, next);
}

const loginRedirect = (code: string) => `/login?error=${encodeURIComponent(code)}`;

/** GET /api/auth/<provider>: redirect to the provider. Don't await: the redirect ends the response. */
export function startOAuth(provider: Provider) {
  return (req: NextApiRequest, res: NextApiResponse) => {
    if (!oauthEnabled(provider)) return res.redirect(302, loginRedirect("oauth_unavailable"));
    withOAuthSession(req, res, () => {
      getPassport().authenticate(provider, { session: false })(req, res);
    });
  };
}

/** GET /api/auth/<provider>/callback: link or create the user, set our JWT cookie, go to the scanner. */
export function finishOAuth(provider: Provider) {
  return (req: NextApiRequest, res: NextApiResponse) => {
    if (!oauthEnabled(provider)) return res.redirect(302, loginRedirect("oauth_unavailable"));
    withOAuthSession(req, res, () => {
      getPassport().authenticate(provider, { session: false }, (error: unknown, outcome: OAuthOutcome | false) => {
        (req as unknown as { session: null }).session = null; // state is single-use
        if (error) {
          console.error(`oauth ${provider} callback failed`, error instanceof Error ? error.name : "error");
          return res.redirect(302, loginRedirect("oauth_failed"));
        }
        // `false` = denied consent or bad state. Never log in an empty user.
        if (!outcome) return res.redirect(302, loginRedirect("oauth_failed"));
        if (!outcome.ok) return res.redirect(302, loginRedirect(outcome.code));
        res.setHeader("Set-Cookie", sessionCookie(signToken(outcome.user)));
        res.redirect(302, "/scan");
      })(req, res);
    });
  };
}

