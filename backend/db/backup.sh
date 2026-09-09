#!/usr/bin/env bash
# Dumps the database (DATABASE_URL from .env) to a timestamped file in
# db/backups/, then prunes old backups beyond RETENTION_COUNT.
# Run: npm run db:backup

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

RETENTION_COUNT=14
BACKUP_DIR="db/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT_FILE="$BACKUP_DIR/rits-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

# Custom format: compressed, and restorable with pg_restore regardless of
# how the destination database's schema currently looks.
pg_dump "$DATABASE_URL" -Fc -f "$OUT_FILE"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "Backup saved: $OUT_FILE ($SIZE)"

# Prune: keep only the most recent RETENTION_COUNT backups.
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/rits-*.dump 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt "$RETENTION_COUNT" ]; then
  ls -t "$BACKUP_DIR"/rits-*.dump | tail -n +$((RETENTION_COUNT + 1)) | xargs rm --
  echo "Pruned old backups — kept the $RETENTION_COUNT most recent."
fi
