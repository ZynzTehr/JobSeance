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
   | `ANTHROPIC_API_KEY` | Optional; turns on AI reading for the Pasted posting tab. Use a dedicated key with a monthly spend limit set in the Anthropic console |
   | `AI_MODE`, `AI_MODEL`, `AI_DAILY_USD` | Optional: `off` disables AI without removing the key; model override (default `claude-haiku-5-5`); global daily spend cap in USD (default 2) |

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
