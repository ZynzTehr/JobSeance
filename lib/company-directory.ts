import type { Ats } from "@/app/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getCompanyPostings, type CompanyPostings } from "@/lib/lookups/postings";
import { aggregate, type AggregateRow, type CommunityAggregate } from "@/lib/reports";

// Data for /companies and /companies/[slug]. Facts and community counts only:
// never a ghost or scam band next to a company name.

export type OpenRoles = { count: number | null; fetchedAt: Date | null; stale: boolean; source: CompanyPostings["source"] | null };

/** A real company on its own careers site (Apple, Meta, Microsoft): no board we read, so its open roles can't be counted. */
export const ownSiteOnly = (c: { ats: Ats; isFictional: boolean }) => c.ats === "NONE" && !c.isFictional;

const BOARD_TIMEOUT_MS = 4000;

/** Live postings with a time limit, so one slow job board can't hold up the page. */
export async function postingsWithin(slug: string, ms = BOARD_TIMEOUT_MS): Promise<CompanyPostings | null | "unavailable"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"unavailable">((resolve) => (timer = setTimeout(() => resolve("unavailable"), ms)));
  try {
    return await Promise.race([getCompanyPostings(slug).catch(() => "unavailable" as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const openRoles = (p: CompanyPostings | null | "unavailable"): OpenRoles =>
  !p || p === "unavailable"
    ? { count: null, fetchedAt: null, stale: false, source: null }
    : {
        // Search systems list only the newest page, so use their own total (null when unknown).
        count: p.partial ? (p.total ?? null) : p.postings.filter((x) => x.state === "LIVE").length,
        fetchedAt: p.fetchedAt,
        stale: p.stale,
        source: p.source,
      };

export type CompanyCard = {
  slug: string;
  name: string;
  ats: Ats;
  atsBoard: string | null;
  isFictional: boolean;
  officialDomains: string[];
  roles: OpenRoles;
  community: CommunityAggregate;
};

export async function companyCards(now = new Date()): Promise<CompanyCard[]> {
  const db = getDb();
  const [companies, rows] = await Promise.all([
    db.company.findMany({ orderBy: [{ isFictional: "asc" }, { name: "asc" }] }),
    db.outcomeReport.findMany({
      where: { visibility: "VISIBLE" },
      select: { companyId: true, userId: true, outcome: true, stageReached: true, appliedAt: true, lastInterviewAt: true },
    }),
  ]);
  const byCompany = new Map<string, AggregateRow[]>();
  for (const { companyId, ...row } of rows) byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), row]);

  const postings = await Promise.all(companies.map((c) => postingsWithin(c.slug)));
  return companies.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    ats: c.ats,
    atsBoard: c.atsBoard,
    isFictional: c.isFictional,
    officialDomains: c.officialDomains,
    roles: openRoles(postings[i]),
    community: aggregate(byCompany.get(c.id) ?? [], now),
  }));
}

/** Public board URL for a company's ATS board token. */
export function boardUrl(ats: Ats, board: string | null, host: string | null = null): string | null {
  if (!board) return null;
  if (ats === "GREENHOUSE") return `https://job-boards.greenhouse.io/${board}`;
  if (ats === "LEVER") return `https://jobs.lever.co/${board}`;
  if (ats === "ASHBY") return `https://jobs.ashbyhq.com/${board}`;
  if (ats === "WORKDAY" && host) return `https://${host}/${board.split("/")[1] ?? ""}`;
  if (ats === "SMARTRECRUITERS") return `https://jobs.smartrecruiters.com/${board}`;
  if (ats === "WORKABLE") return `https://apply.workable.com/${board}`;
  if (ats === "RECRUITEE") return `https://${board}.recruitee.com`;
  if (ats === "AMAZON") return "https://www.amazon.jobs";
  return null;
}
