#!/usr/bin/env bash
# Restores a backup created by backup.sh into DATABASE_URL (from .env).
# DESTRUCTIVE: drops and recreates every object in the target database
# before restoring — everything currently in it is replaced.
# Run: npm run db:restore -- db/backups/rits-<timestamp>.dump

set -euo pipefail
cd "$(dirname "$0")/.."   # backend/

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set — check your .env file." >&2
  exit 1
fi

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: npm run db:restore -- <path-to-backup.dump>" >&2
  echo "Available backups:" >&2
  ls -1t db/backups/rits-*.dump 2>/dev/null >&2 || echo "  (none found in db/backups/)" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

echo "This will REPLACE everything currently in the database at:"
echo "  $DATABASE_URL"
echo "with the contents of:"
echo "  $FILE"
echo
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Cancelled — nothing was changed."
  exit 1
fi

pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$FILE"
echo "Restore complete."
