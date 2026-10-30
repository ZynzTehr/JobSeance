"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { waitForMinAge } from "@/lib/form-guard";
import AnimatedAuthForm, { type AuthValues } from "./AnimatedAuthForm";

type Props = {
  initialMode: "login" | "signup";
  initialStatus?: string;
  oauth: { google: boolean; github: boolean };
  footer?: ReactNode;
  forgotPasswordHref?: string;
  /** Signed by the server when it rendered this page (lib/bot-guard.ts). */
  formToken: string;
};

/** Connects the form to /api/auth/login and /api/auth/signup. The JWT arrives as an HttpOnly cookie. */
export default function AuthPanel({ formToken, ...props }: Props) {
  const router = useRouter();
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  async function authenticate(values: AuthValues) {
    const { mode, ...body } = values;
    // The server refuses forms sent within two seconds of rendering; a quick person just waits.
    await waitForMinAge(mountedAt.current);
    let response: Response;
    try {
      response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, formToken }),
      });
    } catch {
      throw new Error("Network error. Check your connection and try again.");
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string; fields?: Record<string, string> } }
        | null;
      const fields = data?.error?.fields;
      // Prefer the specific field message (e.g. "That username is taken.").
      throw new Error((fields && Object.values(fields)[0]) || data?.error?.message || "Something went wrong.");
    }
    router.push("/scan");
    router.refresh();
  }

  return <AnimatedAuthForm {...props} onAuthenticate={authenticate} />;
}
