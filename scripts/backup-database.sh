#!/usr/bin/env bash
# Database backup script (Phase 3 - Backups & Disaster Recovery).
#
# Creates a timestamped, compressed pg_dump of DATABASE_URL and writes
# it to ./backups/ (gitignored - these are runtime artifacts, not
# source). Run this manually or wire it into a cron job / CI schedule
# against your production DATABASE_URL.
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/backup-database.sh
#   ./scripts/backup-database.sh                          # uses .env's DATABASE_URL if present
#   BACKUP_DIR=/mnt/backups ./scripts/backup-database.sh   # custom output directory
#
# Requires: pg_dump (from the postgresql-client package) on PATH.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
# How many days of backups to keep locally before pruning older ones.
# Set to 0 to disable pruning entirely.
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Fall back to reading DATABASE_URL out of backend/.env if it isn't
# already set in the environment - mirrors how backend/scripts/build.sh
# expects DATABASE_URL to be available, just via a local .env instead
# of a deploy platform's injected env var.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$REPO_ROOT/backend/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$REPO_ROOT/backend/.env"; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set (checked env and backend/.env)." >&2
  echo "Usage: DATABASE_URL=\"postgresql://...\" $0" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Error: pg_dump not found on PATH. Install the postgresql-client package." >&2
  exit 1
fi

# Prisma's DATABASE_URL commonly has a `?schema=public` query param,
# which is a Prisma-only convention - libpq (and therefore pg_dump/psql)
# doesn't recognize "schema" as a connection URI parameter and errors
# out on it ("invalid URI query parameter"). Strip it before handing
# the URL to pg_dump; this backs up the whole database (all schemas)
# regardless, which is the correct behavior for a full backup anyway.
PG_DATABASE_URL="$(echo "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/school_erp_${TIMESTAMP}.sql.gz"

echo "==> Backing up database to $OUT_FILE"
# --no-owner/--no-privileges: makes the dump portable across environments
# where the restoring user isn't named identically to the source DB's
# owner (e.g. restoring a Render/Neon dump into a local docker-compose
# Postgres, or vice versa) - otherwise `pg_restore`/psql replay of
# GRANT/OWNER statements can fail with permission errors even though
# the actual data restores fine.
pg_dump "$PG_DATABASE_URL" --no-owner --no-privileges --format=plain | gzip > "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "==> Backup complete: $OUT_FILE ($SIZE)"

# --- Verification ---------------------------------------------------
# A backup nobody has verified is not a backup you can trust - sanity
# check that the file is non-empty and looks like real SQL, not e.g. an
# empty file from a pg_dump that failed silently mid-stream.
if [ ! -s "$OUT_FILE" ]; then
  echo "Error: backup file is empty - treating this backup as FAILED." >&2
  rm -f "$OUT_FILE"
  exit 1
fi

if ! zcat "$OUT_FILE" | head -n 20 | grep -qi "PostgreSQL database dump"; then
  echo "Error: backup file doesn't look like a valid pg_dump output - treating as FAILED." >&2
  exit 1
fi

echo "==> Verification passed (non-empty, valid pg_dump header)"

# --- Retention / pruning ---------------------------------------------
if [ "$RETENTION_DAYS" -gt 0 ]; then
  echo "==> Pruning backups older than $RETENTION_DAYS days in $BACKUP_DIR"
  find "$BACKUP_DIR" -name 'school_erp_*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete
fi

echo "==> Done"
