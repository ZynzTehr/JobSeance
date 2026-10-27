import Link from "next/link";
import { currentUser } from "@/lib/session-user";
import NavLinks from "./NavLinks";
import styles from "./site.module.css";

/** Site-wide header. Server component: member links and Log out when signed in, Log in otherwise. */
export default async function SiteHeader() {
  const user = await currentUser();
  return (
    <header className={`${styles.header} sticky top-0 z-30`}>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3 sm:px-8">
        <Link href="/" className={`${styles.wordmark} flex items-center gap-2`}>
          <span aria-hidden className={`${styles.mark} inline-block h-3 w-3`} />
          JobSeance
        </Link>
        <NavLinks signedIn={Boolean(user)} />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={`${styles.footer} mt-auto`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-start sm:justify-between sm:px-8">
        <p className="max-w-xl">
          JobSeance scores are automated estimates from public signals and users&rsquo; own reports, not statements of fact
          about any company. Not affiliated with the companies shown, the FTC or the FBI.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/methodology">Methodology</Link>
          <Link href="/companies">Companies</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/report-a-problem">Report a problem</Link>
        </nav>
      </div>
    </footer>
  );
}
