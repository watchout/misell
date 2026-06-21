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
ASSETS_DIR="${MISELL_ASSETS_DIR:-${APP_DIR}/assets}"
LOCK_FILE="${MISELL_CONTENT_SYNC_LOCK_FILE:-${HOME}/.local/share/misell-player/content-sync.lock}"
APPLY=1
PREVIOUS_PLAYLIST_VERSION=""
CONTENT_APPLY_JOB_ID=""

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
  ASSETS_DIR="${MISELL_ASSETS_DIR:-${ASSETS_DIR}}"
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
  local event_id="${3:-}"
  STATUS="${status}" \
  MESSAGE="${message}" \
  EVENT_ID="${event_id}" \
  CONTENT_ID="${CONTENT_ID:-}" \
  PLAYLIST_VERSION="${PLAYLIST_VERSION:-}" \
  node -e '
    const payload = {
      event_id: process.env.EVENT_ID,
      event_type: "content_result",
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

safe_content_event_id() {
  local status="$1"
  STATUS="${status}" \
  CONTENT_ID="${CONTENT_ID:-}" \
  PLAYLIST_VERSION="${PLAYLIST_VERSION:-}" \
  node -e '
    const crypto = require("crypto");
    const raw = ["content-result", process.env.CONTENT_ID || "unknown", process.env.PLAYLIST_VERSION || "unknown", process.env.STATUS || "unknown"].join(":");
    const safe = raw.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 140);
    const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    process.stdout.write(`${safe}:${digest}`.slice(0, 160));
  '
}

safe_content_job_id() {
  CONTENT_ID="${CONTENT_ID:-}" \
  PLAYLIST_VERSION="${PLAYLIST_VERSION:-}" \
  node -e '
    const crypto = require("crypto");
    const raw = ["content-apply", process.env.CONTENT_ID || "unknown", process.env.PLAYLIST_VERSION || "unknown"].join(":");
    const safe = raw.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 140);
    const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    process.stdout.write(`${safe}:${digest}`.slice(0, 160));
  '
}

playlist_version_for_file() {
  local playlist_path="$1"
  if [[ ! -f "${playlist_path}" ]]; then
    return 0
  fi
  PLAYLIST_PATH_FOR_VERSION="${playlist_path}" node -e '
    const fs = require("fs");
    try {
      const playlist = JSON.parse(fs.readFileSync(process.env.PLAYLIST_PATH_FOR_VERSION, "utf8"));
      process.stdout.write(String(playlist.playlist_version || playlist.version || ""));
    } catch {
      process.stdout.write("");
    }
  '
}

record_local_content_state() {
  local status="$1"
  local message="${2:-}"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  local job_id="${CONTENT_APPLY_JOB_ID:-}"
  if [[ -z "${job_id}" ]]; then
    job_id="$(safe_content_job_id)"
  fi
  POLICY_JSON="${policy:-}" node "${APP_DIR}/scripts/local-state.js" record-apply-job \
    --job-id "${job_id}" \
    --status "${status}" \
    --message "${message}" \
    --content-id "${CONTENT_ID:-}" \
    --playlist-version "${PLAYLIST_VERSION:-}" \
    --source "${SOURCE:-}" \
    --previous-playlist-version "${PREVIOUS_PLAYLIST_VERSION:-}" \
    --playlist-path "${PLAYLIST_PATH}" >/dev/null || {
      echo "Could not record local content apply job: ${status}" >&2
    }
  POLICY_JSON="${policy:-}" node "${APP_DIR}/scripts/local-state.js" record-content \
    --status "${status}" \
    --message "${message}" \
    --content-id "${CONTENT_ID:-}" \
    --playlist-version "${PLAYLIST_VERSION:-}" \
    --source "${SOURCE:-}" \
    --previous-playlist-version "${PREVIOUS_PLAYLIST_VERSION:-}" \
    --playlist-path "${PLAYLIST_PATH}" >/dev/null || {
      echo "Could not record local content state: ${status}" >&2
      return 0
    }
}

queue_local_content_result() {
  local event_id="$1"
  local payload="$2"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  PAYLOAD_JSON="${payload}" node "${APP_DIR}/scripts/local-state.js" queue-outbound \
    --endpoint "/api/device/content-result" \
    --event-id "${event_id}" \
    --event-type "content_result" >/dev/null || {
      echo "Could not queue local content result: ${event_id}" >&2
      return 0
    }
}

mark_local_content_result_sent() {
  local event_id="$1"
  local response_status="${2:-201}"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  node "${APP_DIR}/scripts/local-state.js" mark-outbound-sent \
    --event-id "${event_id}" \
    --response-status "${response_status}" >/dev/null || true
}

mark_local_content_result_failed() {
  local event_id="$1"
  local message="$2"
  local response_status="${3:-0}"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  node "${APP_DIR}/scripts/local-state.js" mark-outbound-failed \
    --event-id "${event_id}" \
    --message "${message}" \
    --response-status "${response_status}" >/dev/null || true
}

post_result() {
  local status="$1"
  local message="${2:-}"
  record_local_content_state "${status}" "${message}"
  if [[ "${APPLY}" != "1" ]]; then
    return 0
  fi
  local event_id
  local payload
  event_id="$(safe_content_event_id "${status}")"
  payload="$(json_payload "${status}" "${message}" "${event_id}")"
  queue_local_content_result "${event_id}" "${payload}"
  if [[ -z "${CONTENT_RESULT_URL}" ]]; then
    return 0
  fi
  local response_status
  response_status="$(curl -fsS --max-time 20 \
    -w "%{http_code}" \
    -o /dev/null \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    --data-binary "${payload}" \
    "${CONTENT_RESULT_URL}" || true)"
  if [[ "${response_status}" =~ ^2[0-9][0-9]$ ]]; then
    mark_local_content_result_sent "${event_id}" "${response_status}"
  else
    mark_local_content_result_failed "${event_id}" "Could not report content ${status} to cloud" "${response_status:-0}"
      echo "Could not report content ${status} to cloud" >&2
      return 0
  fi
}

sync_assets_from_policy() {
  if [[ "${MISELL_SKIP_ASSET_SYNC:-0}" == "1" ]]; then
    echo "Asset sync skipped by MISELL_SKIP_ASSET_SYNC=1."
    return 0
  fi
  if [[ ! -x "${APP_DIR}/scripts/sync-assets.sh" ]]; then
    echo "sync-assets.sh is not installed; skipping asset sync."
    return 0
  fi
  local args=()
  if [[ "${APPLY}" != "1" ]]; then
    args+=(--dry-run)
  fi
  if [[ "${#args[@]}" -gt 0 ]]; then
    "${APP_DIR}/scripts/sync-assets.sh" "${args[@]}"
  else
    "${APP_DIR}/scripts/sync-assets.sh"
  fi
}

verify_assets_from_policy() {
  if [[ "${MISELL_VERIFY_CONTENT_ASSETS:-1}" == "0" ]]; then
    echo "Content asset verification skipped by MISELL_VERIFY_CONTENT_ASSETS=0."
    return 0
  fi
  if [[ ! -f "${APP_DIR}/scripts/verify-content-assets.js" ]]; then
    echo "verify-content-assets.js is not installed." >&2
    return 1
  fi
  POLICY_JSON="${policy}" ASSETS_DIR="${ASSETS_DIR}" \
    node "${APP_DIR}/scripts/verify-content-assets.js"
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
CONTENT_APPLY_JOB_ID="$(safe_content_job_id)"

echo "required=${REQUIRED}"
echo "source=${SOURCE:-<none>}"
echo "content_id=${CONTENT_ID:-<none>}"
echo "playlist_version=${PLAYLIST_VERSION:-<none>}"

if [[ "${SOURCE}" == "content_manifest" ]]; then
  if ! sync_assets_from_policy; then
    post_result "failed" "asset sync failed before content apply"
    exit 1
  fi
  if [[ "${APPLY}" == "1" || "${MISELL_VERIFY_CONTENT_ASSETS_DRY_RUN:-0}" == "1" ]]; then
    if ! verify_assets_from_policy; then
      post_result "failed" "asset verification failed before content apply"
      exit 1
    fi
  else
    echo "Dry-run: asset verification will run after assets are downloaded during apply."
  fi
fi

if [[ "${REQUIRED}" != "1" ]]; then
  echo "No content sync required."
  exit 0
fi

if [[ "${APPLY}" != "1" ]]; then
  echo "Dry-run content sync complete."
  exit 0
fi

previous_playlist="$(mktemp)"
if [[ -f "${PLAYLIST_PATH}" ]]; then
  PREVIOUS_PLAYLIST_VERSION="$(playlist_version_for_file "${PLAYLIST_PATH}")"
  cp "${PLAYLIST_PATH}" "${previous_playlist}"
fi
temp_playlist="$(mktemp)"

post_result "updating" "content sync started"
"${APP_DIR}/scripts/backup-content.sh" --reason "before-content-sync" >/dev/null || true

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
