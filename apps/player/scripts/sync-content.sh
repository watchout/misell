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
RELEASES_DIR="${MISELL_CONTENT_RELEASES_DIR:-${DATA_DIR}/releases}"
CURRENT_LINK="${MISELL_CONTENT_CURRENT_LINK:-${RELEASES_DIR}/current}"
LOCK_FILE="${MISELL_CONTENT_SYNC_LOCK_FILE:-${HOME}/.local/share/misell-player/content-sync.lock}"
APPLY=1
ROLLBACK_TARGET=""
PREVIOUS_PLAYLIST_VERSION=""
CONTENT_APPLY_JOB_ID=""
RELEASE_BUNDLE_JSON=""
LOCAL_CONTENT_STATE_JSON=""
STAGING_DIR=""
RELEASE_DIR=""
RELEASE_PLAYLIST_PATH=""
RELEASE_PLAYLIST_SHA256=""

usage() {
  cat <<'EOF'
Usage:
  scripts/sync-content.sh [--dry-run]
  scripts/sync-content.sh --rollback previous
  scripts/sync-content.sh --rollback <release_id>

Fetches the active Cloud content manifest for this terminal release channel and
writes a versioned release bundle when the playlist_version differs. Rollback
switches the local current release pointer without downloading assets.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      APPLY=0
      shift
      ;;
    --rollback)
      ROLLBACK_TARGET="${2:-}"
      if [[ -z "${ROLLBACK_TARGET}" ]]; then
        echo "--rollback requires previous or a release_id" >&2
        exit 1
      fi
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
  HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-${HEARTBEAT_URL}}"
  CONTENT_URL="${MISELL_CONTENT_URL:-${CONTENT_URL}}"
  CONTENT_RESULT_URL="${MISELL_CONTENT_RESULT_URL:-${CONTENT_RESULT_URL}}"
  DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
  DATA_DIR="${MISELL_DATA_DIR:-${DATA_DIR}}"
  PLAYLIST_PATH="${MISELL_PLAYLIST_PATH:-${PLAYLIST_PATH}}"
  ASSETS_DIR="${MISELL_ASSETS_DIR:-${ASSETS_DIR}}"
fi
RELEASES_DIR="${MISELL_CONTENT_RELEASES_DIR:-${DATA_DIR}/releases}"
CURRENT_LINK="${MISELL_CONTENT_CURRENT_LINK:-${RELEASES_DIR}/current}"

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
  SOURCE="${SOURCE:-}" \
  node -e '
    const crypto = require("crypto");
    const raw = [
      "content-result",
      process.env.CONTENT_ID || "unknown",
      process.env.PLAYLIST_VERSION || "unknown",
      process.env.SOURCE || "unknown",
      process.env.STATUS || "unknown"
    ].join(":");
    const safe = raw.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 140);
    const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    process.stdout.write(`${safe}:${digest}`.slice(0, 160));
  '
}

safe_content_job_id() {
  CONTENT_ID="${CONTENT_ID:-}" \
  PLAYLIST_VERSION="${PLAYLIST_VERSION:-}" \
  SOURCE="${SOURCE:-}" \
  node -e '
    const crypto = require("crypto");
    const raw = [
      "content-apply",
      process.env.CONTENT_ID || "unknown",
      process.env.PLAYLIST_VERSION || "unknown",
      process.env.SOURCE || "unknown"
    ].join(":");
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

json_text_value() {
  local json_text="$1"
  local field="$2"
  JSON_TEXT="${json_text}" FIELD="${field}" node -e '
    const data = JSON.parse(process.env.JSON_TEXT || "{}");
    const path = String(process.env.FIELD || "").split(".");
    let value = data;
    for (const key of path) value = value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : "";
    if (value && typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
    } else {
      process.stdout.write(String(value || ""));
    }
  '
}

build_local_state_manifest() {
  POLICY_JSON_INPUT="${policy:-}" RELEASE_BUNDLE_JSON_INPUT="${RELEASE_BUNDLE_JSON:-}" node -e '
    const parse = (value, fallback) => {
      try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
    };
    const policy = parse(process.env.POLICY_JSON_INPUT || "", {});
    const bundle = parse(process.env.RELEASE_BUNDLE_JSON_INPUT || "", {});
    if (bundle && Object.keys(bundle).length > 0) {
      policy.release_bundle = {
        release_id: bundle.release_id || "",
        release_dir: bundle.release_dir || "",
        current_link: bundle.current_link || "",
        playlist_path: bundle.playlist_path || "",
        playlist_sha256: bundle.playlist_sha256 || "",
        manifest: bundle.manifest || {}
      };
    }
    process.stdout.write(JSON.stringify(policy));
  '
}

prepare_release_bundle() {
  if ! RELEASE_BUNDLE_JSON="$(
    POLICY_JSON="${policy}" node "${APP_DIR}/scripts/release-bundle.js" write \
      --releases-dir "${RELEASES_DIR}"
  )"; then
    return 1
  fi
  STAGING_DIR="$(json_text_value "${RELEASE_BUNDLE_JSON}" "staging_dir")"
  RELEASE_DIR="$(json_text_value "${RELEASE_BUNDLE_JSON}" "release_dir")"
  RELEASE_PLAYLIST_PATH="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_path")"
  RELEASE_PLAYLIST_SHA256="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_sha256")"
  LOCAL_CONTENT_STATE_JSON="$(build_local_state_manifest)"
}

promote_release_bundle() {
  if ! RELEASE_BUNDLE_JSON="$(
    node "${APP_DIR}/scripts/release-bundle.js" promote \
      --staging-dir "${STAGING_DIR}" \
      --release-dir "${RELEASE_DIR}" \
      --current-link "${CURRENT_LINK}" \
      --playlist-path "${PLAYLIST_PATH}"
  )"; then
    return 1
  fi
  RELEASE_DIR="$(json_text_value "${RELEASE_BUNDLE_JSON}" "release_dir")"
  RELEASE_PLAYLIST_PATH="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_path")"
  RELEASE_PLAYLIST_SHA256="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_sha256")"
  LOCAL_CONTENT_STATE_JSON="$(build_local_state_manifest)"
}

cleanup_staging_release() {
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then
    rm -rf "${STAGING_DIR}"
  fi
}

validate_playlist_file() {
  local playlist_path="$1"
  MISELL_PLAYLIST_PATH="${playlist_path}" MISELL_ASSETS_DIR="${ASSETS_DIR}" \
    bash -c 'cd "$1" && npm run validate:playlist >/dev/null' bash "${APP_DIR}"
}

rollback_release_bundle() {
  local target="$1"
  if [[ "${APPLY}" != "1" ]]; then
    echo "Dry-run rollback target=${target}"
    return 0
  fi
  if ! RELEASE_BUNDLE_JSON="$(
    node "${APP_DIR}/scripts/release-bundle.js" resolve \
      --target "${target}" \
      --releases-dir "${RELEASES_DIR}" \
      --current-link "${CURRENT_LINK}"
  )"; then
    return 1
  fi
  RELEASE_DIR="$(json_text_value "${RELEASE_BUNDLE_JSON}" "release_dir")"
  RELEASE_PLAYLIST_PATH="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_path")"
  RELEASE_PLAYLIST_SHA256="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_sha256")"
  CONTENT_ID="$(json_text_value "${RELEASE_BUNDLE_JSON}" "content_id")"
  PLAYLIST_VERSION="$(json_text_value "${RELEASE_BUNDLE_JSON}" "playlist_version")"
  SOURCE="release_bundle_rollback"
  CONTENT_APPLY_JOB_ID="$(safe_content_job_id)"
  PREVIOUS_PLAYLIST_VERSION="$(playlist_version_for_file "${PLAYLIST_PATH}")"
  LOCAL_CONTENT_STATE_JSON="$(build_local_state_manifest)"

  post_result "updating" "rollback started"
  if ! validate_playlist_file "${RELEASE_PLAYLIST_PATH}"; then
    post_result "failed" "rollback playlist validation failed"
    return 1
  fi
  if ! RELEASE_BUNDLE_JSON="$(
    node "${APP_DIR}/scripts/release-bundle.js" promote \
      --release-dir "${RELEASE_DIR}" \
      --current-link "${CURRENT_LINK}" \
      --playlist-path "${PLAYLIST_PATH}"
  )"; then
    post_result "failed" "rollback promote failed"
    return 1
  fi
  LOCAL_CONTENT_STATE_JSON="$(build_local_state_manifest)"
  post_result "success" "rollback applied"
  echo "Rollback applied: $(json_text_value "${RELEASE_BUNDLE_JSON}" "release_id")"
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
  local manifest_json="${LOCAL_CONTENT_STATE_JSON:-${policy:-}}"
  POLICY_JSON="${manifest_json}" node "${APP_DIR}/scripts/local-state.js" record-apply-job \
    --job-id "${job_id}" \
    --status "${status}" \
    --message "${message}" \
    --content-id "${CONTENT_ID:-}" \
    --playlist-version "${PLAYLIST_VERSION:-}" \
    --source "${SOURCE:-}" \
    --previous-playlist-version "${PREVIOUS_PLAYLIST_VERSION:-}" \
    --playlist-sha256 "${RELEASE_PLAYLIST_SHA256:-}" \
    --playlist-path "${PLAYLIST_PATH}" >/dev/null || {
      echo "Could not record local content apply job: ${status}" >&2
    }
  POLICY_JSON="${manifest_json}" node "${APP_DIR}/scripts/local-state.js" record-content \
    --status "${status}" \
    --message "${message}" \
    --content-id "${CONTENT_ID:-}" \
    --playlist-version "${PLAYLIST_VERSION:-}" \
    --source "${SOURCE:-}" \
    --previous-playlist-version "${PREVIOUS_PLAYLIST_VERSION:-}" \
    --playlist-sha256 "${RELEASE_PLAYLIST_SHA256:-}" \
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

if ! command -v node >/dev/null 2>&1; then
  echo "node is required for content sync" >&2
  exit 1
fi

if [[ -n "${ROLLBACK_TARGET}" ]]; then
  rollback_release_bundle "${ROLLBACK_TARGET}"
  exit $?
fi

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

if [[ -f "${PLAYLIST_PATH}" ]]; then
  PREVIOUS_PLAYLIST_VERSION="$(playlist_version_for_file "${PLAYLIST_PATH}")"
fi

"${APP_DIR}/scripts/backup-content.sh" --reason "before-content-sync" >/dev/null || true

if ! prepare_release_bundle; then
  post_result "failed" "could not stage release bundle from content policy"
  exit 1
fi

post_result "updating" "content sync staged"

if ! validate_playlist_file "${RELEASE_PLAYLIST_PATH}"; then
  post_result "failed" "release bundle playlist validation failed before promote"
  cleanup_staging_release
  exit 1
fi

if [[ "${MISELL_CONTENT_SYNC_INTERRUPT_BEFORE_PROMOTE:-0}" == "1" ]]; then
  post_result "failed" "content sync interrupted before promote"
  cleanup_staging_release
  exit 1
fi

if ! promote_release_bundle; then
  post_result "failed" "release bundle promote failed"
  cleanup_staging_release
  exit 1
fi

post_result "success" "content applied"
echo "Content sync applied."
