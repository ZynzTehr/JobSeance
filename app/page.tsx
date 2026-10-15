import styles from "./page.module.css";

const checks = [
  {
    term: "Ghost-job risk",
    description:
      "Is the role really open? We look for it on the employer’s own job board, check its age, and read the wording.",
  },
  {
    term: "Scam risk",
    description:
      "Is the recruiter real? We check the sender’s domain and match the message against FTC and FBI warning signs.",
  },
];

export default function Home() {
  return (
    <main className="relative isolate flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className={`${styles.glow} pointer-events-none absolute -top-40 left-[-10%] -z-10 h-[42rem] w-[42rem]`}
      />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10 sm:px-10">
        <p className={styles.wordmark}>JobSeance</p>

        <div className="flex flex-1 flex-col justify-center py-16">
          <h1 className={styles.headline}>
            Is this job
            <br />
            still alive?
          </h1>

          <p className={`${styles.lede} mt-8 max-w-[58ch]`}>
            Paste a job link or a recruiter&rsquo;s message. JobSeance checks it
            for two risks and shows every fact and source behind each score, so
            you can judge it yourself.
          </p>

          <dl
            className={`${styles.checks} mt-12 grid max-w-3xl gap-8 pt-8 sm:grid-cols-2`}
          >
            {checks.map((check) => (
              <div key={check.term}>
                <dt className={styles.term}>{check.term}</dt>
                <dd className={`${styles.description} mt-2`}>
                  {check.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className={styles.footer}>
          The scanner is being built. This page confirms the app deploys.
        </footer>
      </div>
    </main>
  );
}
