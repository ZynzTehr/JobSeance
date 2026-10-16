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
  checkedAt: string;
};

export type ScoreJson = { score: number | null; band: BandValue; signals: SignalJson[] };

export type CheckResult = {
  id: string;
  kind: "url" | "company_role" | "message";
  checkedAt: string;
  company: { slug: string; name: string; isFictional: boolean } | null;
  posting: { title: string; location: string | null; url: string; postedAt: string | null } | null;
  ghost: ScoreJson;
  scam: ScoreJson & { warnings: number };
  community?: { reports: number; shown: boolean; reason?: string; ghosted?: number; points?: number };
  meta: {
    configVersion: string;
    disclaimer: string;
    verificationChecklist: string[];
    whatToDo?: { label: string; url: string | null }[];
  };
};

export type MessageInput = { text: string; senderEmail: string; companyClaimed: string; channel: string };
