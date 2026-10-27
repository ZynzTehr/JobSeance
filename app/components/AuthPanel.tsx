"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import AnimatedAuthForm, { type AuthValues } from "./AnimatedAuthForm";

type Props = {
  initialMode: "login" | "signup";
  initialStatus?: string;
  oauth: { google: boolean; github: boolean };
  footer?: ReactNode;
};

/** Connects the form to /api/auth/login and /api/auth/signup. The JWT arrives as an HttpOnly cookie. */
export default function AuthPanel(props: Props) {
  const router = useRouter();

  async function authenticate(values: AuthValues) {
    const { mode, ...body } = values;
    let response: Response;
    try {
      response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
