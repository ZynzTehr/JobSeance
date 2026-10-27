"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./site.module.css";

const PUBLIC_LINKS = [
  { href: "/companies", label: "Companies" },
  { href: "/methodology", label: "Methodology" },
];

const MEMBER_LINKS = [{ href: "/scan", label: "Scan" }, ...PUBLIC_LINKS, { href: "/dashboard", label: "Dashboard" }];

/** Clears the session cookie and returns to the landing page (the login form). */
function LogoutButton({ className, onDone }: { className: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      onDone();
      router.push("/");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <button type="button" className={className} onClick={logout} disabled={pending}>
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

/** Nav with active state; collapses into a menu button at phone width. */
export default function NavLinks({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const active = (href: string) => pathname.startsWith(href);
  const links = signedIn ? MEMBER_LINKS : PUBLIC_LINKS;

  const items = (
    <>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={`${styles.navLink} px-3 py-2`}
          onClick={() => setOpen(false)}
        >
          {l.label}
        </Link>
      ))}
      {signedIn ? (
        <LogoutButton className={`${styles.account} px-4 py-2`} onDone={() => setOpen(false)} />
      ) : (
        <Link
          href="/login"
          aria-current={active("/login") || pathname === "/" ? "page" : undefined}
          className={`${styles.account} px-4 py-2`}
          onClick={() => setOpen(false)}
        >
          Log in
        </Link>
      )}
    </>
  );

  return (
    <>
      <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
        {items}
      </nav>
      <button
        type="button"
        className={`${styles.menuButton} ml-auto px-3 py-2 md:hidden`}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className={`${styles.mobileNav} absolute inset-x-0 top-full flex flex-col gap-1 px-5 pb-5 pt-2 md:hidden`}
        >
          {items}
        </nav>
      )}
    </>
  );
}
