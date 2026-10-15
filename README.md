# JobSeance

JobSeance checks a job posting or recruiter message for two risks: **ghost-job risk** (is the role really open?) and **scam risk** (is the recruiter real?). Every score shows the facts and sources behind it.

Built with Next.js 16.4 (App Router), Prisma 7.10, Neon Postgres, Passport.js and Tailwind CSS. Hosted on Vercel.

## Requirements

- Node.js 22 or newer
- A [Neon](https://neon.com) project with two branches: `main` (production) and `dev` (local and previews)

## Set up locally

1. Install dependencies. This also generates the Prisma client.

   ```bash
   npm install
   ```

2. Copy the example environment file and fill it in. Use `.env`, not `.env.local`, because the Prisma CLI reads only `.env`.

   ```bash
   cp .env.example .env
   ```

   | Variable | Local value |
   | --- | --- |
   | `DATABASE_URL` | Neon `dev` branch, pooled URL (host contains `-pooler`) |
   | `DATABASE_URL_UNPOOLED` | Neon `dev` branch, direct URL |
   | `JWT_SECRET`, `OAUTH_COOKIE_SECRET` | Run `openssl rand -base64 32` once for each |
   | `APP_URL` | `http://localhost:3000` |
   | `GOOGLE_*`, `GITHUB_*` | From your OAuth apps; leave empty to hide that sign-in button |
   | `CRON_SECRET`, `USE_FIXTURES` | Optional |
   | `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD` | Optional; used by the database seed |

3. Start the development server and open http://localhost:3000.

   ```bash
   npm run dev
   ```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm test` | Run the unit tests (Vitest); they never call the network or the database |
| `npm run lint` | Run ESLint |

## Environments

| Environment | URL | Neon branch | Sign-in |
| --- | --- | --- | --- |
| Local | http://localhost:3000 | `dev` | Email + password, Google, GitHub |
| Preview (one per pull request) | Vercel preview URL | `dev` | Email + password only |
| Production | https://jobseance.vercel.app | `main` | Email + password, Google, GitHub |

Set each variable per environment in Vercel. On previews, leave `APP_URL` unset; the app falls back to `https://$VERCEL_URL`.

## Version pins

- **Prisma is pinned to 7.10.0.** `prisma@latest` installs a Prisma 8 pre-release that removes `db push`. Never install Prisma unpinned.
- Prisma reads `prisma7.config.ts`. Do not add a second `prisma.config.ts`.
- Cache Components are off.

## Contributing

Work happens on one branch and one pull request per build phase (`phase-0-setup` to `phase-8-polish`). Each pull request lists what was built, how to test it, and the gate checklist for that phase.
