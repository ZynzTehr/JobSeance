import { getDb } from "@/lib/db";

/** A user's saved checks, newest first, labeled with company and posting (Check stores plain ids). */
export async function savedChecks(userId: string) {
  const db = getDb();
  const checks = await db.check.findMany({
    where: { userId, saved: true },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      inputKind: true,
      ghostScore: true,
      ghostBand: true,
      scamScore: true,
      scamBand: true,
      senderDomain: true,
      signals: true,
      configVersion: true,
      saved: true,
      aiUsed: true,
      createdAt: true,
      companyId: true,
      postingId: true,
    },
  });
  const ids = (key: "companyId" | "postingId") => [...new Set(checks.map((c) => c[key]).filter((v): v is string => !!v))];
  const [companies, postings] = await Promise.all([
    db.company.findMany({ where: { id: { in: ids("companyId") } }, select: { id: true, slug: true, name: true } }),
    db.posting.findMany({ where: { id: { in: ids("postingId") } }, select: { id: true, title: true, url: true } }),
  ]);
  const company = new Map(companies.map(({ id, ...c }) => [id, c]));
  const posting = new Map(postings.map(({ id, ...p }) => [id, p]));
  return checks.map(({ companyId, postingId, ...c }) => ({
    ...c,
    company: (companyId && company.get(companyId)) || null,
    posting: (postingId && posting.get(postingId)) || null,
  }));
}

export type SavedCheck = Awaited<ReturnType<typeof savedChecks>>[number];
