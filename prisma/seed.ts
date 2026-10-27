import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDb } from "../lib/db";
import type { Ats, Outcome, Stage, User } from "../app/generated/prisma/client";

// Seed for SPEC.md "Seed data and demo script". Safe to re-run: it upserts
// users, companies, the posting and the domain cache, and recreates only the
// reports owned by the seed reporters. Dates are relative to now, so the
// 45- and 180-day windows still hold on demo day.

const db = getDb();
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * DAY);
const normalizeRole = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

// Dev default only. For production, set DEMO_USER_PASSWORD in your shell.
const DEV_DEMO_PASSWORD = "seance-demo-password-dev";
const demoEmail = (process.env.DEMO_USER_EMAIL || "demo@jobseance.example").trim().toLowerCase();
const demoPassword = (process.env.DEMO_USER_PASSWORD || DEV_DEMO_PASSWORD).normalize("NFC");

// Phase 12: a separate admin account, from the shell only (never a default). When it is set,
// "demo" becomes a plain USER, because the demo password is typed in front of an audience.
const adminEmail = process.env.ADMIN_USER_EMAIL?.trim().toLowerCase() || null;
const adminPassword = process.env.ADMIN_USER_PASSWORD?.normalize("NFC") || null;
if (Boolean(adminEmail) !== Boolean(adminPassword)) throw new Error("Set both ADMIN_USER_EMAIL and ADMIN_USER_PASSWORD, or neither.");
if (adminPassword && ([...adminPassword].length < 12 || Buffer.byteLength(adminPassword) > 72)) {
  throw new Error("ADMIN_USER_PASSWORD must be at least 12 characters and at most 72 bytes.");
}
if (adminPassword && adminPassword === demoPassword) throw new Error("ADMIN_USER_PASSWORD must differ from the demo password.");

// Length limits as at sign-up (8-64 characters, at most 72 bytes, never trimmed). The character-mix
// rule isn't enforced here, so existing demo passwords keep working; login never re-checks the policy.
const passwordLength = [...demoPassword].length;
if (passwordLength < 8 || passwordLength > 64 || Buffer.byteLength(demoPassword) > 72) {
  throw new Error("DEMO_USER_PASSWORD must be 8-64 characters and at most 72 bytes.");
}

const realCompanies: { name: string; slug: string; domains: string[]; ats: Ats; board: string; host?: string }[] = [
  { name: "Discord", slug: "discord", domains: ["discord.com"], ats: "GREENHOUSE", board: "discord" },
  { name: "Stripe", slug: "stripe", domains: ["stripe.com"], ats: "GREENHOUSE", board: "stripe" },
  { name: "Airbnb", slug: "airbnb", domains: ["airbnb.com"], ats: "GREENHOUSE", board: "airbnb" },
  { name: "Figma", slug: "figma", domains: ["figma.com"], ats: "GREENHOUSE", board: "figma" },
  { name: "Reddit", slug: "reddit", domains: ["reddit.com", "redditinc.com"], ats: "GREENHOUSE", board: "reddit" },
  { name: "Cloudflare", slug: "cloudflare", domains: ["cloudflare.com"], ats: "GREENHOUSE", board: "cloudflare" },
  { name: "Coinbase", slug: "coinbase", domains: ["coinbase.com"], ats: "GREENHOUSE", board: "coinbase" },
  { name: "Databricks", slug: "databricks", domains: ["databricks.com"], ats: "GREENHOUSE", board: "databricks" },
  { name: "Pinterest", slug: "pinterest", domains: ["pinterest.com", "pinterestcareers.com"], ats: "GREENHOUSE", board: "pinterest" },
  { name: "Dropbox", slug: "dropbox", domains: ["dropbox.com"], ats: "GREENHOUSE", board: "dropbox" },
  { name: "Spotify", slug: "spotify", domains: ["spotify.com", "spotifyjobs.com"], ats: "LEVER", board: "spotify" },
  { name: "Palantir", slug: "palantir", domains: ["palantir.com"], ats: "LEVER", board: "palantir" },
  { name: "Ramp", slug: "ramp", domains: ["ramp.com"], ats: "ASHBY", board: "ramp" },
  { name: "Notion", slug: "notion", domains: ["notion.so", "makenotion.com"], ats: "ASHBY", board: "notion" },
  { name: "Linear", slug: "linear", domains: ["linear.app"], ats: "ASHBY", board: "linear" },
  // Phase 10 systems (boards checked live on 2026-10-27).
  { name: "NVIDIA", slug: "nvidia", domains: ["nvidia.com"], ats: "WORKDAY", board: "nvidia/NVIDIAExternalCareerSite", host: "nvidia.wd5.myworkdayjobs.com" },
  { name: "Ubisoft", slug: "ubisoft", domains: ["ubisoft.com"], ats: "SMARTRECRUITERS", board: "Ubisoft2" },
  { name: "Hugging Face", slug: "hugging-face", domains: ["huggingface.co"], ats: "WORKABLE", board: "huggingface" },
  { name: "bunq", slug: "bunq", domains: ["bunq.com"], ats: "RECRUITEE", board: "bunq" },
  { name: "Amazon", slug: "amazon", domains: ["amazon.com", "amazon.jobs"], ats: "AMAZON", board: "amazon" },
];

// Phase 11: no board we read, but a dedicated careers host an admin allowlisted for the
// presence check and page reading. Never a shared host like www.google.com.
const careersCompanies: { name: string; slug: string; domains: string[]; careersHosts: string[] }[] = [
  { name: "Apple", slug: "apple", domains: ["apple.com"], careersHosts: ["jobs.apple.com"] },
  { name: "Microsoft", slug: "microsoft", domains: ["microsoft.com"], careersHosts: ["jobs.careers.microsoft.com", "careers.microsoft.com"] },
  { name: "Meta", slug: "meta", domains: ["meta.com", "fb.com", "metacareers.com"], careersHosts: ["metacareers.com"] },
];

const fictionalCompanies = [
  { name: "Bramblecloud Software", slug: "bramblecloud", domain: "bramblecloud.example" },
  { name: "Quietwater Logistics", slug: "quietwater", domain: "quietwater.example" },
  { name: "Orbitfern Health", slug: "orbitfern", domain: "orbitfern.example" },
];

type SeedReport = {
  reporter: number; // 1-6
  company: string; // slug
  role: string;
  appliedDaysAgo: number;
  lastInterviewDaysAgo?: number;
  stage: Stage;
  outcome: Outcome;
};

const seededReports: SeedReport[] = [
  // Bramblecloud: 5 interview-stage ghosted + 1 applied-stage rejected => G-COMMUNITY 21.
  { reporter: 1, company: "bramblecloud", role: "Data Analyst", appliedDaysAgo: 150, lastInterviewDaysAgo: 60, stage: "INTERVIEWED", outcome: "NO_RESPONSE" },
  { reporter: 2, company: "bramblecloud", role: "Data Analyst", appliedDaysAgo: 155, lastInterviewDaysAgo: 75, stage: "INTERVIEWED", outcome: "NO_RESPONSE" },
  { reporter: 3, company: "bramblecloud", role: "Data Analyst", appliedDaysAgo: 160, lastInterviewDaysAgo: 90, stage: "INTERVIEWED", outcome: "NO_RESPONSE" },
  { reporter: 4, company: "bramblecloud", role: "Data Analyst", appliedDaysAgo: 165, lastInterviewDaysAgo: 105, stage: "INTERVIEWED", outcome: "NO_RESPONSE" },
  { reporter: 5, company: "bramblecloud", role: "Data Analyst", appliedDaysAgo: 170, lastInterviewDaysAgo: 120, stage: "INTERVIEWED", outcome: "NO_RESPONSE" },
  { reporter: 6, company: "bramblecloud", role: "Data Analyst", appliedDaysAgo: 158, stage: "APPLIED", outcome: "REJECTED" },
  // Quietwater: healthy, 5 reporters including 2 Offer/Hired.
  { reporter: 1, company: "quietwater", role: "Operations Analyst", appliedDaysAgo: 70, lastInterviewDaysAgo: 40, stage: "INTERVIEWED", outcome: "HIRED" },
  { reporter: 2, company: "quietwater", role: "Logistics Coordinator", appliedDaysAgo: 50, lastInterviewDaysAgo: 30, stage: "INTERVIEWED", outcome: "OFFER" },
  { reporter: 3, company: "quietwater", role: "Fleet Planner", appliedDaysAgo: 30, lastInterviewDaysAgo: 10, stage: "INTERVIEWED", outcome: "INTERVIEWING" },
  { reporter: 4, company: "quietwater", role: "Operations Analyst", appliedDaysAgo: 40, stage: "APPLIED", outcome: "REJECTED" },
  { reporter: 5, company: "quietwater", role: "Customer Success Associate", appliedDaysAgo: 12, stage: "APPLIED", outcome: "APPLIED" },
  // Orbitfern: only 2 reports, so it shows "Not rated".
  { reporter: 1, company: "orbitfern", role: "Clinical Data Coordinator", appliedDaysAgo: 60, stage: "APPLIED", outcome: "NO_RESPONSE" },
  { reporter: 2, company: "orbitfern", role: "Patient Support Specialist", appliedDaysAgo: 25, lastInterviewDaysAgo: 8, stage: "INTERVIEWED", outcome: "INTERVIEWING" },
];

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").hostname;
  console.log(`Seeding ${host}`);
  if (demoPassword === DEV_DEMO_PASSWORD) {
    console.warn("Using the DEV demo password. Set DEMO_USER_PASSWORD in your shell before seeding production.");
  }

  // bcrypt is slow on purpose (cost 12), so hash before opening the transaction.
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const adminHash = adminPassword ? await bcrypt.hash(adminPassword, 12) : null;
  if (adminEmail) console.log("Creating the admin account; demo becomes a USER.");

  const counts = await db.$transaction(
    async (tx) => {
      const reporters: User[] = [];
      for (let i = 1; i <= 6; i++) {
        reporters.push(
          await tx.user.upsert({
            where: { email: `reporter${i}@seed.example` },
            update: {},
            create: { email: `reporter${i}@seed.example`, name: `Seed reporter ${i}` },
          }),
        );
      }

      const demoUsers = [
        { username: "demo", email: demoEmail, role: adminEmail ? ("USER" as const) : ("ADMIN" as const), name: "Demo user" },
        { username: "demo2", email: "demo2@jobseance.example", role: "USER" as const, name: "Second demo user" },
      ];
      const demos: User[] = [];
      for (const u of demoUsers) {
        demos.push(
          await tx.user.upsert({
            where: { email: u.email },
            update: { username: u.username, passwordHash, role: u.role },
            create: { ...u, passwordHash },
          }),
        );
      }
      const demo = demos[0];
      if (adminEmail && adminHash) {
        await tx.user.upsert({
          where: { email: adminEmail },
          update: { username: "admin", passwordHash: adminHash, role: "ADMIN" },
          create: { username: "admin", email: adminEmail, name: "Admin", role: "ADMIN", passwordHash: adminHash },
        });
      }

      for (const c of realCompanies) {
        const data = { name: c.name, officialDomains: c.domains, ats: c.ats, atsBoard: c.board, atsHost: c.host ?? null, isFictional: false };
        await tx.company.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } });
      }

      for (const c of careersCompanies) {
        const data = { name: c.name, officialDomains: c.domains, ats: "NONE" as const, atsBoard: null, atsHost: null, careersHosts: c.careersHosts, isFictional: false };
        await tx.company.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } });
      }

      const fictional: Record<string, string> = {};
      for (const c of fictionalCompanies) {
        const data = { name: c.name, officialDomains: [c.domain], ats: "NONE" as const, atsBoard: null, isFictional: true };
        const row = await tx.company.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } });
        fictional[c.slug] = row.id;
      }

      const postingData = {
        companyId: fictional.bramblecloud,
        title: "Data Analyst",
        location: "Remote (US)",
        url: "https://bramblecloud.example/careers/data-analyst",
        description:
          "Bramblecloud Software is hiring a Data Analyst to turn product data into decisions. " +
          "We are collecting resumes for future openings and will reach out when a role becomes available. " +
          "You will build dashboards, write SQL, and partner with product and finance teams.",
        postedAt: daysAgo(210),
        firstSeenAt: daysAgo(210),
        lastSeenAt: new Date(now),
        fetchedAt: new Date(now),
        state: "UNKNOWN" as const,
      };
      const posting = await tx.posting.upsert({
        where: { ats_board_externalId: { ats: "NONE", board: "bramblecloud", externalId: "data-analyst" } },
        update: postingData,
        create: { ats: "NONE", board: "bramblecloud", externalId: "data-analyst", ...postingData },
      });

      const reporterIds = reporters.map((r) => r.id);
      await tx.outcomeReport.deleteMany({ where: { userId: { in: reporterIds } } });
      await tx.outcomeReport.createMany({
        data: seededReports.map((r) => {
          const lastInterviewAt = r.lastInterviewDaysAgo === undefined ? null : daysAgo(r.lastInterviewDaysAgo);
          return {
            userId: reporters[r.reporter - 1].id,
            companyId: fictional[r.company],
            postingId: r.company === "bramblecloud" ? posting.id : null,
            roleTitle: normalizeRole(r.role),
            appliedAt: daysAgo(r.appliedDaysAgo),
            lastInterviewAt,
            lastContactAt: lastInterviewAt ?? daysAgo(r.appliedDaysAgo),
            stageReached: r.stage,
            outcome: r.outcome,
          };
        }),
      });

      // Demo step 6: the demo user's own Quietwater report, reset to Applied on every seed.
      const demoReport = {
        appliedAt: daysAgo(9),
        lastInterviewAt: null,
        lastContactAt: daysAgo(9),
        stageReached: "APPLIED" as const,
        outcome: "APPLIED" as const,
        visibility: "VISIBLE" as const,
      };
      const role = normalizeRole("Logistics Coordinator");
      await tx.outcomeReport.upsert({
        where: { userId_companyId_roleTitle: { userId: demo.id, companyId: fictional.quietwater, roleTitle: role } },
        update: demoReport,
        create: { userId: demo.id, companyId: fictional.quietwater, roleTitle: role, ...demoReport },
      });

      const domainData = { registeredAt: daysAgo(6), status: "OK" as const, hasMx: true, nullMx: false, checkedAt: new Date(now) };
      await tx.domainLookup.upsert({
        where: { domain: "bramblecloud-careers.example" },
        update: domainData,
        create: { domain: "bramblecloud-careers.example", ...domainData },
      });

      await tx.scamReport.deleteMany({ where: { userId: { in: reporterIds } } });
      await tx.scamReport.createMany({
        data: [0, 1, 2].map((i) => ({
          userId: reporterIds[i],
          companyClaimed: "Bramblecloud Software",
          senderDomain: "bramblecloud-careers.example",
          channel: "EMAIL" as const,
          ruleIds: ["S-FAKE-CHECK", "S-PAY-TO-WORK", "S-LOOKALIKE", "S-DOMAIN-NEW"],
          scamScore: 100,
        })),
      });

      return {
        users: await tx.user.count(),
        companies: await tx.company.count(),
        postings: await tx.posting.count(),
        outcomeReports: await tx.outcomeReport.count(),
        scamReports: await tx.scamReport.count(),
        domainLookups: await tx.domainLookup.count(),
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  console.log("Seed complete:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
