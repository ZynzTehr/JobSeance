import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromToken, type PublicUser } from "@/lib/auth/session";

/** The signed-in user for a Server Component, or null. Reading cookies makes the page dynamic. */
export async function currentUser(): Promise<PublicUser | null> {
  return userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}
