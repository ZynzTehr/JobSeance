import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import SiteHeader, { SiteFooter } from "./components/SiteHeader";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JobSeance: is this job real?",
  description:
    "Check a job posting or recruiter message for ghost-job risk and scam risk. Every score shows the facts and sources behind it.",
};

/** Matches the header's ink colour, so mobile browser chrome blends with the site. */
export const viewport: Viewport = { themeColor: "#121a2f" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${plex.variable} h-full`}>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before
          React hydrates. This silences only <body>'s own attributes; mismatches inside still report. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
