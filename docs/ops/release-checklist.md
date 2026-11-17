# Release checklist

Run in order. Nothing in production changes until the last section, which needs the owner's explicit approval.

## Before merging

1. `pnpm typecheck && pnpm lint && pnpm test` (unit tests; add `DATABASE_URL=<a disposable database>` to include the real-PostgreSQL ones).
2. Migrate a disposable database from empty: `DATABASE_URL=<disposable> pnpm db:migrate`. Never point these at the developer database or at production.
3. `pnpm build` with stand-in secrets, then the bundle scan:

   ```bash
   TOGETHER_API_KEY=SENTINEL-TOGETHER GOOGLE_CLIENT_ID=SENTINEL-GOOGLE-ID GOOGLE_CLIENT_SECRET=SENTINEL-GOOGLE-SECRET \
   GLOSS_COOKIE_SECRET=SENTINEL-COOKIE-SECRET-0123456789 DATABASE_URL=postgres://u:SENTINELDBPASSWORD@localhost:5432/none pnpm build
   <the same variables> node scripts/scan-bundle.mjs
   ```
4. Integration tests against the production build (`next start` on the disposable database with `GLOSS_COOKIE_SECRET` exported): `INTEGRATION_BASE_URL=http://localhost:3201 pnpm test:integration`. This includes `allowances.test.ts`, which starts its own servers and proves the daily allowances, one-at-a-time rule and budget across instances.
5. Browsers: `npx playwright test --project=desktop --project=mobile` and `--project=firefox --project=webkit --project=mobile-safari`.
6. Open a pull request: the CI jobs `checks`, `integration` and `audit` must be green, and the Vercel Preview built with "Skipping database migrations" in its log.

## Publishing (needs the owner's approval)

1. Merge the pull request into `main` (fast-forward or merge commit). Vercel builds Production; the build applies pending migrations before `next build` (additive only).
2. Wait for the deployment to be Ready.
3. `GET /api/health`: `commit` is the merged commit, `status` is `ok` (liveness). Then `GET /api/health/ready?fresh=1` with `Authorization: Bearer <GLOSS_HEALTH_TOKEN>`: `database` is `ok` (the token is typed at a hidden prompt, never in the URL or a shared shell history).
4. `node scripts/ai-smoke.mjs https://<site>` (8 checks against the real provider; costs a fraction of a cent).
5. In a browser: open the site, sign in with Google, import a text, ask one question, run Study notes.
6. Watch `/api/health`, `/api/health/ready` and the **Health** workflow for the next hour.
7. If anything is wrong: `docs/ops/rollback-and-recovery.md`.
