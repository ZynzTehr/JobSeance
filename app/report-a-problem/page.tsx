import type { Metadata } from "next";
import ui from "../components/ui.module.css";
import { parsePrefill } from "./options";
import ReportProblemForm from "./ReportProblemForm";
import { issueFormToken } from "@/lib/bot-guard";
import { getDb } from "@/lib/db";
import { FLAG_TARGETS } from "@/lib/schemas";
import { currentUser } from "@/lib/session-user";
import styles from "./report.module.css";

export const metadata: Metadata = {
  title: "Report a problem · JobSeance",
  description:
    "Flag a report, a check result or a company's community summary, send a privacy or data request, or get in touch with JobSeance.",
};

// Reads the session cookie to know whether to ask for an email.
export const dynamic = "force-dynamic";

const NEXT_STEPS = [
  "A person reviews every report by hand.",
  "Disagreeing with a report or a score isn't enough on its own to remove it. We act on personal information, reports that aren't first-hand, harassment and false statements of fact.",
  "We hide or remove reports. We never edit what someone wrote.",
  "If a score is factually wrong, we re-check that result and add a correction note.",
  "If you're signed in and flag personal information in an application or scam report, that report is hidden until we review it.",
];

export default async function ReportProblemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, query, companies] = await Promise.all([
    currentUser(),
    searchParams,
    getDb().company.findMany({ orderBy: [{ isFictional: "asc" }, { name: "asc" }], select: { slug: true, name: true } }),
  ]);
  const prefill = parsePrefill(query, FLAG_TARGETS);

  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-3xl px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Report a problem</p>
        <h1 className={`${ui.title} mt-2`}>Something wrong? Tell us.</h1>
        <p className={`${ui.lede} mt-4 max-w-[62ch]`}>
          Open to anyone, including companies named on JobSeance. Flag a report, a check result or a company&rsquo;s community
          summary, or get in touch about anything else.
        </p>
        <p className={`${ui.muted} mt-3 max-w-[62ch]`}>
          For privacy and data requests (a copy, a correction or deletion) and general contact, choose{" "}
          <strong>Something about the site</strong> below.
        </p>

        <section aria-labelledby="next-heading" className={`${ui.card} ${ui.rise} mt-10 p-6`}>
          <h2 id="next-heading" className={ui.h2}>
            What happens next
          </h2>
          <ul className={`${styles.points} mt-4 flex flex-col gap-3`}>
            {NEXT_STEPS.map((s) => (
              <li key={s} className={ui.body}>
                {s}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="form-heading" className={`${ui.card} ${ui.rise} mt-6 p-5 sm:p-7`} style={{ animationDelay: "80ms" }}>
          <h2 id="form-heading" className={`${ui.h2} mb-5`}>
            Your report
          </h2>
          <ReportProblemForm companies={companies} signedIn={user !== null} prefill={prefill} formToken={issueFormToken("flag")} />
        </section>
      </div>
    </main>
  );
}
