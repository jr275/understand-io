# Production database: identity, 0007 readiness and recovery (report, 2026-11-02)

**Scope.** A read-only assessment. Nothing was changed: no variable, password, project, migration, deployment or database connection (no credential was used, and none from shell history or earlier conversations).

**Public-repository note.** This is the sanitised version of the report. Hostnames, account e-mails, organisation and project names and deployment identifiers are deliberately left out; the complete version is kept privately by the owner. The analysis, timeline, evidence and recommendations are unchanged. "The candidate" below means the Neon pooled endpoint named in the private version.

**One-line answer.** Production runs on a Neon PostgreSQL that is *probably* a pooled endpoint in AWS us-east-1, the one used on 2026-10-19. The application is healthy. Nobody can currently *administer* that database from the Neon account reachable on the working machine: that is the blocker, not the schema.

## 1. Current production status

| Item | Value | How known |
| --- | --- | --- |
| Live deployment | latest production deployment, READY, built from `main` | Vercel API (read) |
| Commit | `57d9a76`, deployed 2026-10-30 05:19 UTC; `/api/health` agrees | Vercel API |
| Aliases | the public `understand-io` alias plus two project aliases | Vercel API |
| Health (19:44 UTC today) | `status ok`, `database ok`, function region `iad1`, storage 8.3 MB of 1,024 MB, AI configured, budget ok, 0 errors | `GET /api/health` |
| Build step of the live deployment | "Applying database migrations (production build)... migrations applied successfully", with `schema "drizzle" already exists, skipping` and `relation "__drizzle_migrations" already exists, skipping` | Vercel build log |
| Database-dependent features answering now | `/api/health` (runs `SELECT 1`, `pg_database_size`, reads `ai_ledger` and `ai_reservations`), `/api/auth/me` (`configured: true`), `/api/documents` (`persisted: true`) | read-only GETs |
| Not exercised today on purpose | reader bootstrap, import, highlight, AI question (all write rows). Last verified with writes on 2026-10-27 (persisted, library intact, AI 8 of 8) | earlier session |

`/api/health` proves a database answers and that the `ai_*` tables (migration 0006) exist. **It does not prove which database it is**, and this report does not use it for identity.

## 2. Database identity confidence: PROBABLE (medium-high)

**Candidate:** Neon, pooled endpoint, default database, AWS us-east-1.

| Time (UTC) | Event | Source |
| --- | --- | --- |
| 2026-10-18 01:23 | Vercel project `understand-io` created | Vercel audit log |
| 2026-10-19 02:56 | `drizzle-kit migrate` run from the `gloss` folder against the candidate endpoint; exit 0 | terminal session pasted in chat |
| 2026-10-19 03:13 | `DATABASE_URL` first added to Production (dashboard); more adds 04:31, 04:55 (CLI), 2026-10-21 22:59 (CLI). The candidate is named in the session within minutes of each | Vercel audit log + transcripts |
| 2026-10-27 02:20 | Neon console: password reset on the Understand.io project's role; the old password stopped working and production lost its database (`server-error`) | session record |
| 2026-10-27 02:29 | `DATABASE_URL` updated in the Vercel dashboard ("Submitted a value"); production recovered at 02:32 (writes persisted, library intact) | Vercel audit log + session record |
| 2026-10-30 05:19 | Build of `57d9a76` migrated cleanly through the production URL | Vercel build log |

**What would raise it to CONFIRMED** (needs authorised access, never a pasted secret): from the account that owns the project, read-only, (a) the project name and the endpoint list containing the candidate; (b) `SELECT pg_database_size(current_database())` close to 8.3 MB; (c) the 11 public tables of section 3 and a `drizzle.__drizzle_migrations` table with 7 rows; (d) `count(*)` of `accounts` and `documents` matching what the owner sees signed in.

**Evidence against, stated plainly**

- The candidate is in **no** Neon organisation reachable on the working machine (the CLI and the Neon console show the same single account: two organisations, three projects, none with Understand tables; the recently-deleted list, `GET /projects?recoverable=true`, returns 0 in both).
- The connected mailbox holds Neon mail for **one** account only: created 2026-09-03, with its sign-in e-mail changed on 2026-10-10. So the Understand.io project, if it sits in that account, should be listed and is not. Other projects seen in October sessions are also absent, which points to **another Neon login that is not identified**, or to projects deleted since. A deleted production project is ruled out by the live database.
- The Vercel value is Sensitive: nobody, including the owner, can read it back. Whether it still equals the candidate after the 2026-10-27 reset is inferred from the session record, not observed.
- Not usable as proof: DNS (wildcard), the Neon proxy (answers the same for existing and non-existing endpoints), the health status.

## 3. Migration 0007 readiness

**Verdict: compatible by design and by indirect evidence; not "rehearsed on the real Neon". Safe to apply, not yet safe to *merge* (merging applies it automatically).**

- **Expected schema at 0006 (from `drizzle/` and `schema.ts`, 11 tables):** `readers`, `documents`, `reading_progress`, `annotations`, `glosses`, `settings` (0000); `accounts` (0001); `rate_hits` (0005); `ai_ledger`, `ai_reservations`, `ai_leases` (0006). 0002 to 0004 create no table.
- **Production's state, indirectly:** the live build's `drizzle-kit migrate` exits 0 only after applying every pending entry of the 7-entry journal (0000 to 0006), and health reads the 0006 tables. Not read directly: `drizzle.__drizzle_migrations`.
- **What 0007 does:** one `CREATE TABLE "analytics_events"` (identity bigint key, `jsonb` default) and three `CREATE INDEX` on it. No `ALTER`, no data change, no foreign key. The name appears nowhere in `schema.ts` on `main` or in earlier migrations (no collision). The journal timestamp (2026-11-02) is after 0006's, so Drizzle treats it as pending.
- **Privileges:** the role must create a table and indexes in `public`. It already created 11 tables and ran 0006 on 2026-10-27 through this same string, so this holds.
- **Pooler:** migrations already run through the pooled endpoint (2026-10-19 and every production build), so 0007 adds no new connection-mode risk.
- **Rehearsal done:** 12 of 12 on an isolated PostgreSQL 16 in production's state (`docs/ops/migration-rehearsal.md`). **Not done:** the Neon branch rehearsal (`docs/ops/neon-staging-runbook.md`), blocked by the access problem below. The Neon PostgreSQL major version of production is unknown.
- **Rollback:** `DROP TABLE analytics_events` plus deleting its row from `drizzle.__drizzle_migrations`, in one transaction (documented). Neon Free restores only 6 hours of history, so a pre-merge logical backup is the real safety net.
- **Also:** Mission 06's proposed guard migration is named `0007_...draft`; renumber it 0008 if promoted.

## 4. Recovery blockers

1. **No identified owner account/login for the Neon project** (section 2). Without it: no console, no backup, no branch, no password rotation under control, no rehearsal.
2. **No backup under our control.** Free plan: 6 hours of restore history, no automatic long-term backup. No logical dump has been made from this database.
3. **The production string is unreadable** (Sensitive). Rotating or moving the database needs the owner to hold the new string; a rollback to the old one is impossible unless it is stored somewhere before any change.
4. **Credential hygiene debt:** database credentials shown in earlier sessions must be treated as exposed. The reset of 2026-10-27 covers the Understand.io role; the same rotation is still due for an unrelated project's role.
5. **Free-plan single point of failure:** 100 CU-hours a month per project and a 1 GB cap. Exhaustion would make the database unreachable, with no alert today other than `/api/health`.

**Can the project be recovered through the original Neon account?** Recovery as such is not needed: the database is alive. What is needed is *login* to the account that owns it. If the project had been deleted, Neon keeps it recoverable for 7 days through the CLI or API (`neonctl projects list --recoverable-only`, `neonctl projects recover <id>`; no console flow documented); after that, deletion is permanent. Today's recoverable list is empty in both visible organisations. If a different account holds it, ask Neon support only after the owner proves control of that account's e-mail; Neon cannot be asked to expose a connection string.

## 5. Recommended next action (single, in order)

1. **Owner finds the Neon login that opens the Understand.io project** (check the other e-mail addresses and sign-in providers used on 2026-10-18/19 and 2026-10-27; search all mailboxes for Neon mail from those dates; browser history for the Neon console). Send back only: the project name, the account e-mail and the endpoint list, through a private channel. No string.
2. With that access, **before anything else**: (a) take a logical backup (`pg_dump`, hidden prompt, stored in the password manager's vault or an encrypted bucket); (b) record the current connection string there too; (c) add a second owner to the organisation (or transfer the project into the main organisation; verify in Neon's current docs) so governance is in one account with a second human recovery path.
3. Run the **read-only identity checks** of section 2 and the **Neon branch rehearsal**; then update verdict B in `docs/release/FASE_8_REPORT.md`.
4. **Only then** decide on merging PR #12 (which deploys and applies 0007). Do not merge while the database cannot be backed up.

Not recommended now: rotating `DATABASE_URL`, creating a replacement project, or migrating provider. Fallback if no account can be found: create a new Neon project in the controlled account and accept re-import of the few existing readers' texts (database is 8.3 MB); that is an owner decision with data-loss implications.

## 6. Architecture proposal: Neon or Cloud SQL (not executed)

Assumptions: database 8.3 MB now, under 250 MB with analytics at its cap (5,000 events a day, 120 days); one Vercel project, functions in `iad1`; `postgres-js` with `max: 5` per instance and `prepare: false`. Prices are public list figures read on 2026-11-02 from [Neon plans](https://neon.com/docs/introduction/plans) and third-party Cloud SQL trackers; Cloud SQL storage and backup rates were **not** confirmed on Google's page, so confirm in the [Google Cloud calculator](https://cloud.google.com/products/calculator) before deciding.

| Dimension | Keep Neon | Cloud SQL for PostgreSQL |
| --- | --- | --- |
| Monthly cost (estimate) | Free: $0 (100 CU-hours, 1 GB). Launch: $0.106 per CU-hour, $0.35 per GB-month; an always-on 0.25 CU is about 182 CU-hours, about **$19**, less with scale to zero; storage cents | Shared-core `db-g1-small` about **$26** (about $0.035 an hour, no SLA, no committed-use discount) plus 10 GB SSD and backups (a few dollars). Dedicated 1 vCPU, 3.75 GB about **$49**. HA doubles compute. Expect **$30 to $80** all in, plus egress to Vercel |
| Backups | Free 6 hours restore; Launch 7 days; Scale 30 days (history billed $0.20 per GB-month of changes). Branches are not backups: add a nightly `pg_dump` to a bucket | Daily automated backups and point-in-time recovery (a new instance on restore); retention is configurable, defaults to confirm |
| Pooling | Built in (PgBouncer, `-pooler` host); the app already uses `prepare: false` | Managed pooling exists only on **Enterprise Plus** (transaction mode, prepared statements off by default): out of budget. Otherwise self-run PgBouncer, or rely on `max: 5` per instance against the connection cap of a small tier |
| Latency (not measured) | Same metro as `iad1` (us-east-1), expected low single-digit ms; first query after idle pays a compute wake of about a second (connect timeout is 5 s) | us-east4 near `iad1`, cross-cloud over the internet, expected a few ms, no cold start; TLS handshake per new connection |
| Connectivity | Public endpoint with TLS, nothing to allow-list | Public IP; Vercel's egress addresses are not fixed, so either `0.0.0.0/0` with SSL and a strong password (weak) or the Cloud SQL connector with IAM through Vercel OIDC (needs a driver change from `postgres-js`) |
| Migration complexity | None | New instance, `pg_dump` and `pg_restore` (minutes at 8 MB), write freeze or a short maintenance window, env update, redeploy, connection-mode and `sslmode` testing, new alerts |
| Rollback | Not applicable | Keep Neon untouched and read-only for 72 hours; roll back by pointing `DATABASE_URL` back and replaying writes made on GCP by a reverse dump. **Impossible today** unless the current string is first saved (blocker 3) |
| Governance risk | Same account problem (blocker 1) until fixed | Ownership would be clean from day one, but the old data's owner is still unknown |

**Recommendation:** stay on Neon, recover control of the existing account, back it up, and move to a paid Launch plan only if the 6-hour restore window or the Free compute cap becomes a concern. Cloud SQL costs 2 to 5 times more here, adds pooling and networking work that Neon gives for free, and does not fix the real problem (access to the current database). Revisit when an SLA, GCP credits, a VPC requirement or a compliance need appears.
