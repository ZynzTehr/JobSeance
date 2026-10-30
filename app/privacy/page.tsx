import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import ui from "../components/ui.module.css";
import styles from "../components/legal.module.css";
import {
  CONTACT_HREF,
  EFFECTIVE_DATE,
  EFFECTIVE_DATE_ISO,
  MIN_AGE,
  OAUTH_COOKIE_MINUTES,
  OUTBOUND_USER_AGENT,
  POSTINGS_REFRESH_HOURS,
  PRIVACY_REASON_LABEL,
  PROCESSORS,
  RETENTION_DAYS,
  SEARCH_MEMORY_HOURS,
  SESSION_HOURS,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy · JobSeance",
  description:
    "What JobSeance collects, who else receives it, how long it is kept, and how to see, change or delete it. No analytics, no ads, no selling of data.",
};

const SECTIONS = {
  collect: "What we collect",
  use: "How we use it",
  public: "What other people can see",
  processors: "Who else receives data",
  retention: "How long we keep it",
  control: "See, change or delete your data",
  legal: "Requests from law enforcement and courts",
  children: "Age limits and children",
  dnt: "Do Not Track and cross-site tracking",
  security: "Security",
  changes: "Changes to this notice",
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

function Sub({ children }: { children: ReactNode }) {
  return <h3 className={`${ui.h3} mt-2`}>{children}</h3>;
}

export default function PrivacyPage() {
  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-3xl px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>
          Privacy notice · Effective <time dateTime={EFFECTIVE_DATE_ISO}>{EFFECTIVE_DATE}</time>
        </p>
        <h1 className={`${ui.title} mt-2`}>Your data on JobSeance</h1>
        <p className={`${ui.lede} mt-4 max-w-[64ch]`}>
          JobSeance checks job postings and recruiter messages for ghost-job and scam warning signs. It is a student class
          project. This notice explains what we collect, why, who else receives it, how long we keep it, and how you can
          delete it.
        </p>

        <section aria-labelledby="short" className={`${ui.card} ${ui.rise} mt-8 p-6`}>
          <h2 id="short" className={ui.h3}>
            The short version
          </h2>
          <ul className={`${styles.list} ${styles.prose} mt-3 flex flex-col gap-2`}>
            <li>
              Every check needs an account, so we can moderate and monitor use. Pasted messages and postings are analyzed in
              memory and not stored, unless you choose to share a redacted excerpt with a scam report. A pasted posting is
              sent, masked, to Anthropic&rsquo;s Claude to read the company and role; a recruiter message is sent only if you
              tick &ldquo;Let Claude read this message&rdquo;. For a company we don&rsquo;t list, its name and the role title may be searched
              on public job-board and hiring-system sites through Anthropic. Email headers you paste are read in memory and never sent or stored.
            </li>
            <li>No analytics, no ads, no tracking cookies and no third-party scripts. We never sell or rent your data.</li>
            <li>Your individual reports are never shown publicly. Other people see only totals.</li>
            <li>If you have an account, you can see, change and delete your data from your dashboard, including the whole account.</li>
          </ul>
        </section>

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

        <Section id="collect">
          <p>We only collect what a feature needs. Here is everything, by what you are doing.</p>

          <Sub>Every visit</Sub>
          <List>
            <li>
              <strong>Your IP address and request details.</strong> Our host, Vercel, records each request (IP address, time,
              path and browser user agent) in its request logs.
            </li>
            <li>
              <strong>Rate limiting.</strong> To stop abuse, our server counts checks, report and flag submissions per
              account, other requests per IP address, login attempts also per username typed, and current-password checks
              when you change your account details per account. These counters live only in the server&rsquo;s memory, are dropped within about a minute of
              their window ending (no window is longer than an hour), and are never written to our database.
            </li>
            <li>
              Our own code never logs request bodies, passwords, cookies or message text.
            </li>
          </List>

          <Sub>When you run a check</Sub>
          <p>
            You send a job link, a company and role, or a pasted message (optionally with the sender&rsquo;s address, the
            company it claims to be from, and where you got it). <strong>A pasted message is analyzed in memory and never
            stored.</strong> We keep only what we derived from it:
          </p>
          <List>
            <li>the kind of check, the time, the scoring version, and the two scores;</li>
            <li>the job-board posting and company it matched, if any;</li>
            <li>the sender&rsquo;s domain (for example, example.com), never the full email address;</li>
            <li>
              the facts listed on the result, such as &ldquo;registered 12 days ago&rdquo; or which phrases from our own
              warning list matched. A company-and-role check that finds no matching posting also keeps the role title you
              typed in that fact;
            </li>
            <li>your account ID (every check needs one).</li>
          </List>

          <Sub>When you check a pasted posting</Sub>
          <p>
            If you leave the company and role blank, our server masks email addresses, phone numbers, SSN-like and other long
            numbers, and links in the text, then sends it to Anthropic&rsquo;s Claude API, which reads the company name, role
            title and location. Names in the text are not masked, so paste the posting only. What Claude read is shown on the
            result and is not stored. We keep the same derived facts as for any check, plus whether an AI step ran, and a daily
            count of AI calls for your account (numbers only) so we can enforce a daily limit.
          </p>

          <Sub>When we look for a company&rsquo;s job board or careers page</Sub>
          <p>
            If you check a company we don&rsquo;t list, we first ask the public job boards whether a board with that name exists.
            If none does, Anthropic&rsquo;s Claude may suggest where the company posts jobs, and Anthropic&rsquo;s web search may
            look for it on public job-board and hiring-system sites. Only the company name and the role title are sent; never your account, your
            IP address or anything you pasted. What we find is kept for {RETENTION_DAYS.discoveryFound} days ({" "}
            {RETENTION_DAYS.discoveryNotFound} days if a search found nothing, half a day if only our quick board check ran) so
            the next person&rsquo;s check doesn&rsquo;t search again. It holds a short key made from the company name and, when
            a board was found, that board&rsquo;s own name and public identifier; never the text you typed. For a company we list
            whose careers site we allowlisted, Anthropic&rsquo;s web search may look for the role title on that site, and a job
            link you paste on that site is sent without tracking parameters (a job id in the link is kept) so Anthropic&rsquo;s
            fetch tool can read the page. The answers to these searches (result titles, links and dates for a company and role
            title) stay in our server&rsquo;s memory for up to {SEARCH_MEMORY_HOURS} hours so a repeat check doesn&rsquo;t search
            again; they&rsquo;re never written to our database. Our own server never opens a link you paste, with one exception: for a Workday job link,
            we ask that Workday site for the job at the same address, to tell a removed job from a search miss.
          </p>

          <Sub>When you paste email headers or let Claude read a message</Sub>
          <p>
            Email headers you paste on the Recruiter message tab are read in memory on our server to check the sender&rsquo;s
            authentication results and where replies would go. They are never stored, logged or sent to an AI service. We
            look up only the sender&rsquo;s domain in DNS. If you tick &ldquo;Let Claude read this message&rdquo;, the message
            is masked as described above and sent to Anthropic&rsquo;s Claude, which suggests the company it claims and the
            address to check. Those suggestions are shown on the result, never stored, and never change the score unless you
            use them to check again.
          </p>

          <Sub>When you create an account</Sub>
          <List>
            <li>
              <strong>With a username and password:</strong> your username, email address, and a bcrypt hash of your
              password. We never store the password itself.
            </li>
            <li>
              <strong>With Google or GitHub:</strong> your account ID at that provider, your email address, whether it is
              verified, your name (or GitHub username), and when you linked and last used it. We do not store the
              provider&rsquo;s access tokens.
            </li>
            <li>For every account: when it was created and updated, and an internal number used to sign you out everywhere.</li>
          </List>
          <p>We don&rsquo;t send email, so your address is used only to identify your account.</p>

          <Sub>When you report a job application</Sub>
          <p>
            The company, role title, the posting if known, the date you applied, the dates of your last interview and last
            contact, the stage you reached, the outcome, and an optional note of up to 1,000 characters. Notes that contain
            an email address or phone number are refused.
          </p>

          <Sub>When you report a scam message</Sub>
          <p>
            The sender&rsquo;s domain, where you got the message, the company it claimed to be from, which of our rules
            matched, and the score. The message itself is not stored unless you tick the box to share an excerpt. If you do,
            our server first redacts it: email addresses become <code className={ui.inlineCode}>[email]@domain</code>,
            phone numbers <code className={ui.inlineCode}>[phone]</code>, SSN-like numbers{" "}
            <code className={ui.inlineCode}>[ssn]</code>, and any run of 6 or more digits{" "}
            <code className={ui.inlineCode}>[number]</code>, and it keeps at most 500 characters. Automated redaction can
            miss things, so excerpts are never shown publicly.
          </p>

          <Sub>When you use Report a problem</Sub>
          <p>
            What the report is about, the reason, and the details you write. If you are signed in we link it to your
            account; if not, we keep the email address you give, only if you choose to give one, so we can reply. We also
            record its status, our resolution note and the dates.
          </p>

          <Sub>Cookies</Sub>
          <p>We use these cookies only for signing in. None of them tracks you.</p>
          <dl className={`${ui.card} flex flex-col p-5`}>
            <div className={`${styles.row} flex flex-col gap-1 pb-4`}>
              <dt className={styles.cookie}>jobseance_session</dt>
              <dd className={styles.definition}>
                Keeps you signed in for {SESSION_HOURS} hours. It holds a signed token with your account ID, a version number
                and an expiry time, and scripts on the page cannot read it.
              </dd>
            </div>
            <div className={`${styles.row} flex flex-col gap-1 pt-4`}>
              <dt className={styles.cookie}>jobseance_oauth</dt>
              <dd className={styles.definition}>
                Set only while you sign in with Google or GitHub, for {OAUTH_COOKIE_MINUTES} minutes. It holds a one-time
                security code that protects the sign-in. A companion cookie, <code className={ui.inlineCode}>jobseance_oauth.sig</code>,
                holds its signature and lives just as long.
              </dd>
            </div>
          </dl>
        </Section>

        <Section id="use">
          <p>We use the data above only to:</p>
          <List>
            <li>run checks and show you the facts behind each score;</li>
            <li>show your saved checks and reports on your dashboard;</li>
            <li>count reports into the community totals described below;</li>
            <li>limit abuse, keep the site secure, and handle problem reports.</li>
          </List>
          <p>
            We don&rsquo;t sell, rent or trade your data, we don&rsquo;t use it for advertising, and we don&rsquo;t build
            profiles of you.
          </p>
        </Section>

        <Section id="public">
          <p>
            Other visitors never see your individual reports, your username, your notes or your dates. They see only
            totals:
          </p>
          <List>
            <li>
              a company&rsquo;s community panel: how many reports it has, and, only once at least 3 different people have
              reported, what happened to them;
            </li>
            <li>the number of JobSeance users who reported messages from a sender&rsquo;s domain.</li>
          </List>
          <p>
            Your own reports, saved checks and excerpts are visible only to you when signed in, and to the people who run
            JobSeance, for example when reviewing a problem report.
          </p>
        </Section>

        <Section id="processors">
          <p>
            These are the outside services involved in running JobSeance, and exactly what each one receives. Job-board,
            registry and DNS requests come from our server with the user agent{" "}
            <code className={ui.inlineCode}>{OUTBOUND_USER_AGENT}</code>, so those services see our server, not your IP
            address or browser.
          </p>
          <dl className={`${ui.card} flex flex-col px-5`}>
            {PROCESSORS.map((p) => (
              <div key={p.name} className={`${styles.row} grid gap-2 py-5 sm:grid-cols-[11rem_1fr] sm:gap-6`}>
                <dt className="flex flex-col gap-1">
                  <span className={styles.term}>{p.name}</span>
                  <span className={styles.termNote}>{p.when}</span>
                </dt>
                <dd className="flex flex-col gap-1">
                  <span className={styles.termNote}>{p.role}</span>
                  <span className={styles.definition}>{p.receives}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Fonts are served from our own site, and no other service receives data from your browser. If you open a job
            posting from a result, you go to that job board&rsquo;s own site and its privacy policy applies there.
          </p>
        </Section>

        <Section id="retention">
          <p>A cleanup job runs once a day, so data can last up to a day past these limits.</p>
          <List>
            <li>
              <strong>Checks you don&rsquo;t save:</strong> deleted after{" "}
              {RETENTION_DAYS.checks} days.
            </li>
            <li>
              <strong>Saved checks:</strong> kept until you unsave or delete them, or delete your account. After that the
              {` ${RETENTION_DAYS.checks}`}-day rule applies.
            </li>
            <li>
              <strong>Your account, linked sign-ins, application reports and scam reports:</strong> kept until you delete
              them or your account.
            </li>
            <li>
              <strong>Scam-report excerpts:</strong> cleared {RETENTION_DAYS.excerpt} days after the report was made, or
              sooner if you remove the excerpt.
            </li>
            <li>
              <strong>Problem reports:</strong> kept while open, and deleted {RETENTION_DAYS.resolvedFlags} days after we
              resolve them.
            </li>
            <li>
              <strong>Cached public facts:</strong> a job-board posting we last saw live is reused for up to{" "}
              {POSTINGS_REFRESH_HOURS === 1 ? "an hour" : `${POSTINGS_REFRESH_HOURS} hours`} (one we last saw removed is
              checked again each time), and every listed company&rsquo;s board is refreshed once a day, so each posting
              records when it was first seen, last seen, removed and relisted. A
              domain&rsquo;s registration date and mail records are reused for {RETENTION_DAYS.domainCache} days before being
              looked up again. Neither contains data about you.
            </li>
            <li>
              <strong>Job-board search results:</strong> a short key made from the company name searched for and, when found, the
              board&rsquo;s own name and identifier. Kept {RETENTION_DAYS.discoveryFound} days ({RETENTION_DAYS.discoveryNotFound} days
              when a search found nothing, half a day after a quick board check alone). They contain no data about you.
            </li>
            <li>
              <strong>AI quality measurements:</strong> when a check already sent your masked text to Claude, we may ask Claude
              which sentences match our warning signs, to measure how well that works before ever showing it. We keep only the
              rule, the sentence&rsquo;s number and a score, never the text, for {RETENTION_DAYS.aiShadow} days. It never changes
              your result.
            </li>
            <li>
              <strong>AI usage counters:</strong> one number per day for the whole site and one per account (how many AI
              calls), deleted after {RETENTION_DAYS.aiUsage} days. They contain no text.
            </li>
            <li>
              <strong>Rate-limit counters:</strong> in server memory only, dropped within about a minute of their window ending (an hour at most). Vercel keeps its request logs
              under its own retention policy.
            </li>
          </List>
          <p>
            Our database provider keeps a short restore history for recovering from mistakes, so deleted data can remain
            there until that window passes.
          </p>
        </Section>

        <Section id="control">
          <p>
            <strong>On your <Link className={ui.link} href="/dashboard">dashboard</Link></strong> (signed in) you can:
          </p>
          <List>
            <li>see your account details, application reports, saved checks and scam reports;</li>
            <li>change an application&rsquo;s status, unsave a check, or remove a scam report&rsquo;s excerpt;</li>
            <li>delete any single report or saved check;</li>
            <li>
              <strong>delete your account.</strong> This immediately deletes the account, its linked sign-ins, and all of
              its application reports and scam reports. Saved checks are unlinked from you and then expire under the{" "}
              {RETENTION_DAYS.checks}-day rule.
            </li>
          </List>
          <p>
            Your account details, application reports and saved checks are what the site&rsquo;s own API returns to you
            when signed in; scam reports are listed on the dashboard only.
          </p>
          <p>
            If you sign in with a username and password, you can change your username, email address and password on your
            dashboard; each change asks for your current password. A new email address replaces the old one and is marked
            unverified, because we can&rsquo;t send email to confirm it. If you sign in with Google or GitHub, your email
            address comes from that sign-in; ask us through the contact link below to change it. If you gave an email
            address with a problem report and want it removed, ask us.
          </p>
        </Section>

        <Section id="legal">
          <p>
            We disclose account data only when required by valid legal process, such as a subpoena, court order or search
            warrant. Before we do, we tell the affected user, unless the law forbids it or there is an emergency involving a
            risk of death or serious harm.
          </p>
        </Section>

        <Section id="children">
          <p>
            JobSeance is for adults: you must be {MIN_AGE} or older to use it, including to create an account or submit a
            report. We do not knowingly collect data
            from children under 13. If we learn that an account belongs to a child under 13, we delete it and its reports.
            If you think that has happened, tell us through the contact link below.
          </p>
        </Section>

        <Section id="dnt">
          <p>
            We don&rsquo;t track you across other sites, and no third party collects information about you across sites
            through JobSeance. So there is nothing to switch off: we treat every visitor the same whether or not the
            browser sends a Do Not Track signal.
          </p>
        </Section>

        <Section id="security">
          <p>
            The site is served only over HTTPS. Passwords are stored as bcrypt hashes, the session cookie can&rsquo;t be
            read by scripts on the page, and we don&rsquo;t keep Google or GitHub access tokens. You can log out of every
            device at once from your dashboard (&ldquo;Log out everywhere&rdquo;). No system is perfectly secure, so please use a password you don&rsquo;t use
            anywhere else.
          </p>
        </Section>

        <Section id="changes">
          <p>
            When we change this notice we update this page and the effective date at the top. We don&rsquo;t send email, so
            please check back here.
          </p>
        </Section>

        <Section id="contact">
          <p>
            For any privacy question or data request, use{" "}
            <Link className={ui.link} href={CONTACT_HREF}>
              Report a problem
            </Link>{" "}
            and choose &ldquo;{PRIVACY_REASON_LABEL}&rdquo;. If you have an account, you can delete everything yourself
            from your <Link className={ui.link} href="/dashboard">dashboard</Link> without asking us.
          </p>
        </Section>
      </div>
    </main>
  );
}
