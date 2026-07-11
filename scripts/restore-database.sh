#!/usr/bin/env bash
# Database restore script (Phase 3 - Backups & Disaster Recovery).
#
# Restores a backup created by ./scripts/backup-database.sh into
# DATABASE_URL. Intentionally requires an explicit `--yes`/`-y` flag to
# proceed without a confirmation prompt, since this is a destructive
# operation on whatever database DATABASE_URL points at.
#
# Usage:
#   ./scripts/restore-database.sh backups/school_erp_20260711_120000.sql.gz
#   DATABASE_URL="postgresql://..." ./scripts/restore-database.sh <file> --yes
#
# Requires: psql (from the postgresql-client package) on PATH.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_FILE=""
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=true ;;
    *) BACKUP_FILE="$arg" ;;
  esac
done

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-backup.sql.gz> [--yes]" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ] && [ -f "$REPO_ROOT/backend/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$REPO_ROOT/backend/.env"; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set (checked env and backend/.env)." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql not found on PATH. Install the postgresql-client package." >&2
  exit 1
fi

# Strip Prisma's "?schema=public" query param - libpq/psql doesn't
# understand it as a connection URI parameter (see the matching note in
# backup-database.sh).
PG_DATABASE_URL="$(echo "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"

# Mask the password portion of the connection string for display only.
DISPLAY_URL="$(echo "$PG_DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1****\2#')"

echo "About to restore:"
echo "  Backup file: $BACKUP_FILE"
echo "  Target DB:   $DISPLAY_URL"
echo
echo "WARNING: this will run the backup's SQL against the target database."
echo "Existing objects with the same name may be overwritten/duplicated"
echo "depending on the backup's contents - this is NOT a clean wipe-and-restore,"
echo "it is a straight SQL replay. For a guaranteed clean restore, point"
echo "DATABASE_URL at a fresh/empty database."

if [ "$ASSUME_YES" != true ]; then
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Restoring $BACKUP_FILE into target database"
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | psql "$PG_DATABASE_URL" --set ON_ERROR_STOP=on
else
  psql "$PG_DATABASE_URL" --set ON_ERROR_STOP=on -f "$BACKUP_FILE"
fi

echo "==> Restore complete. Verifying a few core tables exist..."
psql "$PG_DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" \
  | xargs -I{} echo "    {} tables found in public schema"

echo "==> Done. Run 'npm run db:generate --prefix db' if the Prisma client needs regenerating for this schema."
