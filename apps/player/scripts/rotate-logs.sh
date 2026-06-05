#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="${MISELL_LOG_DIR:-${APP_DIR}/logs}"
MAX_BYTES="${MISELL_LOG_ROTATE_MAX_BYTES:-52428800}"
RETENTION_DAYS="${MISELL_LOG_RETENTION_DAYS:-30}"
FORCE=0

usage() {
  cat <<'EOF'
Usage:
  scripts/rotate-logs.sh [--force]

Environment:
  MISELL_LOG_DIR=logs path
  MISELL_LOG_ROTATE_MAX_BYTES=52428800
  MISELL_LOG_RETENTION_DAYS=30
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
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

file_size_bytes() {
  local file="$1"
  stat -c '%s' "${file}" 2>/dev/null || stat -f '%z' "${file}"
}

rotate_file() {
  local file="$1"
  [[ -f "${file}" ]] || return 0

  local size
  size="$(file_size_bytes "${file}")"
  if [[ "${size}" -eq 0 ]]; then
    return 0
  fi
  if [[ "${FORCE}" != "1" && "${size}" -lt "${MAX_BYTES}" ]]; then
    return 0
  fi

  local stamp rotated
  stamp="$(date '+%Y%m%d-%H%M%S')"
  rotated="${file}.${stamp}"
  mv "${file}" "${rotated}"
  : > "${file}"
  chmod 600 "${file}" 2>/dev/null || true

  if command -v gzip >/dev/null 2>&1; then
    gzip -f "${rotated}"
    rotated="${rotated}.gz"
  fi

  echo "rotated ${file} -> ${rotated}"
}

mkdir -p "${LOG_DIR}"

rotate_file "${LOG_DIR}/playlog.jsonl"
rotate_file "${LOG_DIR}/admin.log"
rotate_file "${LOG_DIR}/error.log"
rotate_file "${LOG_DIR}/burn-in.log"
rotate_file "${LOG_DIR}/heartbeat.log"

find "${LOG_DIR}" -maxdepth 1 -type f \
  \( -name '*.log.*' -o -name '*.jsonl.*' -o -name '*.log.*.gz' -o -name '*.jsonl.*.gz' \) \
  -mtime "+${RETENTION_DAYS}" \
  -delete
