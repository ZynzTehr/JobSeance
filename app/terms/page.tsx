import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import ui from "../components/ui.module.css";
import styles from "../components/legal.module.css";
import { CONTACT_HREF, EFFECTIVE_DATE, EFFECTIVE_DATE_ISO, MIN_AGE, PRIVACY_REASON_LABEL, REPORT_PROBLEM_HREF } from "@/lib/legal";
import { DISCLAIMER } from "@/lib/scoring/config";

export const metadata: Metadata = {
  title: "Terms · JobSeance",
  description:
    "The rules for using JobSeance: who can use it, what reports may contain, who owns them, how moderation works, and what the scores are and are not.",
};

const SECTIONS = {
  service: "About JobSeance",
  age: "Who can use it",
  reports: "Your reports",
  ownership: "You own what you post",
  moderation: "How we moderate",
  scores: "Scores are opinions, not guarantees",
  conduct: "Fair use of the site",
  problem: "Report a problem",
  ending: "Ending your account",
  changes: "Changes to these terms",
  contact: "Contact",
} as const;

type SectionId = keyof typeof SECTIONS;

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${styles.section} mt-10 scroll-mt-24 pt-8`}>
      <h2 id={id} className={ui.h2}>
        {SECTIONS[id]}
      </h2>
      <div className={`${styles.prose} mt-3 flex flex-col gap-4`}>{children}</div>
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className={`${styles.list} flex flex-col gap-2`}>{children}</ul>;
}

export default function TermsPage() {
  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-3xl px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>
          Terms of use · Effective <time dateTime={EFFECTIVE_DATE_ISO}>{EFFECTIVE_DATE}</time>
        </p>
        <h1 className={`${ui.title} mt-2`}>Terms of use</h1>
        <p className={`${ui.lede} mt-4 max-w-[64ch]`}>
          By using JobSeance you agree to these terms. They are written in plain language; please read them, especially
          the parts about reports and scores. Our{" "}
          <Link className={ui.link} href="/privacy">
            privacy notice
          </Link>{" "}
          explains what we do with your data.
        </p>

        <nav aria-labelledby="toc-heading" className="mt-8">
          <h2 id="toc-heading" className={ui.eyebrow}>
            On this page
          </h2>
          <ol className={`${styles.toc} mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2`}>
            {(Object.entries(SECTIONS) as [SectionId, string][]).map(([id, title]) => (
              <li key={id}>
                <a className={styles.tocLink} href={`#${id}`}>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="service">
          <p>
            JobSeance is a free tool, built as a student class project, that checks job postings and recruiter messages
            for ghost-job and scam warning signs. It shows the public facts behind every score, and lets people with an
            account share their own application outcomes and scam messages. It is not a law firm, a consumer agency or an
            employer, and it is not affiliated with the companies shown, the FTC or the FBI.
          </p>
        </Section>

        <Section id="age">
          <p>
            <strong>You must be {MIN_AGE} or older to use JobSeance</strong>, including to create an account or submit a
            report. If we learn that an
            account belongs to a child under 13, we delete it and its reports. You are responsible for what happens under
            your account, so keep your password private.
          </p>
        </Section>

        <Section id="reports">
          <p>When you report a job application or a scam message, you promise that:</p>
          <List>
            <li>it is your own first-hand experience, not something you heard about or made up;</li>
            <li>it is truthful and accurate to the best of your knowledge;</li>
            <li>
              it contains no names, email addresses, phone numbers or other contact details of individual people, such as a
              recruiter or hiring manager;
            </li>
            <li>it doesn&rsquo;t harass, threaten or impersonate anyone.</li>
          </List>
          <p>
            Report one experience once. Don&rsquo;t submit reports for someone else, or to inflate or deflate a
            company&rsquo;s numbers.
          </p>
        </Section>

        <Section id="ownership">
          <p>
            You keep ownership of everything you post. By posting it, you give JobSeance a non-exclusive, royalty-free
            license to store it, display it (individually to you, and as part of community totals to others), and use it to
            compute scores, for as long as it stays on JobSeance. The license ends when you delete the report or your
            account.
          </p>
          <p>
            Nothing in these terms limits your right to share an honest review or opinion of any business, including
            JobSeance, here or anywhere else, and we will never penalize you for doing so.
          </p>
        </Section>

        <Section id="moderation">
          <List>
            <li>
              We may hide or remove a report that appears to break these terms, for example after someone reports a problem
              with it.
            </li>
            <li>
              <strong>We never edit a report.</strong> We don&rsquo;t change its wording, rating or meaning; it either stays
              as you wrote it or is hidden or removed.
            </li>
            <li>
              <strong>Disagreement alone is not grounds for removal.</strong> A company disliking a report, or disputing an
              honest opinion, is not enough.
            </li>
            <li>We treat positive and negative reports the same way.</li>
          </List>
        </Section>

        <Section id="scores">
          <p>
            Scores are produced automatically from the signals listed on each result and explained on the{" "}
            <Link className={ui.link} href="/methodology">
              methodology page
            </Link>
            . They are our opinion about a posting or a message, based on the facts shown with them, not a statement of fact
            about any company or person. The standing disclaimer shown with every result says:
          </p>
          <blockquote className={`${styles.quote} pl-4`}>{DISCLAIMER}</blockquote>
          <p>
            <strong>A low score does not mean a job is safe.</strong> Always verify a job with the company directly before
            sharing personal or financial details. JobSeance is provided &ldquo;as is&rdquo;, without warranties of any kind,
            including accuracy, availability or fitness for a particular purpose. To the extent the law allows, JobSeance and
            the students who built it are not liable for decisions you make based on a score or a report.
          </p>
        </Section>

        <Section id="conduct">
          <p>Please don&rsquo;t:</p>
          <List>
            <li>try to get around rate limits, break into accounts, or disrupt the site;</li>
            <li>use the site or its API to harass anyone or to post someone else&rsquo;s personal information;</li>
            <li>submit automated or bulk reports, or create accounts to manipulate community totals.</li>
          </List>
          <p>We may suspend or delete accounts that do these things.</p>
        </Section>

        <Section id="problem">
          <p>
            Anyone can use{" "}
            <Link className={ui.link} href={REPORT_PROBLEM_HREF}>
              Report a problem
            </Link>
            , with or without an account, including companies. Pick what the problem is about and a reason: personal
            information, not first-hand or fake, harassment, a false statement of fact, a score that is factually wrong, a
            privacy or data request, or something else. Then describe it.
          </p>
          <List>
            <li>
              A signed-in user who reports personal information in a report hides that report right away until we review it.
              Reports from people who aren&rsquo;t signed in are reviewed without hiding anything first.
            </li>
            <li>
              Individual reports are never public, so to dispute a company&rsquo;s community panel, report a problem with the
              company itself.
            </li>
            <li>
              If you say a score is factually wrong, we re-check the facts behind it. We review each problem report and
              record the outcome.
            </li>
          </List>
        </Section>

        <Section id="ending">
          <p>
            You can delete your account at any time from your{" "}
            <Link className={ui.link} href="/dashboard">
              dashboard
            </Link>
            ; this deletes your reports too. Because JobSeance is a class project, it may change or shut down at any time.
          </p>
        </Section>

        <Section id="changes">
          <p>
            When we change these terms we update this page and the effective date at the top. Using JobSeance after a change
            means you accept the new terms.
          </p>
        </Section>

        <Section id="contact">
          <p>
            Questions about these terms? Use{" "}
            <Link className={ui.link} href={CONTACT_HREF}>
              Report a problem
            </Link>{" "}
            and choose &ldquo;Something else&rdquo;, or &ldquo;{PRIVACY_REASON_LABEL}&rdquo; for anything about your data. That is our contact address; we
            don&rsquo;t publish an email address.
          </p>
        </Section>
      </div>
    </main>
  );
}
