#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"
PORT="${PORT:-3000}"
HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
UPDATE_URL="${MISELL_UPDATE_URL:-}"
UPDATE_RESULT_URL="${MISELL_UPDATE_RESULT_URL:-}"
DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
LOCK_FILE="${MISELL_UPDATE_LOCK_FILE:-${HOME}/.local/share/misell-player/update.lock}"
APPLY=1
SKIP_AUDIT=0

usage() {
  cat <<'EOF'
Usage:
  scripts/check-update.sh [--dry-run] [--skip-audit]

Fetches the device update policy from Misell Cloud and applies the target Git ref
with scripts/update-player.sh when an update is required.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      APPLY=0
      shift
      ;;
    --skip-audit)
      SKIP_AUDIT=1
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
  PORT="${PORT:-3000}"
  HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-${HEARTBEAT_URL}}"
  UPDATE_URL="${MISELL_UPDATE_URL:-${UPDATE_URL}}"
  UPDATE_RESULT_URL="${MISELL_UPDATE_RESULT_URL:-${UPDATE_RESULT_URL}}"
  DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
fi

derive_update_urls() {
  if [[ -n "${UPDATE_URL}" && -n "${UPDATE_RESULT_URL}" ]]; then
    return 0
  fi
  if [[ "${HEARTBEAT_URL}" == */api/device/heartbeat ]]; then
    local base_url="${HEARTBEAT_URL%/api/device/heartbeat}"
    UPDATE_URL="${UPDATE_URL:-${base_url}/api/device/update-policy}"
    UPDATE_RESULT_URL="${UPDATE_RESULT_URL:-${base_url}/api/device/update-result}"
  fi
}

json_policy_value() {
  local field="$1"
  POLICY_JSON="${policy}" FIELD="${field}" node -e '
    const data = JSON.parse(process.env.POLICY_JSON || "{}");
    const update = data.update || {};
    const field = process.env.FIELD;
    if (field === "required") {
      process.stdout.write(update.required ? "1" : "0");
    } else {
      process.stdout.write(String(update[field] || ""));
    }
  '
}

json_payload() {
  local status="$1"
  local message="${2:-}"
  local release_id="${3:-}"
  STATUS="${status}" \
  MESSAGE="${message}" \
  TARGET_UPDATE_REF="${TARGET_UPDATE_REF:-}" \
  TARGET_RELEASE_ID="${TARGET_RELEASE_ID:-}" \
  RELEASE_ID="${release_id}" \
  RELEASE_CHANNEL="${TARGET_RELEASE_CHANNEL:-}" \
  node -e '
    const payload = {
      status: process.env.STATUS,
      message: process.env.MESSAGE,
      target_update_ref: process.env.TARGET_UPDATE_REF,
      target_release_id: process.env.TARGET_RELEASE_ID,
      release_id: process.env.RELEASE_ID,
      release_channel: process.env.RELEASE_CHANNEL
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
  local release_id="${3:-}"
  if [[ -z "${UPDATE_RESULT_URL}" ]]; then
    return 0
  fi
  local payload
  payload="$(json_payload "${status}" "${message}" "${release_id}")"
  curl -fsS --max-time 20 \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    --data-binary "${payload}" \
    "${UPDATE_RESULT_URL}" >/dev/null || {
      echo "Could not report update ${status} to cloud" >&2
      return 0
    }
}

derive_update_urls

if [[ -z "${UPDATE_URL}" ]]; then
  echo "MISELL_UPDATE_URL is empty and could not be derived from MISELL_HEARTBEAT_URL; skipping update check."
  exit 0
fi

if [[ -z "${DEVICE_TOKEN}" ]]; then
  echo "MISELL_DEVICE_TOKEN is required for update checks" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for update checks" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required for update checks" >&2
  exit 1
fi

mkdir -p "$(dirname "${LOCK_FILE}")"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "Another Misell update check is already running."
    exit 0
  fi
fi

echo "Misell update check"
echo "app_dir=${APP_DIR}"
echo "update_url=${UPDATE_URL}"
echo "apply=${APPLY}"

policy="$(curl -fsS --max-time 20 \
  -H "Authorization: Bearer ${DEVICE_TOKEN}" \
  "${UPDATE_URL}")"

REQUIRED="$(json_policy_value required)"
TARGET_UPDATE_REF="$(json_policy_value target_update_ref)"
TARGET_RELEASE_ID="$(json_policy_value target_release_id)"
TARGET_RELEASE_CHANNEL="$(json_policy_value target_release_channel)"
UPDATE_STATUS="$(json_policy_value status)"

echo "required=${REQUIRED}"
echo "target_update_ref=${TARGET_UPDATE_REF:-<none>}"
echo "target_release_id=${TARGET_RELEASE_ID:-<none>}"
echo "target_release_channel=${TARGET_RELEASE_CHANNEL:-<unchanged>}"
echo "update_status=${UPDATE_STATUS:-<unknown>}"

if [[ "${REQUIRED}" != "1" ]]; then
  echo "No update required."
  exit 0
fi

if [[ "${APPLY}" == "1" ]]; then
  post_result "updating" "update started"
fi

update_args=(--ref "${TARGET_UPDATE_REF}")
if [[ "${APPLY}" == "1" ]]; then
  update_args=(--apply "${update_args[@]}")
fi
if [[ -n "${TARGET_RELEASE_ID}" ]]; then
  update_args+=(--release-id "${TARGET_RELEASE_ID}")
fi
if [[ -n "${TARGET_RELEASE_CHANNEL}" ]]; then
  update_args+=(--release-channel "${TARGET_RELEASE_CHANNEL}")
fi
if [[ "${SKIP_AUDIT}" == "1" ]]; then
  update_args+=(--skip-audit)
fi

if "${APP_DIR}/scripts/update-player.sh" "${update_args[@]}"; then
  if [[ "${APPLY}" == "1" ]]; then
    post_result "success" "update applied" "${TARGET_RELEASE_ID}"
    echo "Update applied."
  else
    echo "Dry-run update flow complete."
  fi
else
  rc="$?"
  if [[ "${APPLY}" == "1" ]]; then
    post_result "failed" "update-player.sh exited with ${rc}"
  fi
  exit "${rc}"
fi
