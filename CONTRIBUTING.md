# Contributing to Understand.io

## Branches

`main` is the only long-lived branch. It is production-ready, and a push to it deploys production, so nothing is pushed to it directly: every change reaches `main` through a pull request.

| Branch                         | Use                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `feature/<topic>`              | a new capability                                                              |
| `fix/<topic>`                  | a targeted defect fix                                                         |
| `chore/<topic>`                | tooling, CI, dependencies, repository maintenance                             |
| `docs/<topic>`, `test/<topic>` | documentation only, tests only                                                |
| `release/<name>`               | only when a release needs preparation of its own (a hotfix, a staged rollout) |

There is no `develop` branch: there is a single deployable line and every branch already gets its own preview deployment. Keep a branch short-lived and based on current `main`. One branch, one concern: do not mix unrelated features or missions in a branch or in a commit.

Never force-push a shared branch, never rewrite published history without a maintainer's decision, and never delete a branch that holds work that is not in `main` (check with `git cherry origin/main <branch>`).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `perf:`, `test:`, `docs:`, `chore:`, `ci:`, `security:`. One logical change per commit, with a message that says why.

## Pull requests

- Open it as a draft until the checks pass. Describe what changes, what was tested and what was not.
- The CI jobs `checks`, `integration` and `audit` must be green, and the Vercel preview must build. Do not weaken a check to make it pass: fix the cause.
- Run the release checklist in [`docs/ops/release-checklist.md`](docs/ops/release-checklist.md) before asking for a merge. Recovery steps are in [`docs/ops/rollback-and-recovery.md`](docs/ops/rollback-and-recovery.md).
- A change that adds a migration needs an explicit database-compatibility statement in the pull request. Migrations are additive; a later migration's journal `when` must be greater than the previous one or Drizzle skips it silently.

## What never goes in the repository

- Secrets and credentials of any kind, `.env*` files (only `.env.example`, with names and no values), database dumps, logs, infrastructure state files.
- Environment-specific operational detail: real hostnames, account or project identifiers, database endpoints, plan limits, the state of a specific deployment. Documents here explain how the code, a migration or a procedure works for any environment; the rest belongs in the private operations repository.

CI scans for committed secrets with the allowlist in `.gitleaks.toml` (stand-in values only). Run `gitleaks detect --config .gitleaks.toml` before pushing anything that touches configuration or documents.

## Working locally

See the README for prerequisites and setup. Always pass an explicit `DATABASE_URL` that points to a disposable database when you run tests or migrations: the default in `.env.local` is a developer database that must not be migrated or reset by tests.

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
```
