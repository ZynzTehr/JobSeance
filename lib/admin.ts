import type { NextRequest } from "next/server";
import { notFound, reader, writer } from "@/lib/api";
import type { PublicUser } from "@/lib/auth/session";
import { dailyCapMicros, resetPauseCache, utcDay } from "@/lib/ai/budget";
import { getDb } from "@/lib/db";
import { registrableDomain } from "@/lib/lookups/domains";
import { classifyHost } from "@/lib/lookups/job-url";

// Phase 12: the operator's tools. One role (ADMIN), granted only in the database.
// Non-admins get the same 404 as a missing page, so nothing hints that it exists.

export async function requireAdmin(request: NextRequest, mode: "read" | "write"): Promise<PublicUser> {
  const user = mode === "write" ? await writer(request) : await reader(request);
  if (user.role !== "ADMIN") throw notFound("That page");
  return user;
}

/**
 * Why a careers-host list is unsafe, or null. A careers host widens what Anthropic's search
 * and fetch tools may touch, so it must sit under one of the company's official domains and
 * can't be a job site or a hiring system we already read.
 */
export function careersHostProblem(hosts: string[], officialDomains: string[]): string | null {
  for (const host of hosts) {
    const kind = classifyHost(host).kind;
    if (kind === "job_site") return `${host} is a job site that lists other companies' jobs.`;
    if (kind === "ats" || kind === "other_ats") return `${host} is a hiring system; set it as the company's board instead.`;
    const root = registrableDomain(host);
    if (!root || !officialDomains.includes(root)) return `${host} isn't under one of the company's official domains (${officialDomains.join(", ")}).`;
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
    db.boardDiscovery.findMany({ where: { status: "FOUND", expiresAt: { gt: now } }, orderBy: { checkedAt: "desc" }, take: 50 }),
    db.company.findMany({ where: { atsBoard: { not: null } }, select: { ats: true, atsBoard: true } }),
  ]);
  const listed = new Set(companies.map((c) => `${c.ats}:${c.atsBoard!.toLowerCase()}`));
  return rows.filter((r) => r.ats && r.board && !listed.has(`${r.ats}:${r.board.toLowerCase()}`));
}

type FlagRow = { id: string; targetType: string; targetId: string; resolutionNote: string | null };
type FlagDb = Pick<Db, "flag" | "outcomeReport" | "scamReport">;

/**
 * Review a problem report. UPHELD removes a reported outcome or scam report; REJECTED makes
 * a report hidden for review visible again once no other open flag is holding it.
 */
export async function resolveFlag(db: FlagDb, flag: FlagRow, body: { status: "UNDER_REVIEW" | "UPHELD" | "REJECTED"; resolutionNote?: string }, now = new Date()) {
  const resolved = body.status === "UPHELD" || body.status === "REJECTED";
  const updated = await db.flag.update({
    where: { id: flag.id },
    data: { status: body.status, resolutionNote: body.resolutionNote ?? flag.resolutionNote, resolvedAt: resolved ? now : null },
    select: { id: true, status: true, resolutionNote: true, resolvedAt: true },
  });
  const target = { where: { id: flag.targetId } };
  const isReport = flag.targetType === "OUTCOME_REPORT" || flag.targetType === "SCAM_REPORT";
  const update = (args: { where: object; data: { visibility: "REMOVED" | "VISIBLE" } }) =>
    flag.targetType === "OUTCOME_REPORT" ? db.outcomeReport.updateMany(args) : db.scamReport.updateMany(args);
  if (isReport && body.status === "UPHELD") {
    await update({ ...target, data: { visibility: "REMOVED" } });
  } else if (isReport && body.status === "REJECTED") {
    const holding = await db.flag.count({ where: { targetType: flag.targetType as never, targetId: flag.targetId, status: { in: ["OPEN", "UNDER_REVIEW"] } } });
    if (holding === 0) await update({ where: { id: flag.targetId, visibility: "HIDDEN_PENDING_REVIEW" }, data: { visibility: "VISIBLE" } });
  }
  return updated;
}
