"use client";

import Link from "next/link";
import { useState } from "react";
import { signalName } from "@/lib/methodology";
import { api, ApiCallError, BAND_LABEL, checkedAt, shortDate } from "@/lib/ui";
import ui from "../ui.module.css";
import styles from "./scanner.module.css";
import type { CheckResult, MessageInput, ScoreJson, SignalJson } from "./types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const warnings = (s: ScoreJson) => s.signals.filter((x) => x.points > 0).length;

/** One evidence row: status icon, the fact, its source and when it was checked. */
function SignalRow({ signal }: { signal: SignalJson }) {
  // Points can be negative (G-COMMUNITY's Offer/Hired penalty), which lowers the score rather than being neutral.
  const state =
    signal.status === "couldnt_verify"
      ? "unverified"
      : signal.points > 0
        ? "warning"
        : signal.points < 0
          ? "lowers"
          : signal.kind === "info"
            ? "info"
            : "clear";
  const label = {
    warning: "Warning sign found",
    lowers: "Lowers the risk",
    clear: "No warning sign",
    info: "For your information",
    unverified: "Couldn't verify",
  }[state];
  return (
    <li className={`${styles.signal} grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-4`} data-state={state}>
      <span className={`${styles.signalIcon} mt-0.5 flex h-6 w-6 items-center justify-center`} role="img" aria-label={label} title={label}>
        {{ warning: "!", lowers: "↓", clear: "✓", info: "i", unverified: "?" }[state]}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={styles.signalName}>{signalName(signal.id)}</span>
          <span className={`${styles.points} px-2 py-0.5`}>{signal.points > 0 ? `+${signal.points}` : signal.points < 0 ? `−${-signal.points}` : "0"}</span>
          {state === "unverified" && <span className={`${ui.badge} px-2 py-0.5`}>Not counted</span>}
        </div>
        <p className={`${styles.fact} mt-1`}>{signal.fact}</p>
        {signal.note && <p className={`${ui.small} mt-1`}>{signal.note}</p>}
        <p className={`${ui.small} ${styles.sourceLine} mt-1.5`}>
          Source: {signal.source}
          {signal.cite && (
            <>
              {" · "}
              <a className={ui.link} href={signal.cite} target="_blank" rel="noreferrer">
                Read the guidance
              </a>
            </>
          )}
          {signal.sourceUrl && (
            <>
              {" · "}
              <a className={ui.link} href={signal.sourceUrl} target="_blank" rel="noreferrer">
                Open the page
              </a>
            </>
          )}
          {" · "}Checked {checkedAt(signal.checkedAt)}
        </p>
      </div>
    </li>
  );
}

function BandPanel({ title, score, summary, delay }: { title: string; score: ScoreJson; summary: string; delay: number }) {
  return (
    <div className={`${styles.band} ${ui.rise} flex flex-col gap-3 p-5`} data-band={score.band} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={ui.h3}>{title}</h3>
        <span className={`${ui[score.band]} px-3 py-1`}>{BAND_LABEL[score.band]}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={styles.score}>{score.score ?? "—"}</span>
        {score.score !== null && <span className={ui.muted}>/ 100</span>}
      </div>
      <div className={`${styles.meter} h-1.5 w-full overflow-hidden`} aria-hidden>
        <div className={`${styles.meterFill} h-full`} style={{ width: `${score.score ?? 0}%` }} />
      </div>
      <p className={ui.muted}>{summary}</p>
    </div>
  );
}

type Props = {
  result: CheckResult;
  message: MessageInput | null;
  signedIn: boolean;
  /** Re-check a pasted posting with the company and title confirmed by the user. */
  onConfirm?: (reading: { company: string; title: string }) => void;
  onUseMessageTab?: () => void;
};

export default function ResultCard({ result, message, signedIn, onConfirm, onUseMessageTab }: Props) {
  const { ghost, scam, meta, community, posting } = result;
  const isMessage = result.kind === "message";
  const subject = isMessage ? "message" : "posting";
  const [saved, setSaved] = useState(false);
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState<"save" | "report" | null>(null);
  const [status, setStatus] = useState({ text: "", error: false });

  const ghostSummary = isMessage
    ? "Not checked: a pasted message has no job-board listing to look up."
    : ghost.band === "NOT_ENOUGH_DATA"
      ? "Not enough data: we couldn't confirm the board, the posting date or 3+ reports."
      : `This posting shows ${plural(warnings(ghost), "ghost-job sign")}.`;
  const scamSummary =
    scam.band === "NOT_ENOUGH_DATA" ? `Not enough data to judge this ${subject}.` : `This ${subject} shows ${plural(scam.warnings, "scam warning sign")}.`;

  async function save() {
    setBusy("save");
    try {
      await api("PATCH", `/api/v1/checks/${result.id}`, { saved: true });
      setSaved(true);
      setStatus({ text: "Saved to your dashboard.", error: false });
    } catch (e) {
      setStatus({ text: e instanceof ApiCallError ? e.message : "Couldn't save.", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function report() {
    if (!message) return;
    setBusy("report");
    try {
      await api("POST", "/api/v1/scam-reports", {
        senderEmail: message.senderEmail,
        channel: message.channel,
        text: message.text,
        ...(message.companyClaimed.trim() ? { companyClaimed: message.companyClaimed } : {}),
      });
      setReported(true);
      setStatus({ text: "Reported. Other people checking this sender will see one more report. We stored the domain and matched rules, not the text.", error: false });
    } catch (e) {
      setStatus({ text: e instanceof ApiCallError ? e.message : "Couldn't report.", error: true });
    } finally {
      setBusy(null);
    }
  }

  const logHref =
    result.company && !isMessage
      ? `/dashboard?company=${encodeURIComponent(result.company.slug)}${posting ? `&role=${encodeURIComponent(posting.title)}` : ""}#log-outcome`
      : null;

  return (
    // No entrance animation on the card itself: the evidence list must never start hidden.
    <article aria-labelledby="result-heading" className={`${ui.card} ${styles.result} flex flex-col gap-8 p-5 sm:p-8`}>
      <header className="flex flex-col gap-2">
        <p className={ui.eyebrow}>What we found</p>
        <h2 id="result-heading" tabIndex={-1} className={styles.resultTitle}>
          {isMessage ? "Pasted recruiter message" : (posting?.title ?? (result.kind === "posting_text" ? "Pasted posting" : "Company + role lookup"))}
        </h2>
        <p className={ui.muted}>
          {posting?.location && <>{posting.location} · </>}
          {posting?.postedAt && <>First published {shortDate(posting.postedAt)} · </>}
          Checked {checkedAt(result.checkedAt)}
          {posting?.url && (
            <>
              {" · "}
              <a className={ui.link} href={posting.url} target="_blank" rel="noreferrer">
                Open the listing
              </a>
            </>
          )}
        </p>
      </header>

      {result.reading && (result.reading.company || result.reading.title) && (
        <section aria-labelledby="reading-heading" className={`${styles.reading} flex flex-col gap-3 p-5`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="reading-heading" className={ui.h3}>
              What Claude read from your text
            </h3>
            <span className={`${ui.badge} px-2 py-0.5`}>AI-assisted</span>
          </div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {(
              [
                ["Company", result.reading.company],
                ["Role", result.reading.title],
                ["Location", result.reading.location],
              ] as const
            ).map(([term, value]) => (
              <div key={term}>
                <dt className={ui.small}>{term}</dt>
                <dd className={`${styles.readingValue} m-0`}>{value ?? "Not stated"}</dd>
              </div>
            ))}
          </dl>
          <p className={ui.small}>
            Claude only read these; the employer&rsquo;s board and our rules did the checking. A title that isn&rsquo;t an exact
            match on the board counts only after you confirm it.
          </p>
          {onConfirm && result.reading.company && result.reading.title && (
            <div>
              <button
                type="button"
                id="result-confirm"
                className={`${ui.secondary} px-5 py-2.5`}
                onClick={() => onConfirm({ company: result.reading!.company!, title: result.reading!.title! })}
              >
                That&rsquo;s right, check it with these
              </button>
            </div>
          )}
        </section>
      )}

      {result.ai?.suggestedKind === "message" && (
        <p className={ui.body}>
          This looks like a recruiter message.{" "}
          {onUseMessageTab ? (
            <button type="button" className={ui.link} onClick={onUseMessageTab}>
              Check it on the Recruiter message tab
            </button>
          ) : (
            "Check it on the Recruiter message tab"
          )}{" "}
          so the sender checks run too.
        </p>
      )}

      <section aria-label="Risk bands" className="grid gap-4 md:grid-cols-2">
        <BandPanel title="Ghost-job risk" score={ghost} summary={ghostSummary} delay={60} />
        <BandPanel title="Scam risk" score={scam} summary={scamSummary} delay={160} />
      </section>

      {meta.whatToDo && (
        <section aria-labelledby="what-to-do" className={`${styles.whatToDo} p-5 sm:p-6`}>
          <h3 id="what-to-do" className={ui.h3}>
            What to do
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {meta.whatToDo.map((item) => (
              <li key={item.label} className={ui.body}>
                {item.url ? (
                  <a className={ui.link} href={item.url} target="_blank" rel="noreferrer">
                    {item.label} ({new URL(item.url).hostname.replace(/^www\./, "")})
                  </a>
                ) : (
                  item.label
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="evidence-heading" className="flex flex-col gap-2">
        <h3 id="evidence-heading" className={ui.h2}>
          Evidence
        </h3>
        <p className={ui.muted}>Every signal we checked, including the ones that found nothing. Lookups that failed score 0.</p>
        {[
          { title: "Facts gathered", signals: result.gathered ?? [] },
          { title: "Ghost-job signals", signals: ghost.signals },
          { title: "Scam signals", signals: scam.signals },
        ]
          .filter((g) => g.signals.length > 0)
          .map((g) => (
            <div key={g.title} className="mt-4">
              <h4 className={ui.eyebrow}>{g.title}</h4>
              <ul className={`${styles.signals} mt-1`}>
                {g.signals.map((s, i) => (
                  <SignalRow key={`${s.id}-${i}`} signal={s} />
                ))}
              </ul>
            </div>
          ))}
      </section>

      {community && (
        <section aria-labelledby="community-heading" className={`${styles.community} p-5`}>
          <h3 id="community-heading" className={ui.h3}>
            From JobSeance users
          </h3>
          <p className={`${ui.small} mt-1`}>Users&rsquo; own experiences. Not verified by JobSeance.</p>
          <p className={`${ui.body} mt-3`}>
            {community.shown
              ? `${community.ghosted ?? 0} of ${plural(community.reports, "person")} who reported in the last 180 days heard nothing back 45+ days after applying or interviewing.`
              : `Not rated: ${community.reason ?? "fewer than 3 people have reported"} (${plural(community.reports, "report")}).`}
          </p>
          {result.company && (
            <Link className={`${ui.link} ${styles.communityLink} mt-3 inline-block`} href={`/companies/${result.company.slug}`}>
              See the community summary
            </Link>
          )}
        </section>
      )}

      <section aria-labelledby="next-steps" className="flex flex-col gap-3">
        <h3 id="next-steps" className={ui.h2}>
          Before you reply
        </h3>
        <ol className={`${styles.checklist} flex flex-col gap-2.5`}>
          {meta.verificationChecklist.map((item) => (
            <li key={item} className={ui.body}>
              {item}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Your next step" className={`${ui.rule} flex flex-col gap-3 pt-6`}>
        {signedIn ? (
          <div className="flex flex-wrap gap-3">
            <button id="result-save" type="button" className={`${ui.secondary} px-5 py-2.5`} onClick={save} disabled={busy !== null || saved}>
              {saved ? "Saved" : busy === "save" ? "Saving…" : "Save this check"}
            </button>
            {logHref && (
              <Link id="result-log" href={logHref} className={`${ui.secondary} px-5 py-2.5`}>
                Log my application
              </Link>
            )}
            {isMessage && message?.senderEmail.trim() && (
              <button id="result-report" type="button" className={`${ui.secondary} px-5 py-2.5`} onClick={report} disabled={busy !== null || reported}>
                {reported ? "Reported" : busy === "report" ? "Reporting…" : "Report this sender"}
              </button>
            )}
          </div>
        ) : (
          <p className={ui.muted}>
            <Link className={ui.link} href="/login">
              Log in
            </Link>{" "}
            or{" "}
            <Link className={ui.link} href="/signup">
              create an account
            </Link>{" "}
            to save this check or report your own experience.
          </p>
        )}
        <p className={status.error ? ui.statusError : ui.statusOk} role="status">
          {status.text}
        </p>
      </section>

      <footer className={`${styles.disclaimer} p-4`}>
        <p>{meta.disclaimer}</p>
        <p className="mt-2">
          Scoring version {meta.configVersion}.{" "}
          <Link className={ui.link} href="/methodology">
            How the scores work
          </Link>
        </p>
        <p className={`${ui.small} mt-2`}>
          <Link className={ui.link} href={`/report-a-problem?type=CHECK&id=${encodeURIComponent(result.id)}`}>
            Report a problem with this result
          </Link>
        </p>
      </footer>
    </article>
  );
}
