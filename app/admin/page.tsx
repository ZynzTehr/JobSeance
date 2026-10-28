import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ui from "../components/ui.module.css";
import styles from "./admin.module.css";
import { AddDiscovered, CompanyHosts, FlagReview, PauseSwitch } from "./AdminTools";
import { aiSummary, pendingDiscoveries } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { ATS_LABEL, checkedAt, shortDate } from "@/lib/ui";
import { currentUser } from "@/lib/session-user";

export const metadata: Metadata = { title: "Admin · JobSeance", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const usd = (micros: unknown) => `$${(Number(micros ?? 0) / 1_000_000).toFixed(4)}`;
const COUNTS = ["calls", "searches", "fetches", "refusals", "maxTokensStops", "errors"] as const;
const COUNT_LABEL: Record<(typeof COUNTS)[number], string> = {
  calls: "Calls",
  searches: "Searches",
  fetches: "Page reads",
  refusals: "Refusals",
  maxTokensStops: "Cut off",
  errors: "Errors",
};

export default async function AdminPage() {
  const user = await currentUser();
  // Same 404 as a missing page: nothing hints that /admin exists.
  if (!user || user.role !== "ADMIN") notFound();

  const db = getDb();
  const [ai, discoveries, companies, flags] = await Promise.all([
    aiSummary(db),
    pendingDiscoveries(db),
    db.company.findMany({ where: { isFictional: false }, orderBy: { name: "asc" }, select: { slug: true, name: true, ats: true, officialDomains: true, careersHosts: true } }),
    db.flag.findMany({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);

  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pb-20 pt-12 sm:px-8">
        <header>
          <p className={ui.eyebrow}>Admin</p>
          <h1 className={`${ui.title} mt-2`}>Operations</h1>
          <p className={`${ui.lede} mt-3 max-w-[64ch]`}>AI spend, boards found for companies we don&rsquo;t list, careers-site allowlists and open problem reports.</p>
        </header>

        <section aria-labelledby="ai-heading" className={`${ui.card} p-5 sm:p-7`}>
          <h2 id="ai-heading" className={ui.h2}>
            AI spend
          </h2>
          <p className={`${ui.muted} mt-1`}>
            Estimated from token counts and search fees. Daily cap {`$${ai.capUsd.toFixed(2)}`} (AI_DAILY_USD). The Anthropic console&rsquo;s spend limit
            is the outer guard. AI is <strong>{ai.paused ? "paused" : "on"}</strong>.
          </p>
          <div className="mt-4">
            <PauseSwitch paused={ai.paused} />
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className={`${ui.table} w-full min-w-[36rem]`}>
              <caption className="sr-only">AI usage, last 7 days</caption>
              <thead>
                <tr>
                  <th className="py-2 pr-4">Day (UTC)</th>
                  <th className="py-2 pr-4">Spend</th>
                  {COUNTS.map((k) => (
                    <th key={k} className="py-2 pr-4">
                      {COUNT_LABEL[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ai.days.length === 0 && (
                  <tr>
                    <td className="py-2" colSpan={COUNTS.length + 2}>
                      No AI calls in the last 7 days.
                    </td>
                  </tr>
                )}
                {ai.days.map((d) => (
                  <tr key={String(d.day)}>
                    <td className="py-2 pr-4">{String(d.day)}</td>
                    <td className="py-2 pr-4">{usd(d.spendMicros)}</td>
                    {COUNTS.map((k) => (
                      <td key={k} className="py-2 pr-4">
                        {String(d[k] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="discoveries-heading" className={`${ui.card} p-5 sm:p-7`}>
          <h2 id="discoveries-heading" className={ui.h2}>
            Boards found for companies we don&rsquo;t list
          </h2>
          <p className={`${ui.muted} mt-1`}>
            A board&rsquo;s own name matched the company searched for, but anyone can open a board under any name. Open the board,
            confirm it&rsquo;s the employer&rsquo;s (its jobs link back to the company&rsquo;s own site), and type the official domains yourself. If it isn&rsquo;t theirs, dismiss it: checks won&rsquo;t show it for 90 days.
          </p>
          {discoveries.length === 0 ? (
            <p className={`${ui.muted} mt-4`}>Nothing waiting.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-5">
              {discoveries.map((d) => (
                <li key={d.key} className={`${ui.card} p-4`}>
                  <p className={ui.body}>
                    <strong>{d.declaredName ?? d.employerName}</strong> · {ATS_LABEL[d.ats!]} board <code className={ui.inlineCode}>{d.board}</code>
                    {d.host ? (
                      <>
                        {" "}
                        on <code className={ui.inlineCode}>{d.host}</code>
                      </>
                    ) : null}
                  </p>
                  <p className={`${ui.small} mt-1`}>
                    Search key <code className={ui.inlineCode}>{d.key}</code> · found by {d.method} · {checkedAt(d.checkedAt)}
                  </p>
                  <AddDiscovered d={{ key: d.key, name: d.declaredName ?? d.employerName, ats: d.ats!, board: d.board!, host: d.host }} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="hosts-heading" className={`${ui.card} p-5 sm:p-7`}>
          <h2 id="hosts-heading" className={ui.h2}>
            Official domains and careers hosts
          </h2>
          <p className={`${ui.muted} mt-1`}>
            Careers hosts allow the presence check and page reading through Anthropic&rsquo;s tools. Each must sit under one of
            the company&rsquo;s official domains and be the company&rsquo;s own careers site, never a shared host.
          </p>
          <ul className="mt-4 flex flex-col gap-5">
            {companies.map((c) => (
              <li key={c.slug}>
                <p className={`${ui.body} mb-2`}>
                  <strong>{c.name}</strong> <span className={ui.small}>· {ATS_LABEL[c.ats]}</span>
                </p>
                <CompanyHosts c={c} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="flags-heading" className={`${ui.card} p-5 sm:p-7`}>
          <h2 id="flags-heading" className={ui.h2}>
            Open problem reports
          </h2>
          {flags.length === 0 ? (
            <p className={`${ui.muted} mt-4`}>No open reports.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-5">
              {flags.map((f) => (
                <li key={f.id} className={`${ui.card} p-4`}>
                  <p className={ui.body}>
                    <strong>{f.reason.replace(/_/g, " ")}</strong> · {f.targetType.toLowerCase().replace(/_/g, " ")}{" "}
                    <code className={ui.inlineCode}>{f.targetId}</code> · {f.status.toLowerCase().replace(/_/g, " ")}
                  </p>
                  <p className={`${ui.small} mt-1`}>
                    {shortDate(f.createdAt)}
                    {f.reporterEmail ? ` · reply to ${f.reporterEmail}` : f.reporterUserId ? " · from a signed-in user" : " · anonymous"}
                  </p>
                  <p className={`${ui.body} ${styles.details} mt-2`}>{f.details}</p>
                  <FlagReview id={f.id} current={f.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
