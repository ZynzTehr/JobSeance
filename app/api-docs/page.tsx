import type { Metadata } from "next";
import Link from "next/link";
import ui from "../components/ui.module.css";
import { API_GROUPS, ERROR_EXAMPLE, type Endpoint } from "@/lib/api-docs";
import TryIt from "./TryIt";
import styles from "./api-docs.module.css";

export const metadata: Metadata = {
  title: "REST API · JobSeance",
  description: "JobSeance REST API reference: check postings and recruiter messages, read company facts and log application outcomes.",
};

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function EndpointRow({ e }: { e: Endpoint }) {
  return (
    <li className={`${styles.endpoint} py-5`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`${styles[e.method]} px-2 py-1`}>{e.method}</span>
        <code className={styles.path}>{e.path}</code>
        <span className={styles.access}>{e.access}</span>
      </div>
      <p className={`${ui.body} mt-2 max-w-[72ch]`}>{e.summary}</p>
      {(e.request || e.response) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {e.request && (
            <div className="min-w-0">
              <p className={`${styles.exampleLabel} mb-1.5`}>Request body</p>
              <pre className={`${ui.code} overflow-x-auto p-3.5`}>{e.request}</pre>
            </div>
          )}
          {e.response && (
            <div className="min-w-0">
              <p className={`${styles.exampleLabel} mb-1.5`}>Response</p>
              <pre className={`${ui.code} overflow-x-auto p-3.5`}>{e.response}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ApiDocsPage() {
  return (
    <main className={`${ui.page} flex-1`}>
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 pt-12 sm:px-8">
        <p className={ui.eyebrow}>Developers · v1</p>
        <h1 className={`${ui.title} mt-2`}>REST API</h1>
        <p className={`${ui.lede} mt-4 max-w-[64ch]`}>
          Everything the site does is available over JSON. Log in with{" "}
          <code className={ui.inlineCode}>POST /api/auth/login</code> and send the token as{" "}
          <code className={ui.inlineCode}>Authorization: Bearer &lt;token&gt;</code>. Writes need{" "}
          <code className={ui.inlineCode}>Content-Type: application/json</code>.
        </p>

        <nav aria-label="API sections" className={`${styles.toc} mt-6`}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {API_GROUPS.map((g) => (
              <li key={g.title}>
                <a href={`#${slug(g.title)}`}>{g.title}</a>
              </li>
            ))}
            <li>
              <a href="#errors">Errors</a>
            </li>
            <li>
              <a href="#try-it">Try it</a>
            </li>
          </ul>
        </nav>

        {API_GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={slug(g.title)} className={`${ui.card} ${ui.rise} mt-8 px-6 py-2`}>
            <h2 id={slug(g.title)} className={`${ui.h2} pt-4`}>
              {g.title}
            </h2>
            <ul>
              {g.endpoints.map((e) => (
                <EndpointRow key={`${e.method} ${e.path}`} e={e} />
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="errors" className={`${ui.card} mt-8 p-6`}>
          <h2 id="errors" className={ui.h2}>
            Errors
          </h2>
          <p className={`${ui.body} mt-2 max-w-[72ch]`}>
            Every error uses the same shape. 400 invalid input, 401 not signed in, 403 not yours (or a cross-site write), 404
            missing, 409 duplicate, 413 body over 100 KB, 415 not JSON, 422 unsupported job URL or unknown board, 429 rate
            limited (with <code className={ui.inlineCode}>Retry-After</code>), 502 a job board is down, 503 the database is
            unreachable.
          </p>
          <pre className={`${ui.code} mt-3 overflow-x-auto p-3.5`}>{ERROR_EXAMPLE}</pre>
        </section>

        <section aria-labelledby="try-it" className={`${ui.card} mt-8 p-6`}>
          <h2 id="try-it" className={ui.h2}>
            Try it
          </h2>
          <p className={`${ui.muted} mt-1 mb-5`}>
            Sends a real request from your browser. Without a token, your session cookie is used.
          </p>
          <TryIt />
        </section>

        <p className={`${ui.small} mt-10`}>
          A Postman collection with every endpoint is in the repository under <code className={ui.inlineCode}>postman/</code>.
          Scoring details are on the{" "}
          <Link className={ui.link} href="/methodology">
            methodology page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
