import type { NextRequest } from "next/server";
import { handle, notFound } from "@/lib/api";
import { getDb } from "@/lib/db";
import { companyAggregate } from "@/lib/reports";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** GET /api/v1/companies/:slug: company, board info and community summary. Never a ghost or scam band. */
export const GET = handle(async (_request: NextRequest, ctx: RouteContext<"/api/v1/companies/[slug]">) => {
  const slug = (await ctx.params).slug.toLowerCase();
  if (!SLUG.test(slug)) throw notFound("That company");
  const company = await getDb().company.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, ats: true, atsBoard: true, officialDomains: true, isFictional: true },
  });
  if (!company) throw notFound("That company");
  return Response.json({ company, community: await companyAggregate(company.id) });
});
