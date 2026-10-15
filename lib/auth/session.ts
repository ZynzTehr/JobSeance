import jwt from "jsonwebtoken";
import { getDb } from "@/lib/db";

// Our own HS256 JWT (spec "Our JWT"). Claims: sub, tv, iss, aud, exp. No PII.

export const SESSION_COOKIE = "jobseance_session";
export const JWT_ISSUER = "jobseance";
export const JWT_AUDIENCE = "jobseance-api";
const TOKEN_TTL_SEC = 24 * 60 * 60;

/** Read lazily so `next build` needs no secret; refuses secrets under 32 bytes. */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes (openssl rand -base64 32).");
  }
  return secret;
}

export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** A provider's strategy and button exist only when its client ID is set. */
export function oauthEnabled(provider: "google" | "github"): boolean {
  return Boolean(provider === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.GITHUB_CLIENT_ID);
}

export function signToken(user: { id: string; tokenVersion: number }): string {
  return jwt.sign({ tv: user.tokenVersion }, jwtSecret(), {
    algorithm: "HS256",
    subject: user.id,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: TOKEN_TTL_SEC,
  });
}

function cookie(value: string, maxAge: number): string {
  const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (appUrl().startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}

export const sessionCookie = (token: string) => cookie(token, TOKEN_TTL_SEC);
export const clearedSessionCookie = () => cookie("", 0);

/** Every field we ever return about a user. Never includes passwordHash. */
export const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  emailVerifiedAt: true,
  createdAt: true,
  accounts: { select: { provider: true } },
} as const;

export async function loadPublicUser(id: string) {
  const user = await getDb().user.findUnique({ where: { id }, select: { ...publicUserSelect, tokenVersion: true } });
  if (!user) return null;
  const { tokenVersion, accounts, ...rest } = user;
  return { tokenVersion, user: { ...rest, providers: accounts.map((a) => a.provider) } };
}

export type PublicUser = NonNullable<Awaited<ReturnType<typeof loadPublicUser>>>["user"];

/** Shared by passport-jwt and server components: verified claims + live tokenVersion. */
export async function userFromClaims(claims: { sub?: string; tv?: unknown }): Promise<PublicUser | null> {
  if (!claims.sub || typeof claims.tv !== "number") return null;
  const found = await loadPublicUser(claims.sub);
  if (!found || found.tokenVersion !== claims.tv) return null;
  return found.user;
}

/** For server components (e.g. /dashboard), which read the cookie directly. */
export async function userFromToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, jwtSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as jwt.JwtPayload;
    return await userFromClaims(claims);
  } catch {
    return null;
  }
}
