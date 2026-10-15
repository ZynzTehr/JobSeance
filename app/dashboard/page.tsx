import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userFromToken } from "@/lib/auth/session";
import SessionActions from "./SessionActions";
import styles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Dashboard · JobSeance",
  description: "Your JobSeance account, saved checks and application outcomes.",
};

const PROVIDER_LABEL = { GOOGLE: "Google", GITHUB: "GitHub" } as const;

// Phase 2 stub: proves the session works. Saved checks and reports arrive in later phases.
export default async function DashboardPage() {
  const user = await userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const rows: [string, string][] = [
    ["Username", user.username ?? "None (signed in with Google or GitHub)"],
    ["Email", user.email],
    ["Linked sign-in", user.providers.length ? user.providers.map((p) => PROVIDER_LABEL[p]).join(", ") : "None"],
    ["Password sign-in", user.username ? "Yes" : "No"],
  ];

  return (
    <main className={`${styles.stage} flex min-h-svh items-center justify-center px-5 py-12`}>
      <section className={`${styles.card} w-full max-w-xl p-8 sm:p-10`} aria-labelledby="dashboard-heading">
        <p className={styles.eyebrow}>Signed in</p>
        <h1 id="dashboard-heading" className={`${styles.heading} mt-2`}>
          {user.username ? `Welcome, ${user.username}` : "Welcome"}
        </h1>
        <p className={`${styles.lede} mt-3`}>Saved checks and your application outcomes will appear here.</p>

        <dl className={`${styles.details} mt-8 pt-6 grid gap-x-6 gap-y-4 sm:grid-cols-[10rem_1fr]`}>
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className={styles.term}>{label}</dt>
              <dd className={`${styles.value} m-0`}>{value}</dd>
            </div>
          ))}
        </dl>

        <SessionActions />
      </section>
    </main>
  );
}
