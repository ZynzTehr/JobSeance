"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import ui from "../components/ui.module.css";
import { passwordRules } from "@/lib/auth/password-rules";
import { api, ApiCallError } from "@/lib/ui";
import styles from "./reset.module.css";

/** Posts the emailed token and the new password to /api/auth/reset-password. */
export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const rules = passwordRules(password);

  // Keep the one-time token out of the address bar and history once the page has it.
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const reply = await api<{ message: string }>("POST", "/api/auth/reset-password", { token, newPassword: password });
      setPassword("");
      setDone(reply.message);
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("That didn't work. Please try again.", 0);
      setError(err.fields.newPassword ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className={ui.statusOk} role="status">
          {done}
        </p>
        <Link className={`${ui.primary} self-start px-5 py-2.5`} href="/login">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} aria-busy={busy}>
      <div>
        <label htmlFor="reset-password" className={ui.label}>
          New password
        </label>
        <input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          maxLength={1000}
          className={`${ui.input} mt-2 w-full px-3 py-2.5`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`reset-password-rules${error ? " reset-error" : ""}`}
        />
      </div>
      <ul id="reset-password-rules" className="flex flex-col gap-1.5" aria-label="Password requirements">
        {rules.map((rule) => (
          <li key={rule.id} className={`${styles.rule} flex items-center gap-2`} data-met={rule.met}>
            <svg className={`${styles.check} h-3.5 w-3.5 shrink-0`} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span>{rule.label}</span>
            <span className="sr-only">{rule.met ? " (done)" : " (not yet)"}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-start gap-2">
        <button type="submit" className={`${ui.primary} px-5 py-2.5`} disabled={busy}>
          {busy ? "Saving…" : "Set new password"}
        </button>
        <p id="reset-error" className={ui.statusError} role="status">
          {error}
        </p>
      </div>
    </form>
  );
}
