#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_CLOUD_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_CLOUD_ENV_FILE:-${HOME}/.config/misell-cloud/env}"
BACKUP_DIR="${MISELL_CLOUD_BACKUP_DIR:-${HOME}/.local/share/misell-cloud/backups}"
RETENTION_DAYS="${MISELL_CLOUD_BACKUP_RETENTION_DAYS:-30}"
DB_PATH="${DB_PATH:-}"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup-sqlite.sh [--backup-dir DIR] [--retention-days DAYS]

Creates a timestamped SQLite backup using sqlite3 .backup so the running WAL
database can be copied consistently.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --retention-days)
      RETENTION_DAYS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

DB_PATH="${DB_PATH:-${APP_DIR}/data/misell-cloud.sqlite}"
if [[ ! -f "${DB_PATH}" ]]; then
  echo "DB not found: ${DB_PATH}" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for consistent backups" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
TARGET="${BACKUP_DIR}/misell-cloud-${STAMP}.sqlite"

sqlite3 "${DB_PATH}" ".backup '${TARGET}'"
chmod 600 "${TARGET}" 2>/dev/null || true

if command -v gzip >/dev/null 2>&1; then
  gzip -f "${TARGET}"
  TARGET="${TARGET}.gz"
fi

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'misell-cloud-*.sqlite*' \
  -mtime "+${RETENTION_DAYS}" \
  -delete

echo "backup=${TARGET}"
