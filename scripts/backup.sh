#!/usr/bin/env bash
# Backup script for SAC — backs up PostgreSQL database and Supabase Storage
# Usage: ./scripts/backup.sh
# Requirements: 44.1, 44.2, 40.5

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54322/postgres}"
STORAGE_BUCKET="${STORAGE_BUCKET:-transaction-attachments}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"

mkdir -p "$BACKUP_DIR"

# Database backup
echo "[backup] Dumping PostgreSQL database..."
pg_dump "$DB_URL" --no-owner --no-acl --format=custom \
  --file="${BACKUP_DIR}/db-${TIMESTAMP}.pgdump" \
  && echo "[backup] Database saved to ${BACKUP_DIR}/db-${TIMESTAMP}.pgdump"

# Retention: keep only the last 7 daily backups
find "$BACKUP_DIR" -name 'db-*.pgdump' | sort | head -n -7 | xargs -r rm --

# Storage backup (requires Supabase CLI with project linked)
if [ -n "$SUPABASE_PROJECT_REF" ]; then
  echo "[backup] Backing up storage bucket ${STORAGE_BUCKET}..."
  supabase storage cp "ss://${STORAGE_BUCKET}" "${BACKUP_DIR}/storage-${TIMESTAMP}" \
    --project-ref "$SUPABASE_PROJECT_REF" --recursive \
    && echo "[backup] Storage saved to ${BACKUP_DIR}/storage-${TIMESTAMP}"
else
  echo "[backup] SUPABASE_PROJECT_REF not set — skipping storage backup."
fi

echo "[backup] Done."
