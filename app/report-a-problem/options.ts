// Plain constants and helpers for Report a problem. No React and no runtime import of lib/schemas
// (it would pull Zod into the browser bundle): only its types are used here.
import type * as schemas from "@/lib/schemas";

export type FlagTargetValue = (typeof schemas.FLAG_TARGETS)[number];
export type FlagReasonValue = (typeof schemas.FLAG_REASONS)[number];

/** The form's first question. Application and scam reports share one choice, then split. */
export type Subject = "COMPANY" | "CHECK" | "REPORT" | "SITE";
export type ReportType = "OUTCOME_REPORT" | "SCAM_REPORT";

export const SUBJECTS: { value: Subject; label: string; hint: string }[] = [
  { value: "COMPANY", label: "A company's community summary", hint: "What JobSeance users reported about a company." },
  { value: "CHECK", label: "A check result", hint: "A ghost-job or scam score from the scanner." },
  { value: "REPORT", label: "An application or scam report", hint: "One report someone submitted, by its ID." },
  { value: "SITE", label: "Something about the site", hint: "Privacy and data requests, or anything else." },
];

export const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "OUTCOME_REPORT", label: "An application report" },
  { value: "SCAM_REPORT", label: "A scam report" },
];

export const REASON_LABEL: Record<FlagReasonValue, string> = {
  personal_info: "It contains personal information",
  fake: "It's not first-hand or it's fake",
  harassment: "It's harassment",
  false_fact: "It states something false",
  score_wrong: "The score is factually wrong",
  privacy_request: "Privacy or data request",
  other: "Something else",
};

/** Only the reasons that make sense for each kind of target, in the order they're offered. */
export const REASONS_FOR: Record<Subject, readonly FlagReasonValue[]> = {
  COMPANY: ["false_fact", "fake", "harassment", "personal_info", "other"],
  CHECK: ["score_wrong", "false_fact", "other"],
  REPORT: ["personal_info", "fake", "harassment", "false_fact", "other"],
  SITE: ["privacy_request", "other"],
};

export const subjectOf = (type: FlagTargetValue): Subject =>
  type === "OUTCOME_REPORT" || type === "SCAM_REPORT" ? "REPORT" : type;

export type Prefill = { type: FlagTargetValue; id: string | null; label: string | null };
type Query = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const clean = (v: string | string[] | undefined, max: number) => {
  const s = first(v)?.trim();
  return s && s.length <= max ? s : null;
};

/**
 * Reads ?type=&id=&label= from a "Report a problem" link. An unknown type means no preselection;
 * an over-long id or label is dropped rather than cut (the API caps targetId at 100).
 */
export function parsePrefill(query: Query, targets: readonly FlagTargetValue[]): Prefill | null {
  const raw = first(query.type)?.trim().toUpperCase();
  const type = targets.find((t) => t === raw);
  if (!type) return null;
  return { type, id: type === "SITE" ? null : clean(query.id, 100), label: clean(query.label, 100) };
}

/** A prefilled link names its target exactly, so the form shows it as fixed text instead of fields. */
export const isFixedTarget = (p: Prefill | null): boolean => !!p && (p.type === "SITE" || !!p.id);
