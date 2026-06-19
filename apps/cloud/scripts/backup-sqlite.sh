#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_CLOUD_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_CLOUD_ENV_FILE:-${HOME}/.config/misell-cloud/env}"
BACKUP_DIR="${MISELL_CLOUD_BACKUP_DIR:-${HOME}/.local/share/misell-cloud/backups}"
RETENTION_DAYS="${MISELL_CLOUD_BACKUP_RETENTION_DAYS:-30}"
DB_PATH="${DB_PATH:-}"
COMPRESS="${MISELL_CLOUD_BACKUP_COMPRESS:-1}"
VERIFY="${MISELL_CLOUD_BACKUP_VERIFY:-1}"
S3_URI="${MISELL_CLOUD_BACKUP_S3_URI:-}"
S3_ENDPOINT_URL="${MISELL_CLOUD_BACKUP_S3_ENDPOINT_URL:-}"
S3_STORAGE_CLASS="${MISELL_CLOUD_BACKUP_S3_STORAGE_CLASS:-}"
S3_SSE="${MISELL_CLOUD_BACKUP_S3_SSE:-}"
AWS_CLI="${MISELL_CLOUD_BACKUP_AWS_CLI:-aws}"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup-sqlite.sh [--backup-dir DIR] [--retention-days DAYS] [--s3-uri s3://bucket/prefix]

Creates a timestamped SQLite backup using sqlite3 .backup so the running WAL
database can be copied consistently. If MISELL_CLOUD_BACKUP_S3_URI or
--s3-uri is set, uploads the backup and its manifest with AWS CLI compatible
`aws s3 cp`.
EOF
}

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi
BACKUP_DIR="${MISELL_CLOUD_BACKUP_DIR:-${BACKUP_DIR}}"
RETENTION_DAYS="${MISELL_CLOUD_BACKUP_RETENTION_DAYS:-${RETENTION_DAYS}}"
COMPRESS="${MISELL_CLOUD_BACKUP_COMPRESS:-${COMPRESS}}"
VERIFY="${MISELL_CLOUD_BACKUP_VERIFY:-${VERIFY}}"
S3_URI="${MISELL_CLOUD_BACKUP_S3_URI:-${S3_URI}}"
S3_ENDPOINT_URL="${MISELL_CLOUD_BACKUP_S3_ENDPOINT_URL:-${S3_ENDPOINT_URL}}"
S3_STORAGE_CLASS="${MISELL_CLOUD_BACKUP_S3_STORAGE_CLASS:-${S3_STORAGE_CLASS}}"
S3_SSE="${MISELL_CLOUD_BACKUP_S3_SSE:-${S3_SSE}}"
AWS_CLI="${MISELL_CLOUD_BACKUP_AWS_CLI:-${AWS_CLI}}"

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
    --s3-uri)
      S3_URI="$2"
      shift 2
      ;;
    --s3-endpoint-url)
      S3_ENDPOINT_URL="$2"
      shift 2
      ;;
    --s3-storage-class)
      S3_STORAGE_CLASS="$2"
      shift 2
      ;;
    --s3-sse)
      S3_SSE="$2"
      shift 2
      ;;
    --aws-cli)
      AWS_CLI="$2"
      shift 2
      ;;
    --no-compress)
      COMPRESS=0
      shift
      ;;
    --no-verify)
      VERIFY=0
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

DB_PATH="${DB_PATH:-${APP_DIR}/data/misell-cloud.sqlite}"
if [[ ! -f "${DB_PATH}" ]]; then
  echo "DB not found: ${DB_PATH}" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for consistent backups" >&2
  exit 1
fi
if [[ -n "${S3_URI}" && ! "${S3_URI}" =~ ^s3://[^/]+(/.*)?$ ]]; then
  echo "MISELL_CLOUD_BACKUP_S3_URI must start with s3://bucket or s3://bucket/prefix" >&2
  exit 1
fi
if [[ -n "${S3_URI}" ]]; then
  if [[ ! -x "${AWS_CLI}" ]] && ! command -v "${AWS_CLI}" >/dev/null 2>&1; then
    echo "aws CLI is required when S3 backup upload is enabled" >&2
    exit 1
  fi
fi

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "${value}"
}

checksum_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file}" | awk '{print $1}'
  else
    echo "sha256sum or shasum is required to write backup manifests" >&2
    exit 1
  fi
}

upload_to_s3() {
  local file="$1"
  local destination="$2"
  local -a aws_args=()
  if [[ -n "${S3_ENDPOINT_URL}" ]]; then
    aws_args+=(--endpoint-url "${S3_ENDPOINT_URL}")
  fi
  aws_args+=(s3 cp "${file}" "${destination}" --only-show-errors)
  if [[ -n "${S3_STORAGE_CLASS}" ]]; then
    aws_args+=(--storage-class "${S3_STORAGE_CLASS}")
  fi
  if [[ -n "${S3_SSE}" ]]; then
    aws_args+=(--sse "${S3_SSE}")
  fi
  "${AWS_CLI}" "${aws_args[@]}"
}

mkdir -p "${BACKUP_DIR}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
TARGET="${BACKUP_DIR}/misell-cloud-${STAMP}.sqlite"

sqlite3 "${DB_PATH}" ".backup '${TARGET}'"
chmod 600 "${TARGET}" 2>/dev/null || true

INTEGRITY_RESULT="skipped"
if [[ "${VERIFY}" != "0" ]]; then
  INTEGRITY_RESULT="$(sqlite3 "${TARGET}" "PRAGMA integrity_check;" | tr -d '\r')"
  if [[ "${INTEGRITY_RESULT}" != "ok" ]]; then
    echo "SQLite backup integrity check failed: ${INTEGRITY_RESULT}" >&2
    rm -f "${TARGET}"
    exit 1
  fi
fi

if [[ "${COMPRESS}" != "0" ]] && command -v gzip >/dev/null 2>&1; then
  gzip -f "${TARGET}"
  TARGET="${TARGET}.gz"
fi

SIZE_BYTES="$(wc -c < "${TARGET}" | tr -d ' ')"
SHA256="$(checksum_file "${TARGET}")"
MANIFEST="${TARGET}.manifest.json"
cat > "${MANIFEST}" <<EOF
{
  "created_at": "${CREATED_AT}",
  "backup_file": "$(json_escape "$(basename "${TARGET}")")",
  "source_db_path": "$(json_escape "${DB_PATH}")",
  "size_bytes": ${SIZE_BYTES},
  "sha256": "${SHA256}",
  "compressed": $([[ "${TARGET}" == *.gz ]] && echo true || echo false),
  "sqlite_integrity_check": "$(json_escape "${INTEGRITY_RESULT}")"
}
EOF
chmod 600 "${MANIFEST}" 2>/dev/null || true

S3_TARGET=""
if [[ -n "${S3_URI}" ]]; then
  S3_PREFIX="${S3_URI%/}"
  S3_TARGET="${S3_PREFIX}/$(basename "${TARGET}")"
  upload_to_s3 "${TARGET}" "${S3_TARGET}"
  upload_to_s3 "${MANIFEST}" "${S3_TARGET}.manifest.json"
fi

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'misell-cloud-*.sqlite*' \
  -mtime "+${RETENTION_DAYS}" \
  -delete

echo "backup=${TARGET}"
echo "manifest=${MANIFEST}"
if [[ -n "${S3_TARGET}" ]]; then
  echo "s3_backup=${S3_TARGET}"
  echo "s3_manifest=${S3_TARGET}.manifest.json"
fi
