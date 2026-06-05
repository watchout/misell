#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"
HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
CONTENT_URL="${MISELL_CONTENT_URL:-}"
CONTENT_RESULT_URL="${MISELL_CONTENT_RESULT_URL:-}"
DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
DATA_DIR="${MISELL_DATA_DIR:-${APP_DIR}/data}"
PLAYLIST_PATH="${MISELL_PLAYLIST_PATH:-${DATA_DIR}/playlist.json}"
LOCK_FILE="${MISELL_CONTENT_SYNC_LOCK_FILE:-${HOME}/.local/share/misell-player/content-sync.lock}"
APPLY=1

usage() {
  cat <<'EOF'
Usage:
  scripts/sync-content.sh [--dry-run]

Fetches the active Cloud content manifest for this terminal release channel and
writes playlist.json when the playlist_version differs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      APPLY=0
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

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
  HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-${HEARTBEAT_URL}}"
  CONTENT_URL="${MISELL_CONTENT_URL:-${CONTENT_URL}}"
  CONTENT_RESULT_URL="${MISELL_CONTENT_RESULT_URL:-${CONTENT_RESULT_URL}}"
  DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
  DATA_DIR="${MISELL_DATA_DIR:-${DATA_DIR}}"
  PLAYLIST_PATH="${MISELL_PLAYLIST_PATH:-${PLAYLIST_PATH}}"
fi

derive_content_urls() {
  if [[ -n "${CONTENT_URL}" && -n "${CONTENT_RESULT_URL}" ]]; then
    return 0
  fi
  if [[ "${HEARTBEAT_URL}" == */api/device/heartbeat ]]; then
    local base_url="${HEARTBEAT_URL%/api/device/heartbeat}"
    CONTENT_URL="${CONTENT_URL:-${base_url}/api/device/content-policy}"
    CONTENT_RESULT_URL="${CONTENT_RESULT_URL:-${base_url}/api/device/content-result}"
  fi
}

json_content_value() {
  local field="$1"
  POLICY_JSON="${policy}" FIELD="${field}" node -e '
    const data = JSON.parse(process.env.POLICY_JSON || "{}");
    const content = data.content || {};
    const field = process.env.FIELD;
    if (field === "required") {
      process.stdout.write(content.required ? "1" : "0");
    } else {
      process.stdout.write(String(content[field] || ""));
    }
  '
}

write_playlist_from_policy() {
  local output_path="$1"
  POLICY_JSON="${policy}" OUTPUT_PATH="${output_path}" node -e '
    const fs = require("fs");
    const path = require("path");
    const data = JSON.parse(process.env.POLICY_JSON || "{}");
    const playlist = data.content && data.content.playlist;
    if (!playlist || !Array.isArray(playlist.items)) {
      throw new Error("content.playlist.items is required");
    }
    fs.mkdirSync(path.dirname(process.env.OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(process.env.OUTPUT_PATH, `${JSON.stringify(playlist, null, 2)}\n`);
  '
}

json_payload() {
  local status="$1"
  local message="${2:-}"
  STATUS="${status}" \
  MESSAGE="${message}" \
  CONTENT_ID="${CONTENT_ID:-}" \
  PLAYLIST_VERSION="${PLAYLIST_VERSION:-}" \
  node -e '
    const payload = {
      status: process.env.STATUS,
      message: process.env.MESSAGE,
      content_id: process.env.CONTENT_ID,
      playlist_version: process.env.PLAYLIST_VERSION
    };
    for (const key of Object.keys(payload)) {
      if (!payload[key]) delete payload[key];
    }
    console.log(JSON.stringify(payload));
  '
}

post_result() {
  local status="$1"
  local message="${2:-}"
  if [[ -z "${CONTENT_RESULT_URL}" || "${APPLY}" != "1" ]]; then
    return 0
  fi
  local payload
  payload="$(json_payload "${status}" "${message}")"
  curl -fsS --max-time 20 \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    --data-binary "${payload}" \
    "${CONTENT_RESULT_URL}" >/dev/null || {
      echo "Could not report content ${status} to cloud" >&2
      return 0
    }
}

derive_content_urls

if [[ -z "${CONTENT_URL}" ]]; then
  echo "MISELL_CONTENT_URL is empty and could not be derived from MISELL_HEARTBEAT_URL; skipping content sync."
  exit 0
fi

if [[ -z "${DEVICE_TOKEN}" ]]; then
  echo "MISELL_DEVICE_TOKEN is required for content sync" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for content sync" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required for content sync" >&2
  exit 1
fi

mkdir -p "$(dirname "${LOCK_FILE}")"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "Another Misell content sync is already running."
    exit 0
  fi
fi

echo "Misell content sync"
echo "app_dir=${APP_DIR}"
echo "content_url=${CONTENT_URL}"
echo "apply=${APPLY}"

policy="$(curl -fsS --max-time 20 \
  -H "Authorization: Bearer ${DEVICE_TOKEN}" \
  "${CONTENT_URL}")"

REQUIRED="$(json_content_value required)"
CONTENT_ID="$(json_content_value content_id)"
PLAYLIST_VERSION="$(json_content_value playlist_version)"
SOURCE="$(json_content_value source)"

echo "required=${REQUIRED}"
echo "source=${SOURCE:-<none>}"
echo "content_id=${CONTENT_ID:-<none>}"
echo "playlist_version=${PLAYLIST_VERSION:-<none>}"

if [[ "${REQUIRED}" != "1" ]]; then
  echo "No content sync required."
  exit 0
fi

if [[ "${APPLY}" != "1" ]]; then
  echo "Dry-run content sync complete."
  exit 0
fi

post_result "updating" "content sync started"
"${APP_DIR}/scripts/backup-content.sh" --reason "before-content-sync" >/dev/null || true

previous_playlist="$(mktemp)"
if [[ -f "${PLAYLIST_PATH}" ]]; then
  cp "${PLAYLIST_PATH}" "${previous_playlist}"
fi
temp_playlist="$(mktemp)"

if ! write_playlist_from_policy "${temp_playlist}"; then
  post_result "failed" "could not write playlist from content policy"
  exit 1
fi

mkdir -p "$(dirname "${PLAYLIST_PATH}")"
mv "${temp_playlist}" "${PLAYLIST_PATH}"

if ! (cd "${APP_DIR}" && npm run validate:playlist >/dev/null); then
  if [[ -s "${previous_playlist}" ]]; then
    cp "${previous_playlist}" "${PLAYLIST_PATH}"
  fi
  post_result "failed" "playlist validation failed after content sync"
  exit 1
fi

rm -f "${previous_playlist}"
post_result "success" "content applied"
echo "Content sync applied."
