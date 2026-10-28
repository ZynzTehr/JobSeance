import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CommunitySummary from "../../components/CommunitySummary";
import ui from "../../components/ui.module.css";
import { boardUrl, openRoles, ownSiteOnly, postingsWithin } from "@/lib/company-directory";
import { getDb } from "@/lib/db";
import { companyAggregate } from "@/lib/reports";
import { ATS_LABEL, checkedAt, shortDate } from "@/lib/ui";
import styles from "../companies.module.css";

// Reads the database but no cookies: render on every request so new reports show up without a redeploy.
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function load(slug: string) {
  if (!SLUG.test(slug)) return null;
  return getDb().company.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: PageProps<"/companies/[slug]">): Promise<Metadata> {
  const company = await load((await params).slug.toLowerCase());
  if (!company) return { title: "Company not found · JobSeance" };
  return {
    title: `${company.name} · JobSeance`,
    description: `${company.name}'s official job board, open roles and what JobSeance users reported about applying.`,
  };
}

export default async function CompanyPage({ params }: PageProps<"/companies/[slug]">) {
  const company = await load((await params).slug.toLowerCase());
  if (!company) notFound();

  const [postings, community] = await Promise.all([postingsWithin(company.slug, 6000), companyAggregate(company.id)]);
  const roles = openRoles(postings);
  const live = postings && postings !== "unavailable" ? postings.postings.filter((p) => p.state === "LIVE") : [];
  const board = boardUrl(company.ats, company.atsBoard, company.atsHost);

  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 pt-12 sm:px-8">
        <Link href="/companies" className={`${ui.ghost} inline-block px-3 py-1.5`}>
          ← All companies
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className={ui.title}>{company.name}</h1>
          {company.isFictional && <span className={`${styles.fictional} px-2.5 py-0.5`}>Fictional demo company</span>}
        </div>
        {company.isFictional && (
          <p className={`${ui.muted} mt-3 max-w-[62ch]`}>
            Invented for the class demo on the reserved <code className={ui.inlineCode}>.example</code> domain, so no real company is
            described with made-up data.
          </p>
        )}

        <section aria-label="Facts" className={`${ui.card} ${ui.rise} mt-8 grid gap-6 p-6 sm:grid-cols-3`}>
          <div>
            <p className={ui.small}>Job board</p>
            <p className={`${styles.fact} mt-1`}>
              {board ? (
                <a className={ui.link} href={board} target="_blank" rel="noreferrer">
                  {ATS_LABEL[company.ats]} · {company.atsBoard}
                </a>
              ) : ownSiteOnly(company) ? (
                `Own careers site: ${company.careersHosts.join(", ") || "not on file"}`
              ) : (
                ATS_LABEL[company.ats]
              )}
            </p>
          </div>
          <div>
            <p className={ui.small}>Open roles right now</p>
            <p className={`${styles.big} mt-1`}>{ownSiteOnly(company) ? "—" : (roles.count ?? "—")}</p>
            <p className={ui.small}>
              {ownSiteOnly(company)
                ? "Not counted: we don't read this company's careers site, only search it for a title."
                : roles.count === null
                ? "The job board didn't respond. Try again in a minute."
                : roles.fetchedAt
                  ? `${roles.stale ? "Last known, " : ""}checked ${checkedAt(roles.fetchedAt)}`
                  : "Stored with the demo data"}
            </p>
          </div>
          <div>
            <p className={ui.small}>Official domains</p>
            <p className={`${styles.fact} mt-1`}>{company.officialDomains.join(", ") || "—"}</p>
          </div>
        </section>

        <section aria-labelledby="community-heading" className={`${ui.card} ${ui.rise} mt-6 p-6`} style={{ animationDelay: "80ms" }}>
          <h2 id="community-heading" className={ui.h2}>
            What JobSeance users reported
          </h2>
          <p className={`${ui.small} mt-1 mb-6`}>
            Users&rsquo; own experiences, not verified by JobSeance. Shown only once 3 or more different people have reported.
            Individual reports are never public.
          </p>
          <CommunitySummary community={community} />
          <p className={`${ui.small} mt-6`}>
            <Link
              className={ui.link}
              href={`/report-a-problem?type=COMPANY&id=${encodeURIComponent(company.slug)}&label=${encodeURIComponent(company.name)}`}
            >
              Report a problem with this summary
            </Link>
          </p>
        </section>

        {live.length > 0 && (
          <section aria-labelledby="roles-heading" className="mt-10">
            <h2 id="roles-heading" className={ui.h2}>
              Open roles on the board
            </h2>
            <p className={`${ui.muted} mt-1`}>Check any of them for ghost-job and scam risk from the scanner.</p>
            <ul className={`${styles.roles} mt-4`}>
              {live.slice(0, 30).map((p) => (
                <li key={p.externalId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <a className={styles.roleLink} href={p.url} target="_blank" rel="noreferrer">
                    {p.title}
                  </a>
                  <span className={`${ui.small} shrink-0`}>
                    {[p.location, p.postedAt ? `since ${shortDate(p.postedAt)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            {live.length > 30 && <p className={`${ui.small} mt-3`}>And {live.length - 30} more on the board.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
