// JSON shape of POST /api/v1/checks (see runCheck in lib/checks/run.ts), as the browser receives it.
import type { BandValue } from "@/lib/ui";

export type SignalJson = {
  id: string;
  points: number;
  status: "found" | "couldnt_verify";
  fact: string;
  source: string;
  cite?: string;
  note?: string;
  /** "info": a 0-point fact gathered for context. */
  kind?: "info";
  sourceUrl?: string;
  checkedAt: string;
};

export type ScoreJson = { score: number | null; band: BandValue; signals: SignalJson[] };

/** What Claude read from a pasted posting. Shown in the result only; never stored. */
export type ReadingJson = {
  company: string | null;
  title: string | null;
  location: string | null;
  sourceSite: string | null;
  documentKind: "job_posting" | "recruiter_message" | "interview_task" | "other" | null;
  isStaffingAgency: boolean;
};

export type CheckResult = {
  id: string;
  kind: "url" | "company_role" | "message" | "posting_text";
  checkedAt: string;
  company: { slug: string; name: string; isFictional: boolean } | null;
  posting: { title: string; location: string | null; url: string; postedAt: string | null } | null;
  ghost: ScoreJson;
  scam: ScoreJson & { warnings: number };
  community?: { reports: number; shown: boolean; reason?: string; ghosted?: number; points?: number };
  gathered?: SignalJson[];
  reading?: ReadingJson | null;
  /** Opt-in Claude reading of a recruiter message: suggestions only, never stored. */
  messageReading?: { claimedCompany: string | null; contactAddress: string | null; channels: string[]; asks: string[] } | null;
  ai?: { used: boolean; model: string | null; mode: "live" | "replay" | null; suggestedKind: "message" | null } | null;
  meta: {
    configVersion: string;
    disclaimer: string;
    verificationChecklist: string[];
    whatToDo?: { label: string; url: string | null }[];
  };
};

export type MessageInput = { text: string; senderEmail: string; companyClaimed: string; channel: string; headers: string; aiRead: boolean };

export type PostingInput = { text: string; sourceSite: string; company: string; role: string };
