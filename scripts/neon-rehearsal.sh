#!/usr/bin/env bash
# Rehearse migration 0007 on a Neon BRANCH, with hidden prompts so the connection string never appears on screen, in the shell history or in chat.
#
#   bash scripts/neon-rehearsal.sh [--guard-only]
#
# The rehearsal changes the database it is given, so this script fails closed: it asks for FIVE things and refuses to go on unless the guard
# (scripts/lib/rehearsal-guard.mjs) accepts them, before any connection is made:
#   1. the connection string of the STAGING BRANCH (input hidden; NOT production),
#   2. the name of that branch (staging-<name>),
#   3. the endpoint id of that branch, read from the branch page of the Neon console (ep-<word>-<word>-<8 characters>),
#   4. the endpoint id (or host) of PRODUCTION; several may be given, separated by commas. Read-only: it is only compared, never connected to,
#   5. the confirmation <branch>@<endpoint>, typed, which ties the branch to the endpoint the connection string reaches.
# The guard identifies a target by its endpoint id, so the pooled and the direct form of one endpoint, a host with a port, upper case, a trailing
# dot or parameters on the string cannot be told apart from production by luck. Production, anything that looks like production, anything that
# cannot be read, and any missing value stop the run with exit 2 and nothing touched. There is no fallback.
# --guard-only checks the five values and stops: no connection, nothing touched. Use it first.
# Then it runs scripts/migration-rehearsal.mjs with the rollback test and leaves the branch one migration behind, so you can run it again with the
# other kind of connection string (pooled or direct). The output goes to the screen and to neon-rehearsal-<time>.txt; it contains counts, hashes and
# PASS/FAIL only, never the connection string, so it is safe to paste back. Run it from the root of a checkout of the PR branch, after `pnpm install`.
set -euo pipefail
cd "$(dirname "$0")/.."

guard_only=0
if [ "${1:-}" = "--guard-only" ] && [ "$#" -eq 1 ]; then
  guard_only=1
elif [ "$#" -ne 0 ]; then
  echo "Only --guard-only is accepted. Nothing was touched." >&2
  exit 2
fi
if [ -n "${PRODUCTION_HOST:-}" ]; then
  echo "PRODUCTION_HOST is no longer accepted: a host string cannot identify production. Use PRODUCTION_ENDPOINT (see docs/ops/neon-staging-runbook.md). Nothing was touched." >&2
  exit 2
fi
[ -f node_modules/postgres/package.json ] || { echo "Run 'pnpm install' first. Nothing was touched." >&2; exit 2; }
if [ "$guard_only" -eq 0 ]; then
  [ -f node_modules/drizzle-kit/bin.cjs ] || { echo "Run 'pnpm install' first (the migration tool is missing). Nothing was touched." >&2; exit 2; }
fi

if [ -z "${REHEARSAL_DATABASE_URL:-}" ]; then
  printf 'Connection string of the STAGING BRANCH (input hidden; NOT production): '
  IFS= read -rs REHEARSAL_DATABASE_URL || true
  echo
fi
ask() { # ask NAME PROMPT: keep the value already in the environment, otherwise read it
  if [ -z "${!1:-}" ]; then
    printf '%s' "$2"
    IFS= read -r "$1" || true
  fi
}
ask STAGING_BRANCH 'Name of the staging branch (for example staging-0007): '
ask STAGING_ENDPOINT 'Endpoint id of that branch, from the branch page in the console (ep-...-xxxxxxxx): '
ask PRODUCTION_ENDPOINT 'Endpoint id (or host) of PRODUCTION, comma separated if more than one: '
ask CONFIRMATION "Type <branch>@<endpoint> (for example ${STAGING_BRANCH:-staging-0007}@${STAGING_ENDPOINT:-ep-...}) to confirm this is NOT production: "
for name in REHEARSAL_DATABASE_URL STAGING_BRANCH STAGING_ENDPOINT PRODUCTION_ENDPOINT CONFIRMATION; do
  [ -n "${!name:-}" ] || { echo "$name is empty. All five values are needed. Nothing was touched." >&2; exit 2; }
done
export REHEARSAL_DATABASE_URL

prod_args=()
IFS=',' read -ra production_list <<<"$PRODUCTION_ENDPOINT"
for entry in "${production_list[@]}"; do prod_args+=(--production-endpoint "$entry"); done
common=(--confirm-not-production --staging-branch "$STAGING_BRANCH" --staging-endpoint "$STAGING_ENDPOINT" "${prod_args[@]}" --confirm "$CONFIRMATION")

# Step 1: the guard alone. No connection is made. A refusal exits 2 here (set -e) and nothing has been touched.
node scripts/migration-rehearsal.mjs "${common[@]}" --guard-only
if [ "$guard_only" -eq 1 ]; then exit 0; fi

# Step 2: the rehearsal (the script runs the guard again, with the strict domain list, before it opens a connection).
out="neon-rehearsal-$(date +%Y%m%dT%H%M%S).txt"
set +e
node scripts/migration-rehearsal.mjs "${common[@]}" --rollback-test --end-rolled-back 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
set -e
echo
echo "Saved to $out (safe to share: no connection string in it). Exit status of the rehearsal: $status"
echo "Next: delete the staging branch in Neon when you are done."
exit "$status"
