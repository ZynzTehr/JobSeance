import { OUTCOME_LABEL, STAGE_LABEL, type OutcomeValue } from "@/lib/ui";
import type { CommunityAggregate } from "@/lib/reports";
import ui from "./ui.module.css";
import styles from "./community.module.css";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Community outcomes for a company. Counts only; a breakdown only with 3+ distinct reporters. */
export default function CommunitySummary({ community, compact = false }: { community: CommunityAggregate; compact?: boolean }) {
  if (!community.shown) {
    return (
      <div>
        <p className={styles.notRated}>Not rated</p>
        <p className={`${ui.small} mt-1`}>
          Fewer than 3 people have reported ({community.reports} {community.reports === 1 ? "report" : "reports"} so far).
        </p>
      </div>
    );
  }

  const outcomes = Object.entries(community.byOutcome ?? {}).sort((a, b) => b[1] - a[1]) as [OutcomeValue, number][];
  if (compact) {
    return (
      <div>
        <p className={styles.stat}>
          {community.reports} reports · {pct(community.ghostedShare ?? 0)} ghosted
        </p>
        <p className={`${ui.small} mt-1`}>
          Most common: {outcomes.slice(0, 2).map(([o, n]) => `${OUTCOME_LABEL[o]} (${n})`).join(", ")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className={styles.big}>{community.reports}</p>
          <p className={ui.small}>visible reports</p>
        </div>
        <div>
          <p className={styles.big}>{pct(community.ghostedShare ?? 0)}</p>
          <p className={ui.small}>heard nothing back 45+ days after applying or the last interview</p>
        </div>
        <div>
          <p className={styles.big}>{community.byStage?.INTERVIEWED ?? 0}</p>
          <p className={ui.small}>reached an interview</p>
        </div>
      </div>
      <div>
        <h3 className={ui.eyebrow}>Outcomes</h3>
        <ul className="mt-3 flex flex-col gap-2.5">
          {outcomes.map(([outcome, n]) => (
            <li key={outcome} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3">
              <span className={ui.muted}>{OUTCOME_LABEL[outcome]}</span>
              <span className={`${styles.track} h-2 overflow-hidden`} aria-hidden>
                <span className={`${styles.bar} block h-full`} style={{ width: `${(n / community.reports) * 100}%` }} />
              </span>
              <span className={styles.count}>{n}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className={ui.small}>
        Stages: {Object.entries(community.byStage ?? {}).map(([s, n]) => `${STAGE_LABEL[s as keyof typeof STAGE_LABEL]} ${n}`).join(" · ")}
      </p>
    </div>
  );
}
