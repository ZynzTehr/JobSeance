"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./site.module.css";

const LINKS = [
  { href: "/", label: "Scan" },
  { href: "/companies", label: "Companies" },
  { href: "/methodology", label: "Methodology" },
  { href: "/api-docs", label: "API" },
];

/** Nav with active state; collapses into a menu button at phone width. */
export default function NavLinks({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const account = signedIn ? { href: "/dashboard", label: "Dashboard" } : { href: "/login", label: "Log in" };

  const items = (
    <>
      {LINKS.map((l) => (
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
      <Link
        href={account.href}
        aria-current={active(account.href) ? "page" : undefined}
        className={`${styles.account} px-4 py-2`}
        onClick={() => setOpen(false)}
      >
        {account.label}
      </Link>
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
