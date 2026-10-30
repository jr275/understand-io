#!/usr/bin/env bash
# A logical backup of the database into one file. Read-only (pg_dump only reads); the connection string is never printed.
#
#   DATABASE_URL='<your Neon connection string>' scripts/db-backup.sh [directory]      (default directory: ./backups)
#
# Neon Free keeps only 6 hours of restore history, so this file is the recovery path beyond that: run it weekly and before any risky change,
# and keep the file somewhere private (it holds every reader's texts and notes; it is not encrypted). The short-lived tables (rate counters, leases,
# reservations) are left out. Restore, on a NEW empty database: pg_restore --no-owner -d "<new url>" <file>   (docs/ops/restore-rehearsal.md).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Nothing was read." >&2
  exit 2
fi
command -v pg_dump >/dev/null || { echo "pg_dump is not installed (brew install libpq, or postgresql)." >&2; exit 2; }
dir="${1:-./backups}"
mkdir -p "$dir"
umask 077
file="$dir/understand-$(date -u +%Y%m%d-%H%M%S).dump"

if ! pg_dump --format=custom --no-owner --exclude-table-data=rate_hits --exclude-table-data=ai_leases --exclude-table-data=ai_reservations --file="$file" "$DATABASE_URL" 2>/tmp/db-backup.err; then
  rm -f "$file"
  # pg_dump's message can name the host; print only its first line without the connection string.
  echo "The backup failed: $(head -n 1 /tmp/db-backup.err | sed -E 's#postgres(ql)?://[^ ]+#<url>#g')" >&2
  rm -f /tmp/db-backup.err
  exit 1
fi
rm -f /tmp/db-backup.err

# The archive must be readable and hold the tables that matter.
entries=$(pg_restore --list "$file" | grep -c "TABLE DATA" || true)
for t in documents annotations readers; do
  pg_restore --list "$file" | grep -q "TABLE DATA public $t " || { echo "The file is missing the data of table $t: do not rely on it." >&2; exit 1; }
done
echo "Backup written: $file ($(wc -c <"$file" | tr -d ' ') bytes, $entries tables with data)"
