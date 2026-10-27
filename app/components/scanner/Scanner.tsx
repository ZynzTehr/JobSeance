"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { DEMO_POSTING_DISCORD } from "@/lib/demo-examples";
import { classifyHost } from "@/lib/lookups/job-url";
import { api, ApiCallError, CHANNEL_LABEL, type ChannelValue } from "@/lib/ui";
import AutoGrowTextarea from "../AutoGrowTextarea";
import ui from "../ui.module.css";
import ResultCard from "./ResultCard";
import styles from "./scanner.module.css";
import type { CheckResult, MessageInput, PostingInput } from "./types";

type Kind = "url" | "company_role" | "posting_text" | "message";

const TABS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "url", label: "Job link", hint: "A job link from Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee or amazon.jobs" },
  { kind: "company_role", label: "Company + role", hint: "Look a role up on the company's own board" },
  { kind: "posting_text", label: "Pasted posting", hint: "Copied from LinkedIn, Indeed or anywhere: Claude reads the company and role, we check the employer's own board" },
  { kind: "message", label: "Recruiter message", hint: "Paste an email or text you received" },
];

// Shown one by one while the server works. They describe real steps, but the
// result appears the moment the response lands; the animation never holds it back.
const STEPS: Record<Kind, string[]> = {
  url: ["Reading the link", "Finding the employer's job board", "Looking for this job ID", "Reading the posting text", "Scoring both risks"],
  company_role: [
    "Finding the company",
    "Opening its job board",
    "Matching the role title",
    "Searching job boards for a company we don't list (up to 30 s)",
    "Scoring both risks",
  ],
  posting_text: ["Masking contact details", "Reading the posting with Claude", "Finding the company", "Opening its job board", "Matching the role title", "Scoring both risks"],
  message: ["Reading the sender's domain", "Checking registration age and mail records", "Matching FTC and FBI warning signs", "Checking JobSeance reports", "Scoring scam risk"],
};

/** How long each step shows before the next one (ms). The AI step gets longer. */
const STEP_MS: Partial<Record<Kind, number[]>> = { posting_text: [500, 2600, 650, 650, 650, 650] };

const EXAMPLES = {
  url: { url: "https://job-boards.greenhouse.io/discord/jobs/8806482002" },
  company_role: { company: "bramblecloud", role: "Data Analyst" },
  posting_text: { text: DEMO_POSTING_DISCORD, sourceSite: "LinkedIn", company: "", role: "" },
  message: {
    senderEmail: "talent@bramblecloud-careers.example",
    companyClaimed: "Bramblecloud Software",
    channel: "EMAIL" as ChannelValue,
    headers: "",
    aiRead: false,
    text: "Hello from the Bramblecloud Software hiring team. Your interview will be held by chat on WhatsApp. We will mail you a check to buy equipment from our vendor. Deposit the check by mobile deposit and send the remaining balance to the vendor. Please respond within 24 hours.",
  },
};

const EMPTY_POSTING: PostingInput = { text: "", sourceSite: "", company: "", role: "" };

/** The site a pasted link came from (a label only; the link itself is never sent anywhere). */
function siteOf(url: string): { label: string; jobSite: boolean } | null {
  try {
    const host = new URL(url.trim()).hostname;
    const c = classifyHost(host);
    return c.kind === "job_site" || c.kind === "other_ats" || c.kind === "unknown" ? { label: c.name ?? "", jobSite: true } : null;
  } catch {
    return null;
  }
}

export default function Scanner({ signedIn }: { signedIn: boolean }) {
  const [kind, setKind] = useState<Kind>("url");
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [postingInput, setPostingInput] = useState<PostingInput>(EMPTY_POSTING);
  const [message, setMessage] = useState<MessageInput>({ text: "", senderEmail: "", companyClaimed: "", channel: "EMAIL", headers: "", aiRead: false });
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [pasteInstead, setPasteInstead] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ data: CheckResult; message: MessageInput | null } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const postingRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!running) return;
    const last = STEPS[kind].length - 1;
    if (step >= last) return;
    const timer = setTimeout(() => setStep((s) => Math.min(s + 1, last)), STEP_MS[kind]?.[step] ?? 650);
    return () => clearTimeout(timer);
  }, [running, kind, step]);

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
    setPasteInstead(null);
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
    } else if (kind === "posting_text") setPostingInput(EXAMPLES.posting_text);
    else setMessage(EXAMPLES.message);
  }

  /** From a job-site link error: switch to the posting tab, keep only the site's name. */
  function usePastedText() {
    const site = siteOf(url);
    setPostingInput({ ...EMPTY_POSTING, sourceSite: site?.label ?? "" });
    selectTab("posting_text");
    requestAnimationFrame(() => postingRef.current?.focus());
  }

  function bodyFor(k: Kind, posting: PostingInput, msg: MessageInput) {
    if (k === "url") return { kind: k, url };
    if (k === "company_role") return { kind: k, company, role };
    if (k === "posting_text") {
      return {
        kind: k,
        text: posting.text,
        ...(posting.sourceSite.trim() ? { sourceSite: posting.sourceSite.trim() } : {}),
        ...(posting.company.trim() && posting.role.trim() ? { company: posting.company.trim(), role: posting.role.trim() } : {}),
      };
    }
    return {
      kind: k,
      text: msg.text,
      ...(msg.senderEmail.trim() ? { senderEmail: msg.senderEmail } : {}),
      ...(msg.companyClaimed.trim() ? { companyClaimed: msg.companyClaimed } : {}),
      ...(msg.headers.trim() ? { headers: msg.headers } : {}),
      ...(msg.aiRead ? { aiRead: true } : {}),
      channel: msg.channel,
    };
  }

  async function run(k: Kind, posting: PostingInput, msg: MessageInput = message) {
    setRunning(true);
    setStep(0);
    setError("");
    setFields({});
    setPasteInstead(null);
    setResult(null);
    try {
      const data = await api<CheckResult>("POST", "/api/v1/checks", bodyFor(k, posting, msg));
      setResult({ data, message: k === "message" ? { ...msg } : null });
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("Something went wrong.", 0);
      setError(err.message);
      setFields(err.fields);
      const site = k === "url" && err.status === 422 ? siteOf(url) : null;
      if (site?.jobSite) setPasteInstead(site.label || "this site");
    } finally {
      setRunning(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(kind, postingInput);
  }

  /** Prefill the message fields from Claude's reading and check again (counted only now, as typed values). */
  function useMessageReading(suggested: { companyClaimed: string | null; senderEmail: string | null }) {
    const next = {
      ...message,
      companyClaimed: suggested.companyClaimed ?? message.companyClaimed,
      senderEmail: suggested.senderEmail ?? message.senderEmail,
    };
    setMessage(next);
    void run("message", postingInput, next);
  }

  /** "Yes, that's right": re-check with the company and title as confirmed values (the deterministic path). */
  function confirmReading(reading: { company: string; title: string }) {
    const next = { ...postingInput, company: reading.company, role: reading.title };
    setPostingInput(next);
    void run("posting_text", next);
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
          className={`${styles.tabs} grid grid-cols-2 gap-1 p-1 sm:grid-cols-4`}
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

          {kind === "posting_text" && (
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="scan-posting" className={ui.label}>
                  Posting text
                </label>
                <AutoGrowTextarea
                  ref={postingRef}
                  id="scan-posting"
                  className={`${ui.input} mt-2 w-full px-4 py-3`}
                  required
                  maxLength={20000}
                  placeholder="Paste the whole posting: title, company, location and description."
                  value={postingInput.text}
                  onChange={(e) => setPostingInput({ ...postingInput, text: e.target.value })}
                  {...field("text")}
                  aria-describedby={fields.text ? "text-error scan-posting-hint" : "scan-posting-hint"}
                />
                <p id="scan-posting-hint" className={`${ui.small} mt-1.5`}>
                  Sent to Anthropic&rsquo;s Claude with email addresses, phone and ID numbers and links masked (names are not
                  masked). We never store the text.
                </p>
                {fieldError("text")}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="scan-posting-company" className={ui.label}>
                    Company <span className={ui.small}>(optional)</span>
                  </label>
                  <input
                    id="scan-posting-company"
                    className={`${ui.input} mt-2 w-full px-4 py-3`}
                    maxLength={100}
                    placeholder="Claude reads it if blank"
                    value={postingInput.company}
                    onChange={(e) => setPostingInput({ ...postingInput, company: e.target.value })}
                    {...field("company")}
                  />
                  {fieldError("company")}
                </div>
                <div>
                  <label htmlFor="scan-posting-role" className={ui.label}>
                    Role title <span className={ui.small}>(optional)</span>
                  </label>
                  <input
                    id="scan-posting-role"
                    className={`${ui.input} mt-2 w-full px-4 py-3`}
                    maxLength={200}
                    placeholder="Fill both to skip the AI step"
                    value={postingInput.role}
                    onChange={(e) => setPostingInput({ ...postingInput, role: e.target.value })}
                    {...field("role")}
                  />
                  {fieldError("role")}
                </div>
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
                    className={`${ui.input} mt-2 w-full py-3 pl-4 pr-12`}
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
              <details className={styles.headersBox}>
                <summary className={`${ui.label} cursor-pointer`}>Paste the email&rsquo;s headers (optional)</summary>
                <p id="scan-headers-hint" className={`${ui.small} mt-2`}>
                  In Gmail: open the message, ⋮ → Show original, copy everything above the message body. We check whether the
                  sender&rsquo;s domain signed it and where replies would go. Read in memory, never stored.
                </p>
                <AutoGrowTextarea
                  id="scan-headers"
                  className={`${ui.input} mt-2 w-full px-4 py-3`}
                  maxLength={50000}
                  placeholder={"Delivered-To: …\nAuthentication-Results: mx.google.com; dkim=pass header.i=@acme.com; spf=pass …\nFrom: …"}
                  value={message.headers}
                  onChange={(e) => setMessage({ ...message, headers: e.target.value })}
                  {...field("headers")}
                  aria-describedby={fields.headers ? "headers-error scan-headers-hint" : "scan-headers-hint"}
                />
                {fieldError("headers")}
              </details>
              <label className={`${ui.body} flex items-start gap-3`}>
                <input
                  id="scan-ai-read"
                  type="checkbox"
                  className="mt-1"
                  checked={message.aiRead}
                  onChange={(e) => setMessage({ ...message, aiRead: e.target.checked })}
                />
                <span>
                  Let Claude read this message to suggest the sender and company.{" "}
                  <span className={ui.small}>
                    Sent to Anthropic with email addresses, phone and ID numbers and links masked (names are not masked). Nothing it
                    reads counts until you use it.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button id="scan-submit" type="submit" className={`${ui.primary} px-7 py-3`} disabled={running}>
              {running ? "Checking…" : "Check it"}
            </button>
            <p className={ui.small}>
              {kind === "posting_text" ? "Lookups run on our server; the Claude step can take a few seconds." : "Lookups run on our server with 5-second timeouts."}
            </p>
          </div>
          <p className={ui.statusError} role="alert">
            {error}
          </p>
          {pasteInstead && (
            <div className="-mt-3">
              <button type="button" id="scan-paste-instead" className={`${ui.secondary} px-5 py-2.5`} onClick={usePastedText}>
                Paste the posting text instead
              </button>
            </div>
          )}
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
        {result && (
          <ResultCard
            result={result.data}
            message={result.message}
            signedIn={signedIn}
            onConfirm={confirmReading}
            onUseMessageReading={useMessageReading}
            onUseMessageTab={() => selectTab("message")}
          />
        )}
      </div>
    </div>
  );
}
