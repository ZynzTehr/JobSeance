"use client";

import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { api, ApiCallError } from "@/lib/ui";
import ui from "../components/ui.module.css";
import {
  isFixedTarget,
  REASON_LABEL,
  REASONS_FOR,
  REPORT_TYPES,
  SUBJECTS,
  subjectOf,
  type FlagReasonValue,
  type Prefill,
  type ReportType,
  type Subject,
} from "./options";
import styles from "./report.module.css";

type Props = {
  companies: { slug: string; name: string }[];
  signedIn: boolean;
  prefill: Prefill | null;
};

type Sent = { id: string; subject: Subject; reason: FlagReasonValue; hidden: boolean; linked: boolean; canReply: boolean };

const MAX_DETAILS = 1000;

/** "Report a problem": choose a target, a reason, say what's wrong. Posts to /api/v1/flags. */
export default function ReportProblemForm({ companies, signedIn, prefill }: Props) {
  const prefillSubject = prefill ? subjectOf(prefill.type) : null;
  const prefillSlug = prefill?.type === "COMPANY" ? prefill.id?.toLowerCase() : undefined;
  const prefillCompany = prefillSlug ? companies.find((c) => c.slug === prefillSlug) : undefined;

  const [subject, setSubject] = useState<Subject | null>(prefillSubject);
  const [reportType, setReportType] = useState<ReportType>(prefill?.type === "SCAM_REPORT" ? "SCAM_REPORT" : "OUTCOME_REPORT");
  const [targetIds, setTargetIds] = useState({
    COMPANY: prefillCompany?.slug ?? "",
    CHECK: prefill?.type === "CHECK" ? (prefill.id ?? "") : "",
    REPORT: prefillSubject === "REPORT" ? (prefill?.id ?? "") : "",
  });
  // A company link with an unknown slug falls back to the company picker.
  const [fixed, setFixed] = useState(isFixedTarget(prefill) && (prefill?.type !== "COMPANY" || !!prefillCompany));
  const [reason, setReason] = useState<FlagReasonValue | "">("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  const subjectsRef = useRef<HTMLFieldSetElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const targetType = subject === "REPORT" ? reportType : subject;
  const targetId = subject === null ? "" : subject === "SITE" ? "site" : targetIds[subject].trim();
  const reasons = subject ? REASONS_FOR[subject] : [];

  function chooseSubject(next: Subject) {
    setSubject(next);
    if (reason && !REASONS_FOR[next].includes(reason)) setReason("");
    setFields((f) => ({ ...f, targetType: "", targetId: "" }));
  }

  /** Swap the fixed target for the full choice, and keep keyboard focus on the form. */
  function changeTarget() {
    flushSync(() => setFixed(false));
    subjectsRef.current?.querySelector<HTMLInputElement>("input:checked, input")?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFields({});
    setError("");
    if (!subject || !targetType) {
      setFields({ targetType: "Choose what it's about." });
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    const reporterEmail = signedIn ? "" : email.trim();
    try {
      const { flag, hidden, linkedToAccount } = await api<{ flag: { id: string; status: string }; hidden: boolean; linkedToAccount: boolean }>("POST", "/api/v1/flags", {
        targetType,
        targetId,
        reason,
        details,
        ...(reporterEmail ? { reporterEmail } : {}),
      });
      flushSync(() =>
        setSent({
          id: flag.id,
          subject,
          reason: reason as FlagReasonValue,
          // From the server's answer: a session can expire between page load and send.
          hidden,
          linked: linkedToAccount,
          canReply: linkedToAccount || !!reporterEmail,
        }),
      );
      doneRef.current?.focus();
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("Couldn't send your report.", 0);
      // A 404 means the company, check or report wasn't found: show it on the target field.
      const next = err.status === 404 ? { ...err.fields, targetId: err.message } : err.fields;
      if (next.targetId && fixed) setFixed(false);
      setFields(next);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    flushSync(() => {
      setSent(null);
      setFixed(false);
      setReason("");
      setDetails("");
    });
    subjectsRef.current?.querySelector<HTMLInputElement>("input:checked, input")?.focus();
  }

  const invalid = (name: string, hint?: string) => {
    const ids = [hint, fields[name] ? `rp-${name}-error` : undefined].filter(Boolean).join(" ");
    return { ...(fields[name] ? { "aria-invalid": true as const } : {}), ...(ids ? { "aria-describedby": ids } : {}) };
  };
  const fieldError = (name: string) =>
    fields[name] && (
      <p id={`rp-${name}-error`} className={`${ui.fieldError} mt-1.5`}>
        {fields[name]}
      </p>
    );

  if (sent) {
    return (
      <section aria-labelledby="rp-done-heading" className={`${styles.done} flex flex-col gap-3 p-5 sm:p-6`}>
        <h3 id="rp-done-heading" ref={doneRef} tabIndex={-1} className={ui.h3}>
          Thanks, we&rsquo;ve got it
        </h3>
        <p className={ui.body}>
          Your reference is <code className={ui.inlineCode}>{sent.id}</code>. Quote it if you write to us about this again.
        </p>
        {sent.hidden && <p className={ui.body}>That report is hidden until we review it.</p>}
        <p className={ui.body}>
          {sent.reason === "score_wrong"
            ? "A person will re-check that result. If the score was factually wrong, we'll add a correction note."
            : sent.subject === "SITE"
              ? "A person will read it and act on it."
              : "A person will review it by hand. If it breaks our rules we hide or remove it; we never edit what someone wrote."}{" "}
          {sent.canReply
            ? sent.linked
              ? "If we need to reply, we'll use the email on your account."
              : "If we need to reply, we'll use the email you gave."
            : "You didn't leave an email, so we can't reply directly."}
        </p>
        <div>
          <button type="button" className={`${ui.secondary} mt-1 px-5 py-2.5`} onClick={startOver}>
            Report something else
          </button>
        </div>
      </section>
    );
  }

  const company = companies.find((c) => c.slug === targetIds.COMPANY);
  const fixedText =
    subject === "COMPANY"
      ? `${company?.name ?? prefill?.label ?? targetIds.COMPANY}'s community summary`
      : subject === "CHECK"
        ? "This check result"
        : subject === "REPORT"
          ? reportType === "SCAM_REPORT"
            ? "This scam report"
            : "This application report"
          : "Something about the site";
  const fixedId = subject === "CHECK" || subject === "REPORT" ? targetId : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {fixed && subject ? (
        <div role="group" aria-labelledby="rp-fixed-label">
          <p className={ui.label} id="rp-fixed-label">
            What is it about?
          </p>
          <div className={`${styles.target} mt-2 flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
            <p className={`${ui.body} min-w-0`}>
              {fixedText}
              {fixedId && (
                <>
                  {" "}
                  <code className={`${ui.inlineCode} ${styles.id}`}>{fixedId}</code>
                </>
              )}
            </p>
            <button type="button" className={`${ui.ghost} px-3 py-1.5`} onClick={changeTarget} aria-label="Change what this is about">
              Change
            </button>
          </div>
          {fieldError("targetId")}
        </div>
      ) : (
        <>
          <fieldset
            ref={subjectsRef}
            className={`${styles.fieldset} m-0 min-w-0 p-0`}
            {...(fields.targetType ? { "aria-describedby": "rp-targetType-error" } : {})}
          >
            <legend className={`${ui.label} p-0`}>What is it about?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {SUBJECTS.map((s) => (
                <label key={s.value} className={`${styles.option} flex items-start gap-3 p-3.5`}>
                  <input
                    type="radio"
                    name="rp-subject"
                    value={s.value}
                    className={`${ui.checkbox} mt-1 h-4 w-4 shrink-0`}
                    checked={subject === s.value}
                    onChange={() => chooseSubject(s.value)}
                    aria-describedby={`rp-subject-${s.value}-hint`}
                    required
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={styles.optionTitle}>{s.label}</span>
                    <span id={`rp-subject-${s.value}-hint`} className={ui.small}>
                      {s.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {fieldError("targetType")}
          </fieldset>

          {subject === "COMPANY" && (
            <div>
              <label htmlFor="rp-company" className={ui.label}>
                Company
              </label>
              <select
                id="rp-company"
                className={`${ui.input} mt-2 w-full px-3 py-2.5`}
                required
                value={targetIds.COMPANY}
                onChange={(e) => setTargetIds({ ...targetIds, COMPANY: e.target.value })}
                {...invalid("targetId")}
              >
                <option value="">Choose a company</option>
                {companies.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              {fieldError("targetId")}
            </div>
          )}

          {subject === "CHECK" && (
            <div>
              <label htmlFor="rp-check" className={ui.label}>
                Check ID
              </label>
              <input
                id="rp-check"
                className={`${ui.input} mt-2 w-full px-3 py-2.5`}
                required
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                value={targetIds.CHECK}
                onChange={(e) => setTargetIds({ ...targetIds, CHECK: e.target.value })}
                {...invalid("targetId", "rp-check-hint")}
              />
              <p id="rp-check-hint" className={`${ui.small} mt-1.5`}>
                Easiest: use &ldquo;Report a problem with this result&rdquo; at the bottom of any result, which fills this in. Otherwise
                paste the <code className={ui.inlineCode}>id</code> from the API&rsquo;s check response.
              </p>
              {fieldError("targetId")}
            </div>
          )}

          {subject === "REPORT" && (
            <>
              <fieldset className={`${styles.fieldset} m-0 min-w-0 p-0`}>
                <legend className={`${ui.label} p-0`}>Which kind of report?</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {REPORT_TYPES.map((t) => (
                    <label key={t.value} className={`${ui.body} flex items-center gap-2`}>
                      <input
                        type="radio"
                        name="rp-report-type"
                        value={t.value}
                        className={`${ui.checkbox} h-4 w-4`}
                        checked={reportType === t.value}
                        onChange={() => setReportType(t.value)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="rp-report" className={ui.label}>
                  Report ID
                </label>
                <input
                  id="rp-report"
                  className={`${ui.input} mt-2 w-full px-3 py-2.5`}
                  required
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                  value={targetIds.REPORT}
                  onChange={(e) => setTargetIds({ ...targetIds, REPORT: e.target.value })}
                  {...invalid("targetId", "rp-report-hint")}
                />
                <p id="rp-report-hint" className={`${ui.small} mt-1.5`}>
                  Individual reports are never public. For your own reports, use the &ldquo;Report a problem&rdquo; link on
                  each one in your dashboard, which fills this in. Over the API, it&rsquo;s the{" "}
                  <code className={ui.inlineCode}>id</code> from <code className={ui.inlineCode}>GET /api/v1/reports/mine</code> or
                  from the response when you created a scam report. To flag what users reported about a company, choose
                  &ldquo;A company&rsquo;s community summary&rdquo; instead.
                </p>
                {fieldError("targetId")}
              </div>
            </>
          )}
        </>
      )}

      <div>
        <label htmlFor="rp-reason" className={ui.label}>
          What&rsquo;s wrong?
        </label>
        <select
          id="rp-reason"
          className={`${ui.input} mt-2 w-full px-3 py-2.5`}
          required
          disabled={!subject}
          value={reason}
          onChange={(e) => setReason(e.target.value as FlagReasonValue | "")}
          {...invalid("reason")}
        >
          <option value="">{subject ? "Choose a reason" : "Choose what it's about first"}</option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </select>
        {fieldError("reason")}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="rp-details" className={ui.label}>
            Details
          </label>
          <span className={`${ui.small} ${styles.counter}`} aria-hidden>
            {details.length} / {MAX_DETAILS}
          </span>
        </div>
        <textarea
          id="rp-details"
          className={`${ui.input} mt-2 w-full px-3 py-2.5`}
          rows={6}
          required
          maxLength={MAX_DETAILS}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          {...invalid("details", "rp-details-hint")}
        />
        <p id="rp-details-hint" className={`${ui.small} mt-1.5`}>
          {reason === "privacy_request"
            ? "Say what you'd like: a copy of your data, a correction or deletion. "
            : "Say what's wrong and, if you can, how you know. "}
          Up to {MAX_DETAILS} characters. Don&rsquo;t include other people&rsquo;s names or contact details.
        </p>
        {fieldError("details")}
      </div>

      {signedIn ? (
        <p className={ui.small}>You&rsquo;re signed in, so we&rsquo;ll link this to your account and reply to its email if we need to.</p>
      ) : (
        <div>
          <label htmlFor="rp-email" className={ui.label}>
            Your email <span className={ui.small}>(optional, so we can reply)</span>
          </label>
          <input
            id="rp-email"
            type="email"
            className={`${ui.input} mt-2 w-full px-3 py-2.5`}
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...invalid("reporterEmail", "rp-email-hint")}
          />
          <p id="rp-email-hint" className={`${ui.small} mt-1.5`}>
            Only used to reply about this report. It&rsquo;s never shown, and it&rsquo;s deleted 90 days after we close the report.
          </p>
          {fieldError("reporterEmail")}
        </div>
      )}

      <p className={error ? ui.statusError : ui.statusOk} role="alert">
        {error}
      </p>

      <div>
        <button type="submit" className={`${ui.primary} px-6 py-2.5`} disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}
