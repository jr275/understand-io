#!/usr/bin/env bash
# Rehearse migration 0007 on a Neon BRANCH, with hidden prompts so the connection string never appears on screen, in the shell history or in chat.
#
#   bash scripts/neon-rehearsal.sh
#
# It asks for (1) the connection string of the STAGING BRANCH (input is hidden), (2) the HOST of production's connection string (only the host,
# for example ep-cool-name-123456.eu-central-1.aws.neon.tech: the script refuses to run if the branch has the same host). Then it runs
# scripts/migration-rehearsal.mjs with the rollback test and leaves the branch one migration behind, so you can run it again with the other kind
# of connection string (pooled or direct). The output goes to the screen and to neon-rehearsal-<time>.txt; it contains counts, hashes and
# PASS/FAIL only, never the connection string, so it is safe to paste back. Run it from the root of a checkout of the PR branch, after `pnpm install`.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f node_modules/drizzle-kit/bin.cjs ] || { echo "Run 'pnpm install' first (the migration tool is missing). Nothing was touched." >&2; exit 2; }
if [ -z "${REHEARSAL_DATABASE_URL:-}" ]; then
  printf 'Connection string of the STAGING BRANCH (input hidden; NOT production): '
  IFS= read -rs REHEARSAL_DATABASE_URL
  echo
fi
if [ -z "${PRODUCTION_HOST:-}" ]; then
  printf 'Host of the PRODUCTION connection string (host only, for example ep-xxx.region.aws.neon.tech): '
  IFS= read -r PRODUCTION_HOST
fi
[ -n "$REHEARSAL_DATABASE_URL" ] && [ -n "$PRODUCTION_HOST" ] || { echo "Both values are needed. Nothing was touched." >&2; exit 2; }
export REHEARSAL_DATABASE_URL
out="neon-rehearsal-$(date +%Y%m%dT%H%M%S).txt"
set +e
node scripts/migration-rehearsal.mjs --confirm-not-production --production-host "$PRODUCTION_HOST" --rollback-test --end-rolled-back 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
set -e
echo
echo "Saved to $out (safe to share: no connection string in it). Exit status of the rehearsal: $status"
echo "Next: delete the staging branch in Neon when you are done."
exit "$status"
