import type { Metadata } from "next";
import Link from "next/link";
import CommunitySummary from "../components/CommunitySummary";
import ui from "../components/ui.module.css";
import { companyCards, noBoardWeRead, ownSiteLabel } from "@/lib/company-directory";
import { ATS_LABEL } from "@/lib/ui";
import styles from "./companies.module.css";

// Reads the database but no cookies: without this, Next prerenders the page and counts freeze until the next deploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Companies · JobSeance",
  description: "Companies JobSeance can look up: their official job boards, live open-role counts and community outcome summaries.",
};

export default async function CompaniesPage() {
  const cards = await companyCards();
  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Directory</p>
        <h1 className={`${ui.title} mt-2`}>Companies</h1>
        <p className={`${ui.lede} mt-4 max-w-[62ch]`}>
          Each company&rsquo;s official job board and how many roles are open on it right now, plus what JobSeance users
          reported about applying. We show facts and counts here, never a risk score for a company.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => (
            <li key={c.slug} className={`${ui.rise} flex`} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
              <Link href={`/companies/${c.slug}`} className={`${ui.cardLink} flex w-full flex-col gap-4 p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className={ui.h3}>{c.name}</h2>
                  {c.isFictional && <span className={`${styles.fictional} px-2.5 py-0.5`}>Fictional demo company</span>}
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className={ui.small}>Job board</dt>
                    <dd className={styles.fact}>{noBoardWeRead(c) ? ownSiteLabel(c.careersHosts) : ATS_LABEL[c.ats]}</dd>
                  </div>
                  <div>
                    <dt className={ui.small}>Open roles</dt>
                    <dd className={styles.fact}>
                      {noBoardWeRead(c) ? (
                        <span className={ui.muted}>Not counted</span>
                      ) : c.roles.count === null ? (
                        <span className={ui.muted}>Board didn&rsquo;t respond</span>
                      ) : (
                        c.roles.count
                      )}
                    </dd>
                  </div>
                </dl>
                <div className={`${ui.rule} mt-auto pt-4`}>
                  <p className={`${ui.small} mb-1.5`}>Community outcomes</p>
                  <CommunitySummary community={c.community} compact />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
