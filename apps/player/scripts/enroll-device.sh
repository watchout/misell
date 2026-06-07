#!/usr/bin/env bash
set -euo pipefail

APPLY=0
FORCE=0
ALLOW_LOCAL=0
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
APP_ENV="${APP_ENV:-production}"
UPLOAD_MAX_MB="${UPLOAD_MAX_MB:-2048}"
DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
RELEASE_CHANNEL="${MISELL_RELEASE_CHANNEL:-stable}"
CONFIG_VERSION="${MISELL_CONFIG_VERSION:-cfg-local-001}"
RUNTIME_DIR="${MISELL_RUNTIME_DIR:-${HOME}/.local/share/misell-player}"
DATA_DIR="${MISELL_DATA_DIR:-${RUNTIME_DIR}/data}"
ASSETS_DIR="${MISELL_ASSETS_DIR:-${RUNTIME_DIR}/assets}"
GENERATED_DIR="${MISELL_GENERATED_DIR:-${DATA_DIR}/generated}"
LOG_DIR="${MISELL_LOG_DIR:-${RUNTIME_DIR}/logs}"

TENANT_ID="${MISELL_TENANT_ID:-TEN-LOCAL}"
STORE_ID="${MISELL_STORE_ID:-STO-LOCAL}"
LOCATION_ID="${MISELL_LOCATION_ID:-LOC-LOCAL}"
SCREEN_GROUP_ID="${MISELL_SCREEN_GROUP_ID:-SG-LOCAL}"
DEVICE_ID="${MISELL_DEVICE_ID:-DEV-LOCAL-001}"
DEVICE_NAME="${MISELL_DEVICE_NAME:-local-dev-player}"

usage() {
  cat <<'EOF'
Usage:
  scripts/enroll-device.sh [options]

Options:
  --apply                         Write the env file. Default is dry-run.
  --force                         Overwrite an existing env file.
  --allow-local                   Allow TEN-LOCAL/STO-LOCAL style values on apply.
  --env-file PATH                 Target env file. Default: ~/.config/misell-player/env
  --tenant-id ID                  Customer/company ID. Example: TEN-0001
  --store-id ID                   Store/facility ID. Example: STO-0001
  --location-id ID                Location ID. Example: LOC-LOBBY-001
  --screen-group-id ID            Screen group ID. Example: SG-000001
  --device-id ID                  Device ID. Example: DEV-000001
  --device-name NAME              Device display name.
  --admin-user USER               Local admin user. Default: admin
  --admin-password PASSWORD       Local admin password. Generated if omitted on apply.
  --device-token TOKEN            Device API token. Generated if omitted on apply.
  --heartbeat-url URL             Optional cloud heartbeat endpoint.
  --release-channel CHANNEL       dev/staging/canary/stable/hold. Default: stable
  --config-version VERSION        Device config version. Default: cfg-local-001
  --upload-max-mb MB              Upload limit. Default: 2048
  --runtime-dir PATH              Runtime data root. Default: ~/.local/share/misell-player

Environment variables with the same names are also accepted.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --allow-local)
      ALLOW_LOCAL=1
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --tenant-id)
      TENANT_ID="$2"
      shift 2
      ;;
    --store-id)
      STORE_ID="$2"
      shift 2
      ;;
    --location-id)
      LOCATION_ID="$2"
      shift 2
      ;;
    --screen-group-id)
      SCREEN_GROUP_ID="$2"
      shift 2
      ;;
    --device-id)
      DEVICE_ID="$2"
      shift 2
      ;;
    --device-name)
      DEVICE_NAME="$2"
      shift 2
      ;;
    --admin-user)
      ADMIN_USER="$2"
      shift 2
      ;;
    --admin-password)
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --device-token)
      DEVICE_TOKEN="$2"
      shift 2
      ;;
    --heartbeat-url)
      HEARTBEAT_URL="$2"
      shift 2
      ;;
    --release-channel)
      RELEASE_CHANNEL="$2"
      shift 2
      ;;
    --config-version)
      CONFIG_VERSION="$2"
      shift 2
      ;;
    --upload-max-mb)
      UPLOAD_MAX_MB="$2"
      shift 2
      ;;
    --runtime-dir)
      RUNTIME_DIR="$2"
      DATA_DIR="${RUNTIME_DIR}/data"
      ASSETS_DIR="${RUNTIME_DIR}/assets"
      LOG_DIR="${RUNTIME_DIR}/logs"
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

generate_password() {
  openssl rand -base64 18 2>/dev/null \
    || node -e "console.log(require('crypto').randomBytes(18).toString('base64'))"
}

generate_token() {
  openssl rand -base64 32 2>/dev/null \
    || node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
}

require_not_local() {
  local name="$1"
  local value="$2"
  local local_value="$3"
  if [[ "${value}" == "${local_value}" ]]; then
    echo "${name} is still ${local_value}. Pass a real ID or use --allow-local for development." >&2
    exit 1
  fi
}

if [[ "${APPLY}" == "1" && "${ALLOW_LOCAL}" != "1" ]]; then
  require_not_local "TENANT_ID" "${TENANT_ID}" "TEN-LOCAL"
  require_not_local "STORE_ID" "${STORE_ID}" "STO-LOCAL"
  require_not_local "LOCATION_ID" "${LOCATION_ID}" "LOC-LOCAL"
  require_not_local "SCREEN_GROUP_ID" "${SCREEN_GROUP_ID}" "SG-LOCAL"
  require_not_local "DEVICE_ID" "${DEVICE_ID}" "DEV-LOCAL-001"
fi

GENERATED_PASSWORD=0
if [[ -z "${ADMIN_PASSWORD}" ]]; then
  if [[ "${APPLY}" == "1" ]]; then
    ADMIN_PASSWORD="$(generate_password)"
    GENERATED_PASSWORD=1
  else
    ADMIN_PASSWORD="<generated-on-apply>"
  fi
fi

GENERATED_DEVICE_TOKEN=0
if [[ -z "${DEVICE_TOKEN}" ]]; then
  if [[ "${APPLY}" == "1" ]]; then
    DEVICE_TOKEN="$(generate_token)"
    GENERATED_DEVICE_TOKEN=1
  else
    DEVICE_TOKEN="<generated-on-apply>"
  fi
fi

render_env() {
  cat <<EOF
ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
REQUIRE_ADMIN_AUTH=1
APP_ENV=${APP_ENV}
UPLOAD_MAX_MB=${UPLOAD_MAX_MB}
MISELL_RELEASE_CHANNEL=${RELEASE_CHANNEL}
MISELL_CONFIG_VERSION=${CONFIG_VERSION}
MISELL_DATA_DIR=${DATA_DIR}
MISELL_ASSETS_DIR=${ASSETS_DIR}
MISELL_GENERATED_DIR=${GENERATED_DIR}
MISELL_LOG_DIR=${LOG_DIR}
MISELL_PLAYLIST_PATH=${DATA_DIR}/playlist.json
MISELL_DEVICE_CONFIG_PATH=${DATA_DIR}/config.json

MISELL_TENANT_ID=${TENANT_ID}
MISELL_STORE_ID=${STORE_ID}
MISELL_LOCATION_ID=${LOCATION_ID}
MISELL_SCREEN_GROUP_ID=${SCREEN_GROUP_ID}
MISELL_DEVICE_ID=${DEVICE_ID}
MISELL_DEVICE_NAME=${DEVICE_NAME}
MISELL_DEVICE_TOKEN=${DEVICE_TOKEN}
EOF
  if [[ -n "${HEARTBEAT_URL}" ]]; then
    echo "MISELL_HEARTBEAT_URL=${HEARTBEAT_URL}"
  fi
}

echo "Misell device enrollment"
echo "target=${ENV_FILE}"
echo "tenant_id=${TENANT_ID}"
echo "store_id=${STORE_ID}"
echo "location_id=${LOCATION_ID}"
echo "screen_group_id=${SCREEN_GROUP_ID}"
echo "device_id=${DEVICE_ID}"
echo "device_name=${DEVICE_NAME}"
echo "release_channel=${RELEASE_CHANNEL}"
echo "config_version=${CONFIG_VERSION}"
echo "runtime_dir=${RUNTIME_DIR}"

if [[ "${APPLY}" != "1" ]]; then
  echo
  echo "DRY RUN. No file will be written. Re-run with --apply to enroll this terminal."
  echo
  render_env | sed -E 's/^(ADMIN_PASSWORD=).*/\1<redacted>/; s/^(MISELL_DEVICE_TOKEN=).*/\1<redacted>/'
  exit 0
fi

if [[ -f "${ENV_FILE}" && "${FORCE}" != "1" ]]; then
  echo "${ENV_FILE} already exists. Use --force to overwrite." >&2
  exit 1
fi

mkdir -p "$(dirname "${ENV_FILE}")"
mkdir -p "${DATA_DIR}" "${GENERATED_DIR}" "${ASSETS_DIR}/images" "${ASSETS_DIR}/videos" "${LOG_DIR}"
TEMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
render_env > "${TEMP_FILE}"
chmod 600 "${TEMP_FILE}"
mv "${TEMP_FILE}" "${ENV_FILE}"

echo "Wrote ${ENV_FILE}"
echo "Admin user: ${ADMIN_USER}"
if [[ "${GENERATED_PASSWORD}" == "1" ]]; then
  echo "Generated admin password: ${ADMIN_PASSWORD}"
else
  echo "Admin password: <provided>"
fi
if [[ "${GENERATED_DEVICE_TOKEN}" == "1" ]]; then
  echo "Generated device token: <stored in ${ENV_FILE}>"
else
  echo "Device token: <provided>"
fi
