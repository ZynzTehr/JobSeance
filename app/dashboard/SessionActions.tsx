"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./dashboard.module.css";

const ACTIONS = {
  logout: { url: "/api/auth/logout", label: "Log out", pending: "Logging out…" },
  everywhere: { url: "/api/v1/me/logout-all", label: "Log out everywhere", pending: "Signing out all devices…" },
} as const;

type Action = keyof typeof ACTIONS;

export default function SessionActions() {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState("");

  async function run(action: Action) {
    setPending(action);
    setError("");
    try {
      const response = await fetch(ACTIONS[action].url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error();
      router.push("/login");
      router.refresh();
    } catch {
      setError("That didn't work. Please try again.");
      setPending(null);
    }
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap gap-3">
        {(Object.keys(ACTIONS) as Action[]).map((action) => (
          <button
            key={action}
            type="button"
            className={`${action === "logout" ? styles.primary : styles.secondary} px-5 py-2.5`}
            onClick={() => run(action)}
            disabled={pending !== null}
          >
            {pending === action ? ACTIONS[action].pending : ACTIONS[action].label}
          </button>
        ))}
      </div>
      <p className={`${styles.hint} mt-3`}>&ldquo;Log out everywhere&rdquo; also stops any copied API token from working.</p>
      <p className={`${styles.error} mt-2`} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}
