<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- bmad:context -->
<!-- Verified 2026-10-28 against 66e92ee. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## JobSeance

Scores a job posting or recruiter message for ghost-job and scam risk; every score lists its facts and sources. Next.js 16.4 App Router, Prisma 7.10 on Neon Postgres, Passport + own JWT, Vitest, Playwright, Vercel. The spec and handoff notes (`SPEC.md`, `HANDOFF.md`, `prompt-log.md`) exist only in the maintainer's working folder.

## Policy

- Never commit or print secrets; `.env` stays local, deployed values live in Vercel.
- Never `git add -f` `SPEC.md`, `HANDOFF.md` or `prompt-log.md`; they are excluded in `.git/info/exclude`, not `.gitignore`, and stay out of the repo.
- Work on a branch with a pull request; never push to `main`. Agents may merge their own PR once CI, `npm run build` and the Vercel preview pass.
- Keep Prisma pinned at exactly 7.10.0; `prisma@latest` is a Prisma 8 pre-release. Ignore Prisma's "update available" notice.
- Points come only from the rubric in `lib/scoring/`. A change to what a signal fires on or scores bumps `CONFIG_VERSION` in `lib/scoring/config.ts` and updates `lib/methodology.ts` in the same change.
- AI output never sets points or appears in a stored fact; facts quote our directory, the job board or the fetched page. Anything AI finds about a company outside the directory stays a 0-point info row with no link.
- Never store or log pasted text; logs carry numbers only.
- Never show a ghost or scam band next to a company name; company pages and endpoints show facts and community counts only.
- When what goes to a third party or how long data is kept changes, update `lib/legal.ts` and `app/privacy/page.tsx` in the same change.

## Running and verifying

- CI (`.github/workflows/ci.yml`) runs typecheck, lint and unit tests on every PR; it does not build, so run `npm run build` yourself before merging.
- `npm test` never touches the network, the database or an AI API (`tests/setup.ts` blocks AI hosts); `USE_FIXTURES=1` replays `fixtures/` for boards and AI.
- `npm run test:e2e` builds and starts the app on port 3100 with `USE_FIXTURES=1` against the dev database from `.env`; never point it at production. The admin test runs only when `ADMIN_USER_PASSWORD` is set.
- After adding or removing an App Router route, run `npx next typegen`; stale `.next/types` break `RouteContext` typing.
- Schema commands read `DATABASE_URL_UNPOOLED`; the app and `npx prisma db seed` read `DATABASE_URL`. Both point at the dev branch in `.env`; to target production, override the one the command reads, e.g. `DATABASE_URL=$(neon connection-string production --project-id wandering-glitter-86940014) npx prisma db seed`.
- Additive schema changes go to production with `npx prisma db push` before the PR merges; the deploy reads new columns at once.

## Conventions that differ from defaults

- Tailwind for layout only; every visual property goes in the colocated `*.module.css` using the tokens in `app/globals.css` (there are no Tailwind color utilities).
- Keep `@keyframes` in the CSS Module that uses them; custom CSS is unlayered, so never put layout properties in it.
- No formatter is configured and files are hand-formatted; never run Prettier or another formatter over a file, as it reflows the whole file.
- Request schemas use `z.strictObject`; unknown keys are 400s.
- The server never fetches a URL a user pasted; outbound URLs are constants plus encoded identifiers (one exception: Workday job paths on `*.myworkdayjobs.com`, regex-checked).

## Known pitfalls

- `next.config.ts` keeps `*.module.css` out of the Tailwind loader; without that `condition`, CSS Modules silently lose their class names, and a path-glob key silently drops Tailwind instead.
- Before cutting a branch from an older one, check `git log main..<branch>`; PR #1 merged before its last pushes landed.

<!-- /bmad:context -->
