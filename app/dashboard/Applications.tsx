"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { api, ApiCallError, OUTCOME_LABEL, shortDate, STAGE_LABEL, type OutcomeValue } from "@/lib/ui";
import ui from "../components/ui.module.css";
import styles from "./dashboard.module.css";
import { useInFlight } from "./useInFlight";

export type ReportRow = {
  id: string;
  roleTitle: string;
  appliedAt: Date;
  lastInterviewAt: Date | null;
  stageReached: keyof typeof STAGE_LABEL;
  outcome: OutcomeValue;
  note: string | null;
  visibility: "VISIBLE" | "HIDDEN_PENDING_REVIEW" | "REMOVED";
  company: { slug: string; name: string; isFictional: boolean };
};

type Props = {
  reports: ReportRow[];
  companies: { slug: string; name: string }[];
  prefill: { company?: string; role?: string };
};

// The user's local date: toISOString() alone is UTC, which is already tomorrow on a US evening.
const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const noSubscribe = () => () => {};
// The server can't know the user's time zone, so it renders no date and the browser fills it in after hydration.
const useToday = () => useSyncExternalStore(noSubscribe, localToday, () => "");

/**
 * A row's status picker. It commits shortly after the last change (or on blur), so arrowing
 * through the options with the keyboard sends one update, not one per option. It never
 * disables itself, so focus stays put while the request runs.
 */
function StatusSelect({ report, onCommit }: { report: ReportRow; onCommit: (outcome: OutcomeValue) => Promise<boolean> }) {
  const [value, setValue] = useState<OutcomeValue>(report.outcome);
  const [saving, setSaving] = useState(false);
  const pending = useRef<OutcomeValue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const committed = useRef<OutcomeValue>(report.outcome);

  useEffect(() => () => clearTimeout(timer.current), []);

  function flush() {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || next === committed.current) return;
    // Updates run one after another, so the last choice is the one that sticks.
    queue.current = queue.current.then(async () => {
      setSaving(true);
      if (await onCommit(next)) committed.current = next;
      else if (!pending.current) setValue(committed.current);
      setSaving(false);
    });
  }

  return (
    <>
      <label htmlFor={`status-${report.id}`} className="sr-only">
        Status for {report.roleTitle} at {report.company.name}
      </label>
      <select
        id={`status-${report.id}`}
        className={`${ui.input} py-2 pl-3 pr-12`}
        value={value}
        aria-busy={saving}
        onChange={(e) => {
          setValue(e.target.value as OutcomeValue);
          pending.current = e.target.value as OutcomeValue;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 600);
        }}
        onBlur={flush}
      >
        {Object.entries(OUTCOME_LABEL).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </>
  );
}

/** My applications: log an outcome, change its status, delete it. */
export default function Applications({ reports, companies, prefill }: Props) {
  const router = useRouter();
  const today = useToday();
  const known = companies.some((c) => c.slug === prefill.company);
  const [form, setForm] = useState({
    company: known ? prefill.company! : "",
    roleTitle: prefill.role ?? "",
    appliedAt: "",
    lastInterviewAt: "",
    outcome: "APPLIED" as OutcomeValue,
    note: "",
    firstHand: false,
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState({ text: "", error: false });
  const { isBusy, start, end } = useInFlight();

  async function create(event: FormEvent) {
    event.preventDefault();
    start("create");
    setFields({});
    setStatus({ text: "", error: false });
    try {
      await api("POST", "/api/v1/reports", {
        company: form.company,
        roleTitle: form.roleTitle,
        appliedAt: form.appliedAt || today,
        ...(form.lastInterviewAt ? { lastInterviewAt: form.lastInterviewAt } : {}),
        outcome: form.outcome,
        ...(form.note.trim() ? { note: form.note } : {}),
        firstHand: form.firstHand,
      });
      setForm({ ...form, roleTitle: "", lastInterviewAt: "", note: "", firstHand: false, outcome: "APPLIED" });
      setStatus({ text: "Logged. It counts toward the company's community summary.", error: false });
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("Couldn't save.", 0);
      setFields(err.fields);
      setStatus({ text: err.message, error: true });
    } finally {
      end("create");
    }
  }

  async function updateOutcome(id: string, outcome: OutcomeValue) {
    setStatus({ text: "", error: false });
    try {
      await api("PATCH", `/api/v1/reports/${id}`, { outcome });
      setStatus({ text: `Status updated to ${OUTCOME_LABEL[outcome]}.`, error: false });
      router.refresh();
      return true;
    } catch (e) {
      setStatus({ text: e instanceof ApiCallError ? e.message : "Couldn't update.", error: true });
      return false;
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this report? It will no longer count toward the company's summary.")) return;
    start(id);
    try {
      await api("DELETE", `/api/v1/reports/${id}`);
      setStatus({ text: "Report deleted.", error: false });
      router.refresh();
    } catch (e) {
      setStatus({ text: e instanceof ApiCallError ? e.message : "Couldn't delete.", error: true });
    } finally {
      end(id);
    }
  }

  const invalid = (name: string) => (fields[name] ? { "aria-invalid": true as const, "aria-describedby": `log-${name}-error` } : {});
  const error = (name: string) =>
    fields[name] && (
      <p id={`log-${name}-error`} className={`${ui.fieldError} mt-1.5`}>
        {fields[name]}
      </p>
    );

  return (
    <div className="flex flex-col gap-6">
      {reports.length === 0 ? (
        <p className={ui.muted}>No applications yet. Log one below, or from a scan result.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li key={r.id} className={`${styles.row} grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center`}>
              <div className="min-w-0">
                <p className={styles.rowTitle}>
                  {r.roleTitle.replace(/\b\w/g, (c) => c.toUpperCase())} <span className={ui.muted}>at {r.company.name}</span>
                </p>
                <p className={`${ui.small} mt-1`}>
                  Applied {shortDate(r.appliedAt)}
                  {r.lastInterviewAt && <> · Last interview {shortDate(r.lastInterviewAt)}</>} · Stage: {STAGE_LABEL[r.stageReached]}
                  {r.visibility !== "VISIBLE" && <> · Hidden while a report about it is reviewed</>}
                </p>
                {r.note && <p className={`${ui.small} mt-1`}>&ldquo;{r.note}&rdquo;</p>}
                <Link
                  className={`${ui.link} ${ui.small} mt-1.5 inline-block`}
                  href={`/report-a-problem?type=OUTCOME_REPORT&id=${encodeURIComponent(r.id)}&label=${encodeURIComponent(`${r.roleTitle} at ${r.company.name}`)}`}
                >
                  Report a problem
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <StatusSelect report={r} onCommit={(outcome) => updateOutcome(r.id, outcome)} />
                <button
                  id={`delete-${r.id}`}
                  type="button"
                  className={`${ui.ghost} px-3 py-2`}
                  onClick={() => remove(r.id)}
                  disabled={isBusy(r.id)}
                  aria-label={`Delete ${r.roleTitle} at ${r.company.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className={status.error ? ui.statusError : ui.statusOk} role="status">
        {status.text}
      </p>

      <form id="log-outcome" onSubmit={create} className={`${styles.formCard} flex scroll-mt-24 flex-col gap-4 p-5`}>
        <h3 className={ui.h3}>Log an application</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="log-company" className={ui.label}>
              Company
            </label>
            <select
              id="log-company"
              className={`${ui.input} mt-2 w-full py-2.5 pl-3 pr-12`}
              required
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              {...invalid("company")}
            >
              <option value="">Choose a company</option>
              {companies.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            {error("company")}
          </div>
          <div>
            <label htmlFor="log-role" className={ui.label}>
              Role title
            </label>
            <input
              id="log-role"
              className={`${ui.input} mt-2 w-full px-3 py-2.5`}
              required
              maxLength={200}
              value={form.roleTitle}
              onChange={(e) => setForm({ ...form, roleTitle: e.target.value })}
              {...invalid("roleTitle")}
            />
            {error("roleTitle")}
          </div>
          <div>
            <label htmlFor="log-applied" className={ui.label}>
              Applied on
            </label>
            <input
              id="log-applied"
              type="date"
              className={`${ui.input} mt-2 w-full px-3 py-2.5`}
              required
              max={today || undefined}
              value={form.appliedAt || today}
              onChange={(e) => setForm({ ...form, appliedAt: e.target.value })}
              {...invalid("appliedAt")}
            />
            {error("appliedAt")}
          </div>
          <div>
            <label htmlFor="log-interview" className={ui.label}>
              Last interview <span className={ui.small}>(optional)</span>
            </label>
            <input
              id="log-interview"
              type="date"
              className={`${ui.input} mt-2 w-full px-3 py-2.5`}
              min={form.appliedAt || today || undefined}
              max={today || undefined}
              value={form.lastInterviewAt}
              onChange={(e) => setForm({ ...form, lastInterviewAt: e.target.value })}
              {...invalid("lastInterviewAt")}
            />
            {error("lastInterviewAt")}
          </div>
          <div>
            <label htmlFor="log-outcome-status" className={ui.label}>
              Status
            </label>
            <select
              id="log-outcome-status"
              className={`${ui.input} mt-2 w-full py-2.5 pl-3 pr-12`}
              value={form.outcome}
              onChange={(e) => setForm({ ...form, outcome: e.target.value as OutcomeValue })}
            >
              {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="log-note" className={ui.label}>
              Note <span className={ui.small}>(optional, only you see it)</span>
            </label>
            <input
              id="log-note"
              className={`${ui.input} mt-2 w-full px-3 py-2.5`}
              maxLength={1000}
              placeholder="No names, emails or phone numbers"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              {...invalid("note")}
            />
            {error("note")}
          </div>
        </div>
        <label className={`${ui.body} flex items-start gap-3`}>
          <input
            id="log-firsthand"
            type="checkbox"
            className={`${ui.checkbox} mt-1 h-4 w-4`}
            checked={form.firstHand}
            onChange={(e) => setForm({ ...form, firstHand: e.target.checked })}
            required
          />
          <span>
            This is my own first-hand experience applying for this role.
            {error("firstHand")}
          </span>
        </label>
        <p className={ui.small}>
          Others only ever see counts for the company once 3+ people have reported, never your role, dates or note.
        </p>
        <div>
          <button id="log-submit" type="submit" className={`${ui.primary} px-6 py-2.5`} disabled={isBusy("create")}>
            {isBusy("create") ? "Saving…" : "Log application"}
          </button>
        </div>
      </form>
    </div>
  );
}
