import type { NextRequest } from "next/server";
import { notFound, reader, writer } from "@/lib/api";
import type { PublicUser } from "@/lib/auth/session";
import { dailyCapMicros, resetPauseCache, utcDay } from "@/lib/ai/budget";
import { getDb } from "@/lib/db";
import { registrableDomain } from "@/lib/lookups/domains";
import { classifyHost } from "@/lib/lookups/job-url";
import { DISMISSED_DAYS } from "@/lib/lookups/discovery";

// Phase 12: the operator's tools. One role (ADMIN), granted only in the database.
// Non-admins get the same 404 as a missing page, so nothing hints that it exists.

export async function requireAdmin(request: NextRequest, mode: "read" | "write"): Promise<PublicUser> {
  let user: PublicUser;
  try {
    user = mode === "write" ? await writer(request) : await reader(request);
  } catch {
    throw notFound("That page"); // signed out, or a malformed request: the same 404 as everyone else
  }
  if (user.role !== "ADMIN") throw notFound("That page");
  return user;
}

/** Domains shared by many employers' hiring pages: never a company's own domain or careers site. */
const SHARED_HIRING_DOMAINS = new Set([
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "myworkdaysite.com",
  "workday.com",
  "smartrecruiters.com",
  "workable.com",
  "recruitee.com",
  "icims.com",
  "taleo.net",
  "jobvite.com",
  "bamboohr.com",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
]);

/** Why a list of official domains is unsafe, or null: a shared hiring domain would make every board on it look official. */
export function officialDomainProblem(domains: string[]): string | null {
  const shared = domains.find((d) => SHARED_HIRING_DOMAINS.has(registrableDomain(d) ?? d));
  return shared ? `${shared} is shared by many employers' job pages, so it can't be one company's official domain.` : null;
}

/**
 * Why a careers-host list is unsafe, or null. A careers host widens what Anthropic's search
 * and fetch tools may touch, so it must sit under one of the company's official domains and
 * can't be a job site or a hiring system we already read.
 */
export function careersHostProblem(hosts: string[], officialDomains: string[]): string | null {
  for (const host of hosts) {
    const kind = classifyHost(host).kind;
    const root = registrableDomain(host);
    if (kind === "job_site") return `${host} is a job site that lists other companies' jobs.`;
    if (kind === "ats" || kind === "other_ats" || (root && SHARED_HIRING_DOMAINS.has(root))) {
      return `${host} is a hiring system; set it as the company's board instead.`;
    }
    if (!root || !officialDomains.includes(root)) return `${host} isn't under one of the company's official domains (${officialDomains.join(", ")}).`;
    // A whole company domain (acme.com) would open every subdomain, including ones others can publish on.
    // Only a domain that exists for jobs (metacareers.com) may be used whole.
    if (host === root && !/career|jobs|hiring|talent|recruit/.test(root)) {
      return `Use the company's careers subdomain (like careers.${root}), not all of ${root}.`;
    }
  }
  return null;
}

type Db = ReturnType<typeof getDb>;

export async function aiSummary(db: Db = getDb(), now = new Date()) {
  const since = utcDay(new Date(now.getTime() - 6 * 86_400_000));
  const [days, pause] = await Promise.all([
    db.aiUsage.findMany({ where: { day: { gte: since } }, orderBy: { day: "desc" } }),
    db.setting.findUnique({ where: { key: "aiPaused" } }),
  ]);
  const today = days.find((d) => d.day === utcDay(now)) ?? null;
  return {
    paused: pause?.value === "1",
    capUsd: dailyCapMicros() / 1_000_000,
    today: today && strip(today),
    days: days.map(strip),
  };
}

/** A usage row without its bookkeeping timestamp. */
const strip = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "updatedAt"));

export async function setAiPaused(paused: boolean, db: Db = getDb()) {
  await db.setting.upsert({ where: { key: "aiPaused" }, update: { value: paused ? "1" : "0" }, create: { key: "aiPaused", value: paused ? "1" : "0" } });
  resetPauseCache(); // this instance at once; others within a minute
}

/** Found boards not yet in the directory, newest first. */
export async function pendingDiscoveries(db: Db = getDb(), now = new Date()) {
  const [rows, companies] = await Promise.all([
    // Read well past the 50 shown, so boards already in the directory can't hide pending ones.
    db.boardDiscovery.findMany({ where: { status: "FOUND", expiresAt: { gt: now } }, orderBy: { checkedAt: "desc" }, take: 500 }),
    db.company.findMany({ where: { atsBoard: { not: null } }, select: { ats: true, atsBoard: true } }),
  ]);
  const listed = new Set(companies.map((c) => `${c.ats}:${c.atsBoard!.toLowerCase()}`));
  return rows.filter((r) => r.ats && r.board && !listed.has(`${r.ats}:${r.board.toLowerCase()}`)).slice(0, 50);
}

/** An admin judged a found board not the employer's: no check shows it for 90 days. */
export async function dismissDiscovery(key: string, db: Pick<Db, "boardDiscovery"> = getDb(), now = new Date()) {
  const row = { employerName: "", status: "NOT_FOUND" as const, ats: null, board: null, host: null, declaredName: null, method: "dismissed", checkedAt: now, expiresAt: new Date(now.getTime() + DISMISSED_DAYS * 86_400_000) };
  await db.boardDiscovery.upsert({ where: { key }, update: row, create: { key, ...row } });
}

type FlagRow = { id: string; targetType: string; targetId: string; status?: string; resolutionNote: string | null };
type FlagTx = Pick<Db, "flag" | "outcomeReport" | "scamReport">;
type FlagDb = FlagTx & { $transaction<T>(fn: (tx: FlagTx) => Promise<T>): Promise<T> };
type Visibility = "VISIBLE" | "HIDDEN_PENDING_REVIEW" | "REMOVED";

/**
 * Review a problem report, in one transaction with the report it targets:
 * - UPHELD removes the reported outcome or scam report.
 * - REJECTED makes a report hidden for review visible again once no other open flag holds it.
 * - Moving a flag off UPHELD undoes its removal unless another upheld flag still stands.
 */
export async function resolveFlag(db: FlagDb, flag: FlagRow, body: { status: "UNDER_REVIEW" | "UPHELD" | "REJECTED"; resolutionNote?: string }, now = new Date()) {
  return db.$transaction(async (tx) => {
    const resolved = body.status === "UPHELD" || body.status === "REJECTED";
    const updated = await tx.flag.update({
      where: { id: flag.id },
      data: { status: body.status, resolutionNote: body.resolutionNote ?? flag.resolutionNote, resolvedAt: resolved ? now : null },
      select: { id: true, status: true, resolutionNote: true, resolvedAt: true },
    });
    if (flag.targetType !== "OUTCOME_REPORT" && flag.targetType !== "SCAM_REPORT") return updated;

    const set = (from: Visibility | null, to: Visibility) => {
      const args = { where: { id: flag.targetId, ...(from ? { visibility: from } : {}) }, data: { visibility: to } };
      return flag.targetType === "OUTCOME_REPORT" ? tx.outcomeReport.updateMany(args) : tx.scamReport.updateMany(args);
    };
    const others = (statuses: ("OPEN" | "UNDER_REVIEW" | "UPHELD")[]) =>
      tx.flag.count({ where: { targetType: flag.targetType as never, targetId: flag.targetId, id: { not: flag.id }, status: { in: statuses } } });

    if (body.status === "UPHELD") {
      await set(null, "REMOVED");
      return updated;
    }
    if (flag.status === "UPHELD" && (await others(["UPHELD"])) === 0) {
      // Undoing a removal: back to visible if this review rejects the flag, else hidden while it is reviewed again.
      await set("REMOVED", body.status === "REJECTED" ? "VISIBLE" : "HIDDEN_PENDING_REVIEW");
    }
    if (body.status === "REJECTED" && (await others(["OPEN", "UNDER_REVIEW"])) === 0) {
      await set("HIDDEN_PENDING_REVIEW", "VISIBLE");
    }
    return updated;
  });
}
