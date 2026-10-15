import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/auth/require-user";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/http";
import { BoardUnavailableError, getCompanyPostings } from "@/lib/lookups/postings";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** GET /api/v1/companies/:slug/postings: live board postings, cached 1 hour. Public. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/companies/[slug]/postings">) {
  const limit = rateLimit(`postings:ip:${clientIp(request.headers)}`, 60, 60);
  if (!limit.ok) return jsonError(tooManyRequests(limit.retryAfter));

  const { slug: raw } = await ctx.params;
  const slug = raw.toLowerCase();
  const notFound = () => jsonError({ status: 404, code: "company_not_found", message: "No company with that name." });
  if (!SLUG.test(slug)) return notFound();

  try {
    const result = await getCompanyPostings(slug);
    return result ? Response.json(result) : notFound();
  } catch (error) {
    if (error instanceof BoardUnavailableError) {
      return jsonError({ status: 502, code: "board_unavailable", message: "The job board didn't respond. Try again in a minute." });
    }
    throw error;
  }
}
