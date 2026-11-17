#!/usr/bin/env bash
# Kept so that existing instructions still work: the backup is now scripts/db-backup.mjs (PostgreSQL 18 aware, checksummed, verifiable).
#   DATABASE_URL='<DIRECT Neon connection string>' scripts/db-backup.sh [directory]
set -euo pipefail
command -v node >/dev/null || { echo "node is not installed." >&2; exit 2; }
exec node "$(dirname "$0")/db-backup.mjs" "$@"
