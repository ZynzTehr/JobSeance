import { ANTI_FRAUD_NOTICE, BANDS, EVERGREEN_PHRASES, GHOST, NO_VACANCY_PHRASES, type Phrase } from "@/lib/scoring/config";

// Pure scoring: no I/O. Callers gather the facts; these functions turn them
// into points, a band and an evidence list.

export type Band = "LOW" | "CAUTION" | "HIGH" | "NOT_ENOUGH_DATA";

export type Signal = {
  id: string;
  points: number;
  /** found = verified fact (risk or reassurance); couldnt_verify = lookup failed, never counted. */
  status: "found" | "couldnt_verify";
  fact: string;
  source: string;
  cite?: string;
  note?: string;
  /** "info": a 0-point fact gathered for context (for example by AI), shown with its own icon. */
  kind?: "info";
  /** A page that backs the fact, when one exists (https only, validated by the caller). */
  sourceUrl?: string;
  checkedAt: string;
};

export type Score = { score: number | null; band: Band; signals: Signal[] };

export const bandFor = (score: number): Band =>
  score >= BANDS.highFrom ? "HIGH" : score >= BANDS.cautionFrom ? "CAUTION" : "LOW";

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Labels of every phrase that matches, in list order. */
export function matchPhrases(text: string | null | undefined, phrases: Phrase[], skipWhenBefore?: RegExp): string[] {
  if (!text) return [];
  if (!skipWhenBefore) return phrases.filter((ph) => ph.re.test(text)).map((ph) => ph.label);
  // A phrase counts if any one of its matches isn't preceded, in the same sentence, by skipWhenBefore.
  return phrases
    .filter((ph) => {
      const re = new RegExp(ph.re.source, ph.re.flags.includes("g") ? ph.re.flags : ph.re.flags + "g");
      for (const m of text.matchAll(re)) {
        const before = text.slice(0, m.index);
        const sentence = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n")) + 1);
        if (!skipWhenBefore.test(sentence)) return true;
      }
      return false;
    })
    .map((ph) => ph.label);
}

export const quoteMatches = (labels: string[]) =>
  `Matched phrase${labels.length > 1 ? "s" : ""}: ${labels.map((l) => `'${l}'`).join(", ")}`;

const DAY = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ---- Board lookup outcome -----------------------------------------------------

export type BoardStatus =
  | { kind: "live"; boardName: string; source: string }
  | { kind: "not_found"; boardName: string; source: string; detail: string }
  | { kind: "couldnt_verify"; boardName: string; source: string; detail?: string }
  | { kind: "no_board"; companyName: string };

// ---- Community ----------------------------------------------------------------

export type CommunityReport = {
  userId: string;
  stage: "APPLIED" | "INTERVIEWED";
  outcome: string;
  appliedAt: Date;
  lastInterviewAt: Date | null;
  createdAt: Date;
};

export type CommunitySummary = {
  reports: number; // distinct reporters in the window
  shown: boolean;
  reason?: string;
  ghosted?: number;
  points?: number;
};

/** One report per user (latest), last 180 days, then the smoothed ghosted share. */
export function communityPoints(all: CommunityReport[], now: Date): CommunitySummary & { penalty: number } {
  const c = GHOST.community;
  const latest = new Map<string, CommunityReport>();
  for (const r of all) {
    if (daysBetween(r.createdAt, now) > c.windowDays) continue;
    const prev = latest.get(r.userId);
    if (!prev || r.createdAt > prev.createdAt) latest.set(r.userId, r);
  }
  const reports = [...latest.values()];
  const penalty = reports.some((r) => r.outcome === "HIRED" || r.outcome === "OFFER") ? c.hiredPenalty : 0;
  if (reports.length < c.minReporters) {
    return { reports: reports.length, shown: false, reason: `fewer than ${c.minReporters} reports`, penalty: 0 };
  }

  let g = 0;
  let n = 0;
  let ghosted = 0;
  for (const r of reports) {
    const w = r.stage === "INTERVIEWED" ? c.interviewWeight : 1;
    n += w;
    const since = r.lastInterviewAt ?? r.appliedAt;
    if (r.outcome === "NO_RESPONSE" && daysBetween(since, now) >= c.ghostedAfterDays) {
      g += w;
      ghosted += 1;
    }
  }
  const ratio = (g + 1) / (n + 2);
  const points = Math.round(c.max * clamp((ratio - 0.5) / 0.5, 0, 1));
  return { reports: reports.length, shown: true, ghosted, points, penalty };
}

// ---- Ghost score ----------------------------------------------------------------

export type GhostInput = {
  board: BoardStatus;
  postedAt: Date | null;
  description: string | null;
  /** Greenhouse posts with no internal_job_id are pipeline posts. Null when not Greenhouse. */
  greenhouseInternalJobId?: string | null;
  community: CommunityReport[];
  now: Date;
};

export function scoreGhost(input: GhostInput): Score & { community: CommunitySummary } {
  const { board, postedAt, description, now } = input;
  const at = now.toISOString();
  const signals: Signal[] = [];

  // G-BOARD
  if (board.kind === "live") {
    signals.push({ id: "G-BOARD", points: 0, status: "found", fact: `Live on ${board.boardName}`, source: board.source, checkedAt: at });
  } else if (board.kind === "not_found") {
    signals.push({ id: "G-BOARD", points: GHOST.notOnBoard, status: "found", fact: board.detail, source: board.source, checkedAt: at });
  } else if (board.kind === "couldnt_verify") {
    signals.push({
      id: "G-BOARD",
      points: 0,
      status: "couldnt_verify",
      fact: board.detail ?? `Couldn't reach ${board.boardName}`,
      source: board.source,
      checkedAt: at,
    });
  } else {
    signals.push({
      id: "G-BOARD",
      points: 0,
      status: "couldnt_verify",
      fact: `${board.companyName} has no public job board we can check`,
      source: "JobSeance company list",
      checkedAt: at,
    });
  }

  // G-AGE
  const source = board.kind === "no_board" ? "JobSeance posting record" : board.source;
  if (postedAt) {
    const days = Math.max(0, daysBetween(postedAt, now));
    const points = GHOST.age.find((a) => days <= a.maxDays)!.points;
    signals.push({ id: "G-AGE", points, status: "found", fact: `Listed ${days} days (first published ${isoDate(postedAt)})`, source, checkedAt: at });
  }

  // G-NO-VACANCY replaces G-EVERGREEN. "We never hold applications in a talent pool" is a notice, not pipeline wording.
  const noVacancy = matchPhrases(description, NO_VACANCY_PHRASES, ANTI_FRAUD_NOTICE);
  const evergreen = matchPhrases(description, EVERGREEN_PHRASES, ANTI_FRAUD_NOTICE);
  if (noVacancy.length) {
    signals.push({ id: "G-NO-VACANCY", points: GHOST.noVacancy, status: "found", fact: quoteMatches(noVacancy), source: "posting text", checkedAt: at });
  } else if (evergreen.length) {
    signals.push({ id: "G-EVERGREEN", points: GHOST.evergreen, status: "found", fact: quoteMatches(evergreen), source: "posting text", checkedAt: at });
  } else if (input.greenhouseInternalJobId === null && board.kind === "live") {
    signals.push({
      id: "G-EVERGREEN",
      points: GHOST.evergreen,
      status: "found",
      fact: "Greenhouse lists no internal job ID for this post (typical of pipeline posts)",
      source: board.source,
      checkedAt: at,
    });
  }

  // G-COMMUNITY
  const community = communityPoints(input.community, now);
  if (community.shown) {
    const pts = (community.points ?? 0) + community.penalty;
    const hired = community.penalty ? "; at least one reported an offer or hire (−20)" : "";
    signals.push({
      id: "G-COMMUNITY",
      points: pts,
      status: "found",
      fact: `${community.ghosted} of ${community.reports} reporters heard nothing for 45+ days${hired}`,
      source: "JobSeance user reports",
      checkedAt: at,
    });
  }

  const { penalty: _penalty, ...summary } = community;
  void _penalty;
  const boardUnknown = board.kind === "no_board" || board.kind === "couldnt_verify";
  if (boardUnknown && !postedAt && !community.shown) {
    return { score: null, band: "NOT_ENOUGH_DATA", signals, community: summary };
  }
  const score = clamp(signals.reduce((sum, s) => sum + s.points, 0), 0, 100);
  return { score, band: bandFor(score), signals, community: summary };
}
