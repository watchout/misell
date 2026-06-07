#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"
DATA_DIR="${MISELL_DATA_DIR:-${APP_DIR}/data}"
ASSETS_DIR="${MISELL_ASSETS_DIR:-${APP_DIR}/assets}"
GENERATED_DIR="${MISELL_GENERATED_DIR:-${DATA_DIR}/generated}"
PLAYLIST_PATH="${MISELL_PLAYLIST_PATH:-${DATA_DIR}/playlist.json}"
DEVICE_CONFIG_PATH="${MISELL_DEVICE_CONFIG_PATH:-${DATA_DIR}/config.json}"
BACKUP_DIR="${MISELL_CONTENT_BACKUP_DIR:-${HOME}/.local/share/misell-player/backups}"
RETENTION="${MISELL_CONTENT_BACKUP_RETENTION:-30}"
REASON="manual"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup-content.sh [--reason REASON] [--backup-dir DIR] [--retention N]

Creates a versioned tar.gz backup containing playlist.json, config.json,
generated PR cuts, and local assets for restore or migration work.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason)
      REASON="$2"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --retention)
      RETENTION="$2"
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
  DATA_DIR="${MISELL_DATA_DIR:-${DATA_DIR}}"
  ASSETS_DIR="${MISELL_ASSETS_DIR:-${ASSETS_DIR}}"
  GENERATED_DIR="${MISELL_GENERATED_DIR:-${DATA_DIR}/generated}"
  PLAYLIST_PATH="${MISELL_PLAYLIST_PATH:-${PLAYLIST_PATH}}"
  DEVICE_CONFIG_PATH="${MISELL_DEVICE_CONFIG_PATH:-${DEVICE_CONFIG_PATH}}"
  BACKUP_DIR="${MISELL_CONTENT_BACKUP_DIR:-${BACKUP_DIR}}"
  RETENTION="${MISELL_CONTENT_BACKUP_RETENTION:-${RETENTION}}"
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required for content backups" >&2
  exit 1
fi

safe_reason="$(printf '%s' "${REASON}" | tr -c 'A-Za-z0-9_.:-' '-' | cut -c1-80)"
safe_reason="${safe_reason:-manual}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="misell-content-${timestamp}-${safe_reason}.tar.gz"
temp_dir="$(mktemp -d)"
trap 'rm -rf "${temp_dir}"' EXIT

mkdir -p "${BACKUP_DIR}" "${temp_dir}/data/generated" "${temp_dir}/assets/images" "${temp_dir}/assets/videos"

[[ -f "${PLAYLIST_PATH}" ]] && cp "${PLAYLIST_PATH}" "${temp_dir}/data/playlist.json"
[[ -f "${DEVICE_CONFIG_PATH}" ]] && cp "${DEVICE_CONFIG_PATH}" "${temp_dir}/data/config.json"
[[ -d "${GENERATED_DIR}" ]] && cp -R "${GENERATED_DIR}/." "${temp_dir}/data/generated/"
[[ -d "${ASSETS_DIR}/images" ]] && cp -R "${ASSETS_DIR}/images/." "${temp_dir}/assets/images/"
[[ -d "${ASSETS_DIR}/videos" ]] && cp -R "${ASSETS_DIR}/videos/." "${temp_dir}/assets/videos/"

cat > "${temp_dir}/backup-manifest.json" <<EOF
{
  "app": "misell-player",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "reason": "${safe_reason}",
  "playlist_path": "${PLAYLIST_PATH}",
  "device_config_path": "${DEVICE_CONFIG_PATH}",
  "assets_dir": "${ASSETS_DIR}",
  "generated_dir": "${GENERATED_DIR}"
}
EOF

tar -czf "${BACKUP_DIR}/${target}" -C "${temp_dir}" .

if [[ "${RETENTION}" =~ ^[0-9]+$ && "${RETENTION}" -gt 0 ]]; then
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'misell-content-*.tar.gz' -print0 \
    | xargs -0 ls -t 2>/dev/null \
    | tail -n +"$((RETENTION + 1))" \
    | xargs rm -f 2>/dev/null || true
fi

echo "backup=${BACKUP_DIR}/${target}"
