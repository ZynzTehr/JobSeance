"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiCallError, CHANNEL_LABEL, type ChannelValue } from "@/lib/ui";
import AutoGrowTextarea from "../AutoGrowTextarea";
import ui from "../ui.module.css";
import ResultCard from "./ResultCard";
import styles from "./scanner.module.css";
import type { CheckResult, MessageInput } from "./types";

type Kind = "url" | "company_role" | "message";

const TABS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "url", label: "Job link", hint: "A Greenhouse, Lever or Ashby job URL" },
  { kind: "company_role", label: "Company + role", hint: "Look a role up on the company's own board" },
  { kind: "message", label: "Recruiter message", hint: "Paste an email or text you received" },
];

// Shown one by one while the server works. They describe real steps, but the
// result appears the moment the response lands; the animation never holds it back.
const STEPS: Record<Kind, string[]> = {
  url: ["Reading the link", "Finding the employer's job board", "Looking for this job ID", "Reading the posting text", "Scoring both risks"],
  company_role: ["Finding the company", "Opening its job board", "Matching the role title", "Reading community reports", "Scoring both risks"],
  message: ["Reading the sender's domain", "Checking registration age and mail records", "Matching FTC and FBI warning signs", "Checking JobSeance reports", "Scoring scam risk"],
};

const EXAMPLES = {
  url: { url: "https://job-boards.greenhouse.io/discord/jobs/8806482002" },
  company_role: { company: "bramblecloud", role: "Data Analyst" },
  message: {
    senderEmail: "talent@bramblecloud-careers.example",
    companyClaimed: "Bramblecloud Software",
    channel: "EMAIL" as ChannelValue,
    text: "Hello from the Bramblecloud Software hiring team. Your interview will be held by chat on WhatsApp. We will mail you a check to buy equipment from our vendor. Deposit the check by mobile deposit and send the remaining balance to the vendor. Please respond within 24 hours.",
  },
};

export default function Scanner({ signedIn }: { signedIn: boolean }) {
  const [kind, setKind] = useState<Kind>("url");
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState<MessageInput>({ text: "", senderEmail: "", companyClaimed: "", channel: "EMAIL" });
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ data: CheckResult; message: MessageInput | null } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS[kind].length - 1)), 650);
    return () => clearInterval(timer);
  }, [running, kind]);

  useEffect(() => {
    if (!result) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Focus the heading so a screen reader reads the title, then the card by headings.
    resultRef.current?.querySelector<HTMLElement>("#result-heading")?.focus({ preventScroll: true });
  }, [result]);

  function selectTab(next: Kind) {
    setKind(next);
    setError("");
    setFields({});
  }

  // ARIA tabs pattern: arrows, Home and End move between tabs; only the selected tab is in the Tab order.
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.kind === kind);
    const target = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = TABS[(target + TABS.length) % TABS.length].kind;
    selectTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  function fillExample() {
    setFields({});
    setError("");
    if (kind === "url") setUrl(EXAMPLES.url.url);
    else if (kind === "company_role") {
      setCompany(EXAMPLES.company_role.company);
      setRole(EXAMPLES.company_role.role);
    } else setMessage(EXAMPLES.message);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body =
      kind === "url"
        ? { kind, url }
        : kind === "company_role"
          ? { kind, company, role }
          : {
              kind,
              text: message.text,
              ...(message.senderEmail.trim() ? { senderEmail: message.senderEmail } : {}),
              ...(message.companyClaimed.trim() ? { companyClaimed: message.companyClaimed } : {}),
              channel: message.channel,
            };
    setRunning(true);
    setStep(0);
    setError("");
    setFields({});
    setResult(null);
    try {
      const data = await api<CheckResult>("POST", "/api/v1/checks", body);
      setResult({ data, message: kind === "message" ? { ...message } : null });
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("Something went wrong.", 0);
      setError(err.message);
      setFields(err.fields);
    } finally {
      setRunning(false);
    }
  }

  const field = (name: string) => (fields[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {});
  const fieldError = (name: string) =>
    fields[name] ? (
      <p id={`${name}-error`} className={`${ui.fieldError} mt-1.5`}>
        {fields[name]}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Scanner" className={`${ui.card} ${styles.scanner} p-5 sm:p-7`}>
        <div
          role="tablist"
          aria-label="What are you checking?"
          className={`${styles.tabs} grid grid-cols-3 gap-1 p-1`}
          onKeyDown={onTabKey}
        >
          {TABS.map((t) => (
            <button
              key={t.kind}
              id={`tab-${t.kind}`}
              type="button"
              role="tab"
              aria-selected={kind === t.kind}
              aria-controls="scan-panel"
              tabIndex={kind === t.kind ? 0 : -1}
              className={`${styles.tab} px-2 py-2.5 sm:px-4`}
              onClick={() => selectTab(t.kind)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form id="scan-panel" role="tabpanel" aria-labelledby={`tab-${kind}`} onSubmit={submit} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={ui.muted}>{TABS.find((t) => t.kind === kind)!.hint}</p>
            <button type="button" className={`${ui.ghost} px-2 py-1`} onClick={fillExample} id="scan-example">
              Try the demo example
            </button>
          </div>

          {kind === "url" && (
            <div>
              <label htmlFor="scan-url" className={ui.label}>
                Job posting URL
              </label>
              <input
                id="scan-url"
                className={`${ui.input} mt-2 w-full px-4 py-3`}
                type="url"
                inputMode="url"
                required
                placeholder="https://job-boards.greenhouse.io/company/jobs/123456"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                {...field("url")}
              />
              {fieldError("url")}
            </div>
          )}

          {kind === "company_role" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="scan-company" className={ui.label}>
                  Company
                </label>
                <input
                  id="scan-company"
                  className={`${ui.input} mt-2 w-full px-4 py-3`}
                  required
                  placeholder="Discord"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  {...field("company")}
                />
                {fieldError("company")}
              </div>
              <div>
                <label htmlFor="scan-role" className={ui.label}>
                  Role title
                </label>
                <input
                  id="scan-role"
                  className={`${ui.input} mt-2 w-full px-4 py-3`}
                  required
                  placeholder="Data Analyst"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  {...field("role")}
                />
                {fieldError("role")}
              </div>
            </div>
          )}

          {kind === "message" && (
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="scan-text" className={ui.label}>
                  Message text
                </label>
                <AutoGrowTextarea
                  id="scan-text"
                  className={`${ui.input} mt-2 w-full px-4 py-3`}
                  required
                  maxLength={20000}
                  placeholder="Paste the recruiter's message here."
                  value={message.text}
                  onChange={(e) => setMessage({ ...message, text: e.target.value })}
                  {...field("text")}
                  aria-describedby={fields.text ? "text-error scan-text-hint" : "scan-text-hint"}
                />
                <p id="scan-text-hint" className={`${ui.small} mt-1.5`}>
                  We analyze it in memory and never store the text.
                </p>
                {fieldError("text")}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="scan-sender" className={ui.label}>
                    Sender email <span className={ui.small}>(optional)</span>
                  </label>
                  <input
                    id="scan-sender"
                    className={`${ui.input} mt-2 w-full px-4 py-3`}
                    placeholder="talent@company.com"
                    value={message.senderEmail}
                    onChange={(e) => setMessage({ ...message, senderEmail: e.target.value })}
                    {...field("senderEmail")}
                  />
                  {fieldError("senderEmail")}
                </div>
                <div>
                  <label htmlFor="scan-claimed" className={ui.label}>
                    Company it claims <span className={ui.small}>(optional)</span>
                  </label>
                  <input
                    id="scan-claimed"
                    className={`${ui.input} mt-2 w-full px-4 py-3`}
                    placeholder="Acme Inc."
                    maxLength={100}
                    value={message.companyClaimed}
                    onChange={(e) => setMessage({ ...message, companyClaimed: e.target.value })}
                    {...field("companyClaimed")}
                  />
                  {fieldError("companyClaimed")}
                </div>
                <div>
                  <label htmlFor="scan-channel" className={ui.label}>
                    Arrived by
                  </label>
                  <select
                    id="scan-channel"
                    className={`${ui.input} mt-2 w-full px-4 py-3`}
                    value={message.channel}
                    onChange={(e) => setMessage({ ...message, channel: e.target.value })}
                  >
                    {Object.entries(CHANNEL_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button id="scan-submit" type="submit" className={`${ui.primary} px-7 py-3`} disabled={running}>
              {running ? "Checking…" : "Check it"}
            </button>
            <p className={ui.small}>Free, no account needed. Lookups run on our server with 5-second timeouts.</p>
          </div>
          <p className={ui.statusError} role="alert">
            {error}
          </p>
        </form>

        {/* Always mounted, so screen readers hear each step as its text changes. */}
        <p className="sr-only" aria-live="polite">
          {running ? `${STEPS[kind][step]}…` : ""}
        </p>
        {running && (
          <ol aria-label="Progress" className={`${styles.steps} mt-2 flex flex-col gap-2.5 pt-5`}>
            {STEPS[kind].map((label, i) => {
              const state = i < step ? "done" : i === step ? "active" : "waiting";
              return (
                <li key={label} className={`${styles.step} flex items-center gap-3`} data-state={state} aria-current={state === "active" ? "step" : undefined}>
                  <span aria-hidden className={`${styles.stepDot} inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center`}>
                    {state === "done" ? "✓" : ""}
                  </span>
                  {label}
                  <span className="sr-only">{{ done: " (done)", active: " (in progress)", waiting: "" }[state]}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div ref={resultRef} className={styles.resultAnchor}>
        {result && <ResultCard result={result.data} message={result.message} signedIn={signedIn} />}
      </div>
    </div>
  );
}
