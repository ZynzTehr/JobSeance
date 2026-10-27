import type { NextRequest } from "next/server";
import { handle, HttpError, readBody, readQuery, writer } from "@/lib/api";
import { slugify } from "@/lib/checks/run";
import { getDb } from "@/lib/db";
import { boardExists } from "@/lib/lookups/boards";
import { companyCreate, companyQuery, conflictOn } from "@/lib/schemas";

export const dynamic = "force-dynamic";

// Never a ghost or scam band here: company endpoints show facts and community counts only.
const companySelect = {
  id: true,
  slug: true,
  name: true,
  ats: true,
  atsBoard: true,
  atsHost: true,
  officialDomains: true,
  isFictional: true,
} as const;

/** GET /api/v1/companies?q=&ats=: public list. */
export const GET = handle(async (request: NextRequest) => {
  const { q, ats } = readQuery(request, companyQuery);
  const companies = await getDb().company.findMany({
    where: { ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}), ...(ats ? { ats } : {}) },
    orderBy: { name: "asc" },
    take: 100,
    select: companySelect,
  });
  return Response.json({ companies });
});

/** POST /api/v1/companies: admin only. Verifies the board token before saving. */
export const POST = handle(async (request: NextRequest) => {
  const user = await writer(request);
  if (user.role !== "ADMIN") throw new HttpError({ status: 403, code: "forbidden", message: "Only admins can add companies." });
  const body = await readBody(request, companyCreate);
  const slug = body.slug ?? slugify(body.name);
  if (!slug) throw new HttpError({ status: 400, code: "validation_failed", message: "Pick a slug.", fields: { slug: "Required." } });

  if (body.ats !== "NONE") {
    const exists = await boardExists({ ats: body.ats, board: body.atsBoard!, ...(body.atsHost ? { host: body.atsHost } : {}) }).catch(() => {
      throw new HttpError({ status: 502, code: "board_unavailable", message: "The job board didn't respond. Try again in a minute." });
    });
    if (!exists) {
      const message = "That board doesn't exist on the job board.";
      throw new HttpError({ status: 422, code: "board_not_found", message, fields: { atsBoard: message } });
    }
  }

  const company = await getDb()
    .company.create({
      data: { name: body.name, slug, officialDomains: [...new Set(body.officialDomains)], ats: body.ats, atsBoard: body.atsBoard ?? null, atsHost: body.atsHost ?? null },
      select: companySelect,
    })
    .catch((e) => conflictOn(e, "slug", "A company with that slug already exists."));
  return Response.json({ company }, { status: 201 });
});
