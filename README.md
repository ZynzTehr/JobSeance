# JobSeance

JobSeance checks a job posting or recruiter message for two risks: **ghost-job risk** (is the role really open?) and **scam risk** (is the recruiter real?). Every score shows the facts and sources behind it. Every check needs an account (username + password, Google or GitHub): the landing page is the login form and the scanner lives at `/scan`.

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
| Local | http://localhost:3000 | `dev` | Username + password; Google and GitHub once their client IDs are set |
| Preview (one per pull request) | Vercel preview URL | `dev` | Username + password only |
| Production | https://job-seance.vercel.app | `main` | Username + password; Google and GitHub once their client IDs are set |

Set each variable per environment in Vercel. On previews, leave `APP_URL` unset; the app falls back to `https://$VERCEL_URL`. Same-origin checks also trust Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, so production accepts its own domain even if `APP_URL` is unset. Set `CRON_SECRET` in Production so the daily cleanup can run.

## Postman

`postman/jobseance.postman_collection.json` covers the whole API. It logs in once per seeded user, signs up nobody and cleans up after itself.

```bash
npx newman@6.2.2 run postman/jobseance.postman_collection.json --env-var baseUrl=http://localhost:3000
```

Against production, create a Postman environment with `baseUrl=https://job-seance.vercel.app` and `demoPassword` set to the production demo password (the default is the dev seed's). The folder **★ Demo step 6** holds the demo's API step in presenting order: run "0 · Setup › Log in as demo" first.

## Version pins

- **Prisma is pinned to 7.10.0.** `prisma@latest` installs a Prisma 8 pre-release that removes `db push`. Never install Prisma unpinned.
- Prisma reads `prisma7.config.ts`. Do not add a second `prisma.config.ts`.
- Cache Components are off.

## Styling

- **Tailwind is for layout only:** display, flex and grid, gap, padding and margin, width and height, position, overflow, and breakpoints.
- **Custom CSS is for everything visual:** color, typography, borders, backgrounds, shadows, effects and motion. Design tokens and base styles are in `app/globals.css`. Each component's visual styles are in a CSS Module next to it, for example `app/page.module.css`.
- Keep layout properties out of custom CSS. It is unlayered, so it would override Tailwind's utilities.
- Put `@keyframes` in the CSS Module that uses them. CSS Modules rename animations, so a module cannot reach a global `@keyframes`.
- `next.config.ts` runs the Tailwind loader on every `.css` file except `*.module.css`. Without that exclusion, CSS Modules lose their class names.

## Contributing

Work happens on one branch and one pull request per build phase (`phase-0-setup` to `phase-8-polish`). Each pull request lists what was built, how to test it, and the gate checklist for that phase.
