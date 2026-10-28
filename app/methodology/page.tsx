import type { Metadata } from "next";
import ui from "../components/ui.module.css";
import { AI_RULES, BAND_RANGES, GATHERED_SIGNALS, GHOST_SIGNALS, PHRASE_RULES_NOTE, SCAM_SIGNALS, type SignalInfo } from "@/lib/methodology";
import { CONFIG_VERSION, DISCLAIMER } from "@/lib/scoring/config";
import { BAND_LABEL } from "@/lib/ui";
import styles from "./methodology.module.css";

export const metadata: Metadata = {
  title: "Methodology · JobSeance",
  description: "Every ghost-job and scam signal JobSeance checks, its points, its source, and the known limits of the scores.",
};

const LIMITS = [
  "Weights are expert-set from public guidance and benchmarks, not validated against labeled outcomes. Treat a score as a prompt to verify, not a verdict.",
  "Some companies keep long-lived postings on purpose (Palantir's median Lever posting is about 475 days old), so age alone overstates ghost risk for them.",
  "Accounts are not verified, so one person can create several. Community signals are a weak input, need 3+ distinct users and are capped.",
  "We read Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee and amazon.jobs. A LinkedIn or Indeed listing can be checked by pasting its text, but only if the employer uses one of those systems and is in our directory.",
  "Workday's and amazon.jobs' job data is public but undocumented, so either can change or block us without notice; any failure shows \"couldn't verify\". On Workday, SmartRecruiters and amazon.jobs we search for the role rather than reading every job, so a role missing from the search is never counted as \"not found\".",
  "A board found for a company we don't list may belong to someone else: anyone can open a job board under a company's name. That's why such boards are shown, never counted, until an admin checks them.",
  "Claude can misread a company or title. That's why what it read is shown, and why a title that isn't an exact match counts only after you confirm it.",
  "A forged sender can look official. A matching domain is shown as a fact but never lowers the scam score.",
  "Phrase rules can miss reworded scams, and an anti-fraud notice worded in a way we don't recognize can still fire. Every match is quoted so you can judge it.",
  "We can't yet tell a reposted job from a new one. Since October 28, 2026 every listed company's board is refreshed daily and each job's removals and returns are recorded, so a repost signal can be tested before it counts.",
  "A failed lookup (timeout, unknown board, registry without RDAP) scores 0 and shows \"couldn't verify\". Missing data never counts against a posting.",
];

function SignalTable({ caption, signals }: { caption: string; signals: Record<string, SignalInfo> }) {
  return (
    <div className="overflow-x-auto">
      <table className={`${ui.table} w-full min-w-[40rem]`}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th className="py-3 pr-4">Signal</th>
            <th className="py-3 pr-4">Points</th>
            <th className="py-3 pr-4">Fires when</th>
            <th className="py-3">Source</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(signals).map(([id, s]) => (
            <tr key={id}>
              <td className="py-3.5 pr-4">
                <p className={styles.signalName}>{s.name}</p>
                <code className={styles.id}>{id}</code>
              </td>
              <td className={`${styles.points} py-3.5 pr-4`}>{s.points}</td>
              <td className={`${styles.when} py-3.5 pr-4`}>{s.when}</td>
              <td className={`${styles.when} py-3.5`}>
                {s.url ? (
                  <a className={ui.link} href={s.url} target="_blank" rel="noreferrer">
                    {s.source}
                  </a>
                ) : (
                  s.source
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Methodology · scoring version {CONFIG_VERSION}</p>
        <h1 className={`${ui.title} mt-2`}>How the scores work</h1>
        <p className={`${ui.lede} mt-4 max-w-[64ch]`}>
          Two separate scores from 0 to 100, each a sum of the signals below. Every result lists each signal it checked, the
          fact it found, the source and the time it was checked, so you can verify any of it yourself.
        </p>

        <section aria-labelledby="bands" className={`${ui.card} ${ui.rise} mt-10 p-6`}>
          <h2 id="bands" className={ui.h2}>
            Bands
          </h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {BAND_RANGES.map((b) => (
              <li key={b.band} className="flex items-center gap-2">
                <span className={`${ui[b.band]} px-3 py-1`}>{BAND_LABEL[b.band]}</span>
                <span className={ui.muted}>{b.range}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span className={`${ui.NOT_ENOUGH_DATA} px-3 py-1`}>{BAND_LABEL.NOT_ENOUGH_DATA}</span>
              <span className={ui.muted}>no board, no posting date and fewer than 3 reports</span>
            </li>
          </ul>
          <p className={`${ui.muted} mt-4`}>
            Bands describe a posting or a message, never a company. Company pages show facts and community counts only.
          </p>
        </section>

        <section aria-labelledby="ai" className={`${ui.card} mt-10 p-6`}>
          <h2 id="ai" className={ui.h2}>
            How AI helps, and what it never does
          </h2>
          <ul className={`${styles.limits} mt-4 flex flex-col gap-3`}>
            {AI_RULES.map((rule) => (
              <li key={rule} className={ui.body}>
                {rule}
              </li>
            ))}
          </ul>
          <h3 className={`${ui.h3} mt-6`}>Facts gathered (0 points)</h3>
          <dl className="mt-3 flex flex-col gap-3">
            {Object.entries(GATHERED_SIGNALS).map(([id, s]) => (
              <div key={id}>
                <dt className={ui.body}>
                  <strong>{s.name}</strong> <code className={ui.inlineCode}>{id}</code>
                </dt>
                <dd className={`${ui.muted} m-0`}>{s.when}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="ghost" className="mt-12">
          <h2 id="ghost" className={ui.h2}>
            Ghost-job risk
          </h2>
          <p className={`${ui.muted} mt-1 mb-4 max-w-[64ch]`}>
            Is the role really open? We look the job up on the employer&rsquo;s own board, read its age from the board&rsquo;s
            own date, scan the wording and add JobSeance users&rsquo; outcomes.
          </p>
          <SignalTable caption="Ghost-job signals" signals={GHOST_SIGNALS} />
          <div className={`${ui.card} mt-6 p-5`}>
            <h3 className={ui.h3}>Community points</h3>
            <p className={`${ui.body} mt-2`}>
              With <em>g</em> = weighted ghosted reports and <em>n</em> = weighted total, <em>r</em> = (<em>g</em> + 1) / (
              <em>n</em> + 2), and points = round(30 × clamp((<em>r</em> − 0.5) / 0.5, 0, 1)). The 0.5 baseline exists because
              45–75% of applications get no reply anyway.
            </p>
          </div>
        </section>

        <section aria-labelledby="scam" className="mt-12">
          <h2 id="scam" className={ui.h2}>
            Scam risk
          </h2>
          <p className={`${ui.muted} mt-1 mb-4 max-w-[64ch]`}>
            Is the recruiter real? A transparent rules engine: each rule has points and, where one exists, a government source.
            Capped at 100. We analyze pasted text in memory and never store it.
          </p>
          <SignalTable caption="Scam signals" signals={SCAM_SIGNALS} />
          <p className={`${ui.muted} mt-3 max-w-[64ch]`}>{PHRASE_RULES_NOTE}</p>
        </section>

        <section aria-labelledby="limits" className={`${ui.card} mt-12 p-6`}>
          <h2 id="limits" className={ui.h2}>
            Known limits
          </h2>
          <ul className={`${styles.limits} mt-4 flex flex-col gap-3`}>
            {LIMITS.map((l) => (
              <li key={l} className={ui.body}>
                {l}
              </li>
            ))}
          </ul>
        </section>

        <p className={`${ui.small} mt-10 max-w-[72ch]`}>{DISCLAIMER}</p>
      </div>
    </main>
  );
}
