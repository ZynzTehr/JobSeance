"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ui from "../components/ui.module.css";
import HoneypotField from "../components/HoneypotField";
import { HONEYPOT_FIELD, waitForMinAge } from "@/lib/form-guard";
import { api, ApiCallError } from "@/lib/ui";

/** Posts to /api/auth/forgot-password, which answers the same way whether or not the account exists. */
export default function ForgotPasswordForm({ formToken }: { formToken: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const decoy = String(new FormData(event.currentTarget).get(HONEYPOT_FIELD) ?? "");
    setBusy(true);
    setError("");
    try {
      await waitForMinAge(mountedAt.current);
      const reply = await api<{ message: string }>("POST", "/api/auth/forgot-password", { email: email.trim(), [HONEYPOT_FIELD]: decoy, formToken });
      setSent(reply.message);
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("That didn't work. Please try again.", 0);
      setError(err.fields.email ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className={ui.statusOk} role="status">
          {sent}
        </p>
        <p className={ui.small}>Nothing after a few minutes? Check your spam folder, or try again with another address.</p>
        <Link className={ui.link} href="/login">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form className="relative flex flex-col gap-4" onSubmit={submit} aria-busy={busy}>
      <HoneypotField />
      <div>
        <label htmlFor="forgot-email" className={ui.label}>
          Email
        </label>
        <input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          className={`${ui.input} mt-2 w-full px-3 py-2.5`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "forgot-error" : undefined}
        />
      </div>
      <div className="flex flex-col items-start gap-2">
        <button type="submit" className={`${ui.primary} px-5 py-2.5`} disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <p id="forgot-error" className={ui.statusError} role="status">
          {error}
        </p>
      </div>
    </form>
  );
}
