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
   | `ADMIN_USER_EMAIL`, `ADMIN_USER_PASSWORD` | Optional, seed only (set in your shell): a separate `admin` account. When set, `demo` is seeded as a plain user, since its password is typed on stage |
   | `ANTHROPIC_API_KEY` | Optional; turns on AI reading, board searches and page reads. Use a dedicated key with a monthly spend limit set in the Anthropic console |
   | `AI_MODE`, `AI_MODEL`, `AI_MODEL_LOCATE`, `AI_DAILY_USD` | Optional: `off` disables AI without removing the key; model for reading and board guesses (default `claude-haiku-5-5`); model for web search and page reads (default `claude-sonnet-5-5`); global daily spend cap in USD (default 2) |

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

## AI reading (Pasted posting tab)

Anthropic's Claude (`claude-haiku-5-5`, effort `low`) reads the company, role and location from a pasted posting. It never scores: the directory and the employer's own job board verify what it read, and the versioned rubric scores as for any check. Board points from an AI reading count only for an exact title match, a job link found in the text, or a company and role the user confirms. What Claude read is shown on the result and never stored.

- Text is masked before it is sent (`lib/ai/sanitize.ts`): email addresses, phone and ID numbers, long numbers and links. Names are not masked.
- Spend guardrails, outermost first: the console spend limit on the key, `AI_MODE=off`, the admin pause row (`Setting` key `aiPaused` = `1`), a global daily cap (`AI_DAILY_USD`) and 20 AI checks per account per day, both reserved atomically in Postgres (`AiUsage`, `AiUserUsage`). Any failure or cap shows "couldn't verify" and scores 0.
- Logs carry numbers only: `ai extract model=… in=… out=… ms=… stop=… outcome=…`.
- `USE_FIXTURES=1` replays recorded readings from `fixtures/ai/` (the two demo postings in `lib/demo-examples.ts`). Re-record them with a key:

  ```bash
  ANTHROPIC_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/record-ai-fixtures.mts
  ```

- `npm test` never calls an AI API: `tests/setup.ts` turns AI off and blocks Anthropic hosts.
- Recruiter message tab: pasted email headers are parsed in memory (`lib/lookups/mail-auth.ts`) for DKIM/SPF/DMARC (`S-AUTH-FAIL`) and Reply-To (`S-REPLY-TO`); the optional "Let Claude read this message" box only suggests the sender and company fields.

## Job boards and hiring systems

Checks read the employer's own system, never a job site. Greenhouse, Lever and Ashby are read in `lib/lookups/boards.ts`; Workday, SmartRecruiters, Workable, Recruitee and amazon.jobs in `lib/lookups/adapters.ts`.

- A Workday company stores `atsBoard` as `tenant/site` and `atsHost` as the career-site host (for example `nvidia.wd5.myworkdayjobs.com`), both copied from a real job link.
- Workday, SmartRecruiters and amazon.jobs are searched for the role, not read in full, so a role missing from the search shows "couldn't verify" and is never marked removed.
- The Workday and amazon.jobs endpoints are public but undocumented. Every block, redirect or error shows "couldn't verify".
- `USE_FIXTURES=1` reads `fixtures/<system>-<board>.json`. Re-record the phase 10 systems without touching the demo boards:

  ```bash
  node scripts/make-fixtures.mjs --adapters
  ```

## Companies we don't list (phase 11)

- **Board discovery** (`lib/lookups/discovery.ts`): free probes of likely identifiers on the boards we read, then Claude's guesses (Haiku 5.5, no tools), then one Anthropic web search limited to job-board hosts (Sonnet 5.5, at most 3 searches). A board counts as found only when its own company name matches. Results are cached in `BoardDiscovery` (30 days found, 7 days not found).
- **Never counted.** Anyone can open a board under a company's name (a Workable account called "Spotify" exists), so a discovered board and its listing are 0-point info rows. An admin adds the company to the directory to make it count.
- **Presence check and page reading** run only on `Company.careersHosts`, an admin-curated allowlist (seeded for Apple, Microsoft and Meta). Page text comes from the fetch tool's own result block; a field the model reports is shown only if it appears word for word on the page. Phrase hits from a page are shown, not counted.
- Web searches and page reads are limited to 5 per account per day on top of the 20 AI checks, and each search costs $0.01 plus tokens.

## Admin page (phase 12)

`/admin` is for accounts with the `ADMIN` role, which is granted only in the database. Everyone else gets the same 404 as a missing page, and the API endpoints below answer 404 too. Admins see an Admin link in the header.

- **AI spend:** today's and the last 7 days' estimated spend, calls, searches, page reads, refusals and errors. One switch pauses every AI call (the `Setting` row `aiPaused`) within a minute, without a redeploy.
- **Boards found for companies we don't list:** review a discovered board, type the official domains yourself, and add the company to the directory. Board checks then count for it.
- **Official domains and careers hosts:** careers hosts must sit under an official domain and can't be a job site or a hiring system.
- **Open problem reports:** set a flag to under review, upheld (removes a reported outcome or scam report) or rejected (makes a hidden report visible again).

| Endpoint | What it does |
| --- | --- |
| `GET /api/v1/admin/ai-usage` | AI spend and counts, numbers only |
| `POST /api/v1/admin/ai-pause` | `{ "paused": true }` or `false` |
| `GET /api/v1/admin/discoveries` | Found boards not yet in the directory |
| `PATCH /api/v1/companies/:slug` | `officialDomains`, `careersHosts` |
| `PATCH /api/v1/flags/:id` | `status`, `resolutionNote` |

In production, seed a separate admin account from your shell and demote `demo`, whose password is typed on stage:

```bash
ADMIN_USER_EMAIL=... ADMIN_USER_PASSWORD=... DEMO_USER_PASSWORD=... npx prisma db seed --config prisma7.config.ts
```

## Environments

| Environment | URL | Neon branch | Sign-in |
| --- | --- | --- | --- |
| Local | http://localhost:3000 | `dev` | Username + password; Google and GitHub once their client IDs are set |
| Preview (one per pull request) | Vercel preview URL | `dev` | Username + password only |
| Production | https://job-seance.vercel.app | `main` | Username + password; Google and GitHub once their client IDs are set |

Set each variable per environment in Vercel. On previews, leave `APP_URL` unset; the app falls back to `https://$VERCEL_URL`. Same-origin checks also trust Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, so production accepts its own domain even if `APP_URL` is unset. Set `CRON_SECRET` in Production so the daily cleanup can run. Set `ANTHROPIC_API_KEY` in Preview and Production to turn AI reading on; without it the Pasted posting tab still works and shows "couldn't verify" for the AI step.

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

Work happens on one branch and one pull request per build phase (`phase-0-setup` to `phase-8-polish`, then `phase-9-ai-posting` onward for the AI work). Each pull request lists what was built, how to test it, and the gate checklist for that phase.
