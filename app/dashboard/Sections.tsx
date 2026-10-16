"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiCallError, BAND_LABEL, CHANNEL_LABEL, checkedAt, shortDate, type BandValue, type ChannelValue } from "@/lib/ui";
import ui from "../components/ui.module.css";
import styles from "./dashboard.module.css";
import { useInFlight } from "./useInFlight";

export type SavedCheckRow = {
  id: string;
  inputKind: "URL" | "COMPANY_ROLE" | "MESSAGE";
  ghostScore: number | null;
  ghostBand: BandValue;
  scamScore: number | null;
  scamBand: BandValue;
  senderDomain: string | null;
  createdAt: Date;
  posting: { title: string; url: string } | null;
};

export type ScamReportRow = {
  id: string;
  senderDomain: string;
  channel: ChannelValue;
  ruleIds: string[];
  scamScore: number;
  redactedExcerpt: string | null;
  visibility: string;
  createdAt: Date;
};

// The label describes the posting or message, never the company, so a band never sits next to a company name.
const label = (c: SavedCheckRow) =>
  c.inputKind === "MESSAGE"
    ? `Recruiter message${c.senderDomain ? ` from ${c.senderDomain}` : ""}`
    : (c.posting?.title ?? (c.inputKind === "URL" ? "Job link check" : "Company + role check"));

function useAction() {
  const router = useRouter();
  const { isBusy, start, end } = useInFlight();
  const [status, setStatus] = useState({ text: "", error: false });
  async function run(id: string, method: string, url: string, body: unknown, done: string) {
    start(id);
    try {
      await api(method, url, body);
      setStatus({ text: done, error: false });
      router.refresh();
    } catch (e) {
      setStatus({ text: e instanceof ApiCallError ? e.message : "That didn't work.", error: true });
    } finally {
      end(id);
    }
  }
  return { isBusy, status, run };
}

export function SavedChecks({ checks }: { checks: SavedCheckRow[] }) {
  const { isBusy, status, run } = useAction();
  if (checks.length === 0) {
    return (
      <p className={ui.muted}>
        Nothing saved yet. Run a check on the{" "}
        <Link className={ui.link} href="/">
          scanner
        </Link>{" "}
        and press &ldquo;Save this check&rdquo;.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {checks.map((c) => (
          <li key={c.id} className={`${styles.row} grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center`}>
            <div className="min-w-0">
              <p className={styles.rowTitle}>
                {c.posting ? (
                  <a className={styles.rowLink} href={c.posting.url} target="_blank" rel="noreferrer">
                    {label(c)}
                  </a>
                ) : (
                  label(c)
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.inputKind !== "MESSAGE" && (
                  <span className={`${ui[c.ghostBand]} px-2.5 py-0.5`}>
                    Ghost {BAND_LABEL[c.ghostBand]}
                    {c.ghostScore !== null && ` · ${c.ghostScore}`}
                  </span>
                )}
                <span className={`${ui[c.scamBand]} px-2.5 py-0.5`}>
                  Scam {BAND_LABEL[c.scamBand]}
                  {c.scamScore !== null && ` · ${c.scamScore}`}
                </span>
                <span className={ui.small}>Checked {checkedAt(c.createdAt)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={`${ui.secondary} px-4 py-2`}
                disabled={isBusy(c.id)}
                aria-label={`Unsave ${label(c)}`}
                onClick={() => run(c.id, "PATCH", `/api/v1/checks/${c.id}`, { saved: false }, "Removed from saved checks.")}
              >
                Unsave
              </button>
              <button
                type="button"
                className={`${ui.ghost} px-3 py-2`}
                disabled={isBusy(c.id)}
                aria-label={`Delete ${label(c)}`}
                onClick={() => window.confirm(`Delete "${label(c)}" for good?`) && run(c.id, "DELETE", `/api/v1/checks/${c.id}`, {}, "Check deleted.")}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className={status.error ? ui.statusError : ui.statusOk} role="status">
        {status.text}
      </p>
    </div>
  );
}

export function ScamReports({ reports }: { reports: ScamReportRow[] }) {
  const { isBusy, status, run } = useAction();
  if (reports.length === 0) {
    return <p className={ui.muted}>No scam reports. After checking a suspicious message, use &ldquo;Report this sender&rdquo;.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {reports.map((r) => (
          <li key={r.id} className={`${styles.row} grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center`}>
            <div className="min-w-0">
              <p className={styles.rowTitle}>Sender domain {r.senderDomain}</p>
              <p className={`${ui.small} mt-1`}>
                {CHANNEL_LABEL[r.channel]} · {r.ruleIds.length} warning {r.ruleIds.length === 1 ? "sign" : "signs"} · reported {shortDate(r.createdAt)}
                {r.visibility !== "VISIBLE" && " · hidden while under review"}
              </p>
              {r.redactedExcerpt && <p className={`${ui.small} mt-1`}>Excerpt (redacted): &ldquo;{r.redactedExcerpt}&rdquo;</p>}
              <Link
                className={`${ui.link} ${ui.small} mt-1.5 inline-block`}
                href={`/report-a-problem?type=SCAM_REPORT&id=${encodeURIComponent(r.id)}&label=${encodeURIComponent(`your report on ${r.senderDomain}`)}`}
              >
                Report a problem
              </Link>
            </div>
            <div className="flex gap-2">
              {r.redactedExcerpt && (
                <button
                  type="button"
                  className={`${ui.secondary} px-4 py-2`}
                  disabled={isBusy(r.id)}
                  aria-label={`Remove excerpt from the report on ${r.senderDomain}`}
                  onClick={() => run(r.id, "PATCH", `/api/v1/scam-reports/${r.id}`, { removeExcerpt: true }, "Excerpt removed.")}
                >
                  Remove excerpt
                </button>
              )}
              <button
                type="button"
                className={`${ui.ghost} px-3 py-2`}
                disabled={isBusy(r.id)}
                aria-label={`Delete the scam report on ${r.senderDomain}`}
                onClick={() => window.confirm(`Delete your scam report on ${r.senderDomain}?`) && run(r.id, "DELETE", `/api/v1/scam-reports/${r.id}`, {}, "Scam report deleted.")}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className={status.error ? ui.statusError : ui.statusOk} role="status">
        {status.text}
      </p>
    </div>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api("DELETE", "/api/v1/me");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "Couldn't delete your account.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className={ui.muted}>
        Deletes your account, your application reports and your scam reports. Saved checks are unlinked from you. This
        can&rsquo;t be undone.
      </p>
      <label htmlFor="delete-confirm" className={ui.label}>
        Type DELETE to confirm
      </label>
      <div className="flex flex-col items-start gap-3">
        <input
          id="delete-confirm"
          className={`${ui.input} w-full px-3 py-2.5 sm:w-48`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />
        <button
          id="delete-account"
          type="button"
          className={`${ui.danger} px-5 py-2.5`}
          disabled={confirm !== "DELETE" || busy}
          aria-busy={busy}
          onClick={remove}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
      <p className={ui.statusError} role="alert">
        {error}
      </p>
    </div>
  );
}
