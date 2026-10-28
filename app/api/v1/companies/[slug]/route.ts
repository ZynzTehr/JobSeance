import type { NextRequest } from "next/server";
import { handle, HttpError, notFound, readBody } from "@/lib/api";
import { careersHostProblem, officialDomainProblem, requireAdmin } from "@/lib/admin";
import { companyUpdate } from "@/lib/schemas";
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

/** PATCH /api/v1/companies/:slug (admin): official domains and careers hosts only. */
export const PATCH = handle(async (request: NextRequest, ctx: RouteContext<"/api/v1/companies/[slug]">) => {
  await requireAdmin(request, "write");
  const slug = (await ctx.params).slug.toLowerCase();
  if (!SLUG.test(slug)) throw notFound("That company");
  const body = await readBody(request, companyUpdate);
  const db = getDb();
  const current = await db.company.findUnique({ where: { slug }, select: { officialDomains: true, careersHosts: true } });
  if (!current) throw notFound("That company");
  const officialDomains = body.officialDomains ? [...new Set(body.officialDomains)] : current.officialDomains;
  const careersHosts = body.careersHosts ? [...new Set(body.careersHosts)] : current.careersHosts;
  const domainProblem = officialDomainProblem(officialDomains);
  if (domainProblem) throw new HttpError({ status: 400, code: "validation_failed", message: domainProblem, fields: { officialDomains: domainProblem } });
  const problem = careersHostProblem(careersHosts, officialDomains);
  if (problem) throw new HttpError({ status: 400, code: "validation_failed", message: problem, fields: { careersHosts: problem } });
  const company = await db.company.update({
    where: { slug },
    data: { officialDomains, careersHosts },
    select: { slug: true, name: true, officialDomains: true, careersHosts: true },
  });
  return Response.json({ company });
});
