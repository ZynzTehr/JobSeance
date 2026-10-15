import bcrypt from "bcryptjs";
import passport from "passport";
import { Strategy as GitHubStrategy, type StrategyOptions as GitHubOptions } from "passport-github2";
import {
  Strategy as GoogleStrategy,
  type Profile as GoogleProfile,
  type StrategyOptions as GoogleOptions,
  type VerifyCallback,
} from "passport-google-oauth20";
import type { Profile as PassportProfile } from "passport";
import { ExtractJwt, Strategy as JwtStrategy, type JwtFromRequestFunction } from "passport-jwt";
import { Strategy as LocalStrategy } from "passport-local";
import { getDb } from "@/lib/db";
import { linkOAuthAccount, type LinkResult } from "@/lib/auth/oauth";
import { JWT_AUDIENCE, JWT_ISSUER, SESSION_COOKIE, jwtSecret, oauthEnabled, userFromClaims } from "@/lib/auth/session";
import { normalizeUsername } from "@/lib/auth/validation";

// One Passport instance per server bundle, configured on first use so builds
// need no secrets. No sessions and no serializeUser: our JWT is the session.

export const BCRYPT_COST = 12;
export const INVALID_LOGIN = "Invalid username or password";

let dummyHash: Promise<string> | undefined;
// Compared against when the username is unknown or has no password, so timing matches.
const getDummyHash = () => (dummyHash ??= bcrypt.hash("jobseance-timing-equalizer-0000", BCRYPT_COST));

/** When an Authorization header is present only it counts; otherwise the cookie. */
const extractToken: JwtFromRequestFunction = (req) => {
  const r = req as unknown as { headers: Record<string, string | undefined>; cookies?: Record<string, string> };
  if (r.headers.authorization !== undefined) return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  return r.cookies?.[SESSION_COOKIE] ?? null;
};

export type OAuthOutcome = LinkResult | { ok: false; code: "oauth_no_email" };

let configured = false;

export function getPassport() {
  if (configured) return passport;

  passport.use(
    new LocalStrategy({ session: false }, async (rawUsername, password, done) => {
      try {
        const user = await getDb().user.findUnique({
          where: { username: normalizeUsername(rawUsername) },
          select: { id: true, tokenVersion: true, passwordHash: true },
        });
        const hash = user?.passwordHash ?? (await getDummyHash());
        const match = await bcrypt.compare(password.normalize("NFC"), hash);
        if (!user?.passwordHash || !match) return done(null, false, { message: INVALID_LOGIN });
        return done(null, { id: user.id, tokenVersion: user.tokenVersion });
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.use(
    new JwtStrategy(
      {
        jwtFromRequest: extractToken,
        secretOrKey: jwtSecret(),
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
      async (claims: { sub?: string; tv?: unknown }, done: (e: unknown, user?: unknown) => void) => {
        try {
          done(null, (await userFromClaims(claims)) ?? false);
        } catch (error) {
          done(error);
        }
      },
    ),
  );

  if (oauthEnabled("google")) {
    const options: GoogleOptions & { state: boolean; pkce: boolean } = {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      callbackURL: process.env.GOOGLE_CALLBACK_URL!, // absolute, or Vercel's proxy turns it into http://
      scope: ["openid", "email", "profile"],
      // In the constructor: passed to authenticate() they are silently ignored.
      state: true,
      pkce: true,
    };
    passport.use(
      new GoogleStrategy(options, async (_accessToken, _refreshToken, profile: GoogleProfile, done: VerifyCallback) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(null, { ok: false, code: "oauth_failed" } satisfies OAuthOutcome);
          const verifiedClaim: unknown = profile._json?.email_verified;
          const outcome: OAuthOutcome = await linkOAuthAccount({
            provider: "GOOGLE",
            providerAccountId: profile.id,
            email,
            emailVerified: verifiedClaim === true || verifiedClaim === "true",
            name: profile.displayName || null,
          });
          done(null, outcome);
        } catch (error) {
          done(error);
        }
      }),
    );
  }

  if (oauthEnabled("github")) {
    // @types/passport-github2 types `state` as a string; passport-oauth2 needs `true` here.
    const options: Omit<GitHubOptions, "state"> & { state: boolean; pkce: boolean } = {
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      callbackURL: process.env.GITHUB_CALLBACK_URL!,
      scope: ["user:email"],
      allRawEmails: true,
      state: true,
      pkce: true,
    };
    passport.use(
      new GitHubStrategy(
        options as unknown as GitHubOptions,
        async (_accessToken: string, _refreshToken: string, profile: PassportProfile, done: VerifyCallback) => {
          try {
            // With allRawEmails, each entry is GitHub's raw /user/emails object.
            const emails = (profile.emails ?? []) as RawGitHubEmail[];
            const primary = emails.find((e) => e.primary && e.verified);
            if (!primary) return done(null, { ok: false, code: "oauth_no_email" } satisfies OAuthOutcome);
            const outcome: OAuthOutcome = await linkOAuthAccount({
              provider: "GITHUB",
              providerAccountId: String(profile.id),
              email: primary.value,
              emailVerified: true,
              name: profile.displayName || profile.username || null,
            });
            done(null, outcome);
          } catch (error) {
            done(error);
          }
        },
      ),
    );
  }

  configured = true;
  return passport;
}

type RawGitHubEmail = { value: string; primary?: boolean; verified?: boolean };
