# The rehearsal guard: what it blocks, what it allows, and what it cannot know

`scripts/migration-rehearsal.mjs` changes the database it is given (it applies a migration, drops the new table and applies it again), so it must never be able to reach production. `scripts/lib/rehearsal-guard.mjs` decides, before any connection, whether a target is acceptable. It is pure (no network, file or environment) and fails closed: anything it cannot answer with a clear yes stops the run, with exit code 2 and nothing touched. All endpoints in the tests are fictional and under `.invalid`, a name that can never resolve.

**How a target is identified.** By its Neon endpoint id (`ep-<word>-<word>-<8 characters>`), read from the host after removing `-pooler`, the port, the domain, case and a trailing dot. Production is identified the same way from whatever the owner types (a host, a host with a port, a URL, or the bare id). Comparing host text is not used, because one endpoint has several spellings.

**Inputs** (`scripts/neon-rehearsal.sh` asks for them; `--guard-only` checks them and stops): the staging connection string (hidden), the branch name (`staging-<name>`), the endpoint id of that branch, the endpoint id or host of production (one or more), and the typed confirmation `<branch>@<endpoint>`.

| Scenario | Result | Code |
| --- | --- | --- |
| The production host, in any spelling: direct, pooled, with a port, in upper case, with a trailing dot, as a full URL, as the bare id; or production's endpoint among several | blocked | `E_IS_PRODUCTION` |
| A staging endpoint that looks like production: one character away, within 3 edits, the same 8-character suffix, or the same two words | blocked (ambiguous) | `E_AMBIGUOUS` |
| A connection string outside the one accepted shape: two hosts, an unencoded `@`, a backslash, whitespace, a fragment, a non-PostgreSQL scheme, no password, no database, an upper-case or look-alike-letter host | blocked | `E_URL` |
| A parameter other than `sslmode`, `channel_binding`, `connect_timeout` (so no `host`, `hostaddr`, `options`, `port`, `dbname`), a repeated parameter, a weak `sslmode` | blocked | `E_URL_PARAMS` |
| A port other than 5432 (a zero-padded one too); an explicit 5432 is allowed | blocked / allowed | `E_PORT` |
| A host that is not a Neon endpoint host (localhost, a number, a wrong id shape), or is outside Neon's domain, or only ends like it | blocked | `E_HOST`, `E_HOST_SUFFIX` |
| A wrong branch: `main`, `production`, `staging`, upper case, `staging-main`, empty, too long | blocked | `E_BRANCH`, `E_BRANCH_MISSING` |
| A branch and endpoint that do not match: a stated endpoint that is not the one in the string, a confirmation naming another branch or endpoint | blocked | `E_ENDPOINT_MISMATCH`, `E_CONFIRMATION` |
| A missing branch, endpoint, production endpoint or confirmation; a production entry that cannot be read | blocked (no fallback) | `E_*_MISSING`, `E_ENDPOINT_FORMAT` |
| The database driver reading the host, port or database differently from the guard | blocked before any query | `E_DRIVER_MISMATCH` |
| A real run given a `.invalid` fixture (only `--guard-only` accepts it) | blocked | `E_HOST_SUFFIX` |
| The removed `--production-host` flag or `PRODUCTION_HOST` variable | blocked | exit 2 |
| A staging endpoint, direct or pooled, unrelated to production, with the stated endpoint and confirmation consistent | **allowed** | |
| Production typed in any spelling while staging is another endpoint | **allowed** | |
| `--local`: `localhost` or `127.0.0.1` and a database named `gloss_<tag>_<number>` or `rehearsal_<name>` | **allowed** | |
| `--local`: the developer database `gloss`, any other name, or a remote host | blocked | `E_LOCAL_DB`, `E_LOCAL_HOST` |

**After the guard.** The child process that migrates inherits no database variable (`PG*`, `DATABASE*`, `POSTGRES*`, `NEON*`, `VERCEL*`). The script stops, changing nothing, unless the database is exactly one migration behind and the last migration is 0007. The rollback drops only `public.analytics_events`, only if it is empty, with no `CASCADE`, and removes exactly one migration record chosen by its journal timestamp, in one transaction that is abandoned otherwise.

**What it cannot know.** It compares against the production endpoint the owner types, and "branch matches endpoint" is the owner's typed statement checked for consistency, not a lookup in Neon (no connection is made). A production database is, by design, in the same state as a valid staging copy (one migration behind), so its contents cannot tell the two apart. So the owner must know production's real endpoint first (gate G1 of `docs/ops/neon-staging-runbook.md`) and follow gate G6. A stricter check against the Neon API (the endpoint belongs to a non-default branch with the stated name) is possible and is not built.

**Tests.** `tests/unit/rehearsalGuard.test.ts` (the rules), `tests/unit/rehearsalCli.test.ts` (the script and the shell wrapper as processes), `tests/unit/rehearsalDatabase.test.ts` (a disposable local PostgreSQL: 13 checks pass; a database that already has 0007, with or without rows, is left untouched; skipped without a local `DATABASE_URL`).
