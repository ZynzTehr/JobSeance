import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ui from "../components/ui.module.css";
import Applications from "./Applications";
import Greeting from "./Greeting";
import { DeleteAccount, SavedChecks, ScamReports } from "./Sections";
import SessionActions from "./SessionActions";
import { getDb } from "@/lib/db";
import { ownReportSelect, ownScamReportSelect } from "@/lib/report-shape";
import { savedChecks } from "@/lib/saved-checks";
import { currentUser } from "@/lib/session-user";
import styles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Dashboard · JobSeance",
  description: "Your saved checks, application outcomes, scam reports and account settings.",
};

const PROVIDER_LABEL = { GOOGLE: "Google", GITHUB: "GitHub" } as const;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const db = getDb();
  const [reports, scamReports, checks, companies, query] = await Promise.all([
    db.outcomeReport.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, select: ownReportSelect }),
    db.scamReport.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: ownScamReportSelect }),
    savedChecks(user.id),
    db.company.findMany({ orderBy: [{ isFictional: "asc" }, { name: "asc" }], select: { slug: true, name: true } }),
    searchParams,
  ]);

  const account: [string, string][] = [
    ["Username", user.username ?? "None (Google or GitHub only)"],
    ["Email", user.email],
    ["Linked sign-in", user.providers.length ? user.providers.map((p) => PROVIDER_LABEL[p]).join(", ") : "None"],
  ];

  const sections = [
    { id: "applications", title: "My applications", count: reports.length },
    { id: "saved", title: "Saved checks", count: checks.length },
    { id: "scam-reports", title: "My scam reports", count: scamReports.length },
  ];

  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <header>
            <p className={ui.eyebrow}>Dashboard</p>
            <h1 className={`${ui.title} mt-2`}><Greeting username={user.username} /></h1>
            <nav aria-label="Dashboard sections" className="mt-5 flex flex-wrap gap-2">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className={`${ui.badge} px-3 py-1.5`}>
                  {s.title} · {s.count}
                </a>
              ))}
            </nav>
          </header>

          <section id="applications" aria-labelledby="applications-heading" className={`${ui.card} ${ui.rise} scroll-mt-24 p-5 sm:p-7`}>
            <h2 id="applications-heading" className={ui.h2}>
              My applications
            </h2>
            <p className={`${ui.muted} mt-1 mb-5`}>Keep the status current: &ldquo;No response&rdquo; after 45 days is what marks a role as ghosted.</p>
            <Applications
              reports={reports}
              companies={companies}
              prefill={{ company: first(query.company), role: first(query.role) }}
            />
          </section>

          <section id="saved" aria-labelledby="saved-heading" className={`${ui.card} ${ui.rise} scroll-mt-24 p-5 sm:p-7`} style={{ animationDelay: "60ms" }}>
            <h2 id="saved-heading" className={`${ui.h2} mb-5`}>
              Saved checks
            </h2>
            <SavedChecks checks={checks} />
          </section>

          <section id="scam-reports" aria-labelledby="scam-heading" className={`${ui.card} ${ui.rise} scroll-mt-24 p-5 sm:p-7`} style={{ animationDelay: "120ms" }}>
            <h2 id="scam-heading" className={ui.h2}>
              My scam reports
            </h2>
            <p className={`${ui.muted} mt-1 mb-5`}>We store the sender&rsquo;s domain and the rules that matched, never the message.</p>
            <ScamReports reports={scamReports} />
          </section>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <section aria-labelledby="account-heading" className={`${ui.card} ${ui.rise} p-5`}>
            <h2 id="account-heading" className={ui.h3}>
              Account
            </h2>
            <dl className="mt-4 flex flex-col gap-3">
              {account.map(([label, value]) => (
                <div key={label}>
                  <dt className={styles.term}>{label}</dt>
                  <dd className={`${styles.value} m-0`}>{value}</dd>
                </div>
              ))}
            </dl>
            <SessionActions />
          </section>
          <section aria-labelledby="danger-heading" className={`${ui.card} ${ui.rise} p-5`} style={{ animationDelay: "80ms" }}>
            <h2 id="danger-heading" className={`${ui.h3} mb-3`}>
              Delete account
            </h2>
            <DeleteAccount />
          </section>
        </aside>
      </div>
    </main>
  );
}
