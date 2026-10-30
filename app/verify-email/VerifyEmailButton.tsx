"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ui from "../components/ui.module.css";
import { api, ApiCallError } from "@/lib/ui";

/** Uses the verification link with a POST to /api/auth/verify-email. */
export default function VerifyEmailButton({ token }: { token: string }) {
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the one-time token out of the address bar and history once the page has it.
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const reply = await api<{ message: string }>("POST", "/api/auth/verify-email", { token });
      setDone(true);
      setStatus(reply.message);
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("That didn't work. Please try again.", 0);
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <p className={ui.statusOk} role="status">
          {status}
        </p>
        <Link className={`${ui.primary} self-start px-5 py-2.5`} href="/dashboard">
          Go to your dashboard
        </Link>
      </>
    );
  }

  return (
    <>
      <p className={ui.body}>Press the button to confirm this email address for your JobSeance account.</p>
      <button type="button" className={`${ui.primary} self-start px-5 py-2.5`} onClick={confirm} disabled={busy} aria-busy={busy}>
        {busy ? "Confirming…" : "Confirm my email"}
      </button>
      <p className={ui.statusError} role="status">
        {status}
      </p>
    </>
  );
}
