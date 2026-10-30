import type { Metadata } from "next";
import Link from "next/link";
import ui from "./components/ui.module.css";
import styles from "./not-found.module.css";
import { CONTACT_HREF } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Page not found · JobSeance",
  description: "This page doesn't exist on JobSeance.",
};

/** Every unmatched URL, plus notFound() from a page (an unknown company, the admin page for non-admins). */
export default function NotFound() {
  return (
    <main className={`${ui.page} flex flex-1 items-center`}>
      <div className="mx-auto flex w-full max-w-xl flex-col items-center px-5 py-20 text-center sm:px-8">
        <p className={`${styles.numeral} select-none`} aria-hidden="true">
          404
        </p>
        <p className={`${ui.eyebrow} mt-2`}>Page not found</p>
        <h1 className={`${ui.title} mt-3`}>Nothing answered here.</h1>
        <p className={`${ui.lede} mt-4`}>
          The link may be old or mistyped, or the page was never here. Like a ghost job, it looked real until someone checked.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className={`${ui.primary} inline-block px-5 py-2.5`}>
            Go to the home page
          </Link>
          <Link href="/companies" className={`${ui.ghost} inline-block px-5 py-2.5`}>
            Browse companies
          </Link>
        </div>
        <p className={`${ui.small} ${ui.muted} mt-8`}>
          Followed a broken link on our site?{" "}
          <Link href={CONTACT_HREF} className={ui.link}>
            Tell us
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
