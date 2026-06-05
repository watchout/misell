#!/usr/bin/env bash
set -euo pipefail

APPLY=0
FORCE_SECRETS=0
LABEL="${MISELL_CLOUD_LABEL:-com.misell.cloud}"
PORT="${PORT:-3200}"
HOST="${HOST:-}"
APP_DIR="${MISELL_CLOUD_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUNTIME_DIR="${MISELL_CLOUD_RUNTIME_DIR:-${HOME}/.local/share/misell-cloud}"
DATA_DIR="${MISELL_CLOUD_DATA_DIR:-${RUNTIME_DIR}/data}"
LOG_DIR="${MISELL_CLOUD_LOG_DIR:-${RUNTIME_DIR}/logs}"
ENV_FILE="${MISELL_CLOUD_ENV_FILE:-${HOME}/.config/misell-cloud/env}"
STARTER="${MISELL_CLOUD_STARTER:-${HOME}/.local/bin/misell-cloud-start}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_OUT="${MISELL_CLOUD_LOG_OUT:-${LOG_DIR}/misell-cloud-3200.log}"
LOG_ERR="${MISELL_CLOUD_LOG_ERR:-${LOG_DIR}/misell-cloud-3200.err}"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-macos-launchagent.sh [--apply] [--force-secrets] [--host IP] [--port PORT]

Default is dry-run. This creates:
  ~/.config/misell-cloud/env
  ~/.local/share/misell-cloud/data/misell-cloud.sqlite
  ~/.local/share/misell-cloud/logs/
  ~/.local/bin/misell-cloud-start
  ~/Library/LaunchAgents/com.misell.cloud.plist

Secrets are never printed. Read ADMIN_PASSWORD from the env file when needed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --force-secrets)
      FORCE_SECRETS=1
      shift
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
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

detect_host() {
  if [[ -n "${HOST}" ]]; then
    echo "${HOST}"
    return
  fi
  if command -v tailscale >/dev/null 2>&1; then
    local ts_ip
    ts_ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
    if [[ -n "${ts_ip}" ]]; then
      echo "${ts_ip}"
      return
    fi
  fi
  echo "127.0.0.1"
}

generate_secret() {
  openssl rand -base64 36 2>/dev/null \
    || node -e "console.log(require('crypto').randomBytes(36).toString('base64'))"
}

read_env_value() {
  local key="$1"
  if [[ -f "${ENV_FILE}" ]]; then
    sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
  fi
}

run() {
  echo "+ $*"
  if [[ "${APPLY}" == "1" ]]; then
    "$@"
  fi
}

HOST="$(detect_host)"
ADMIN_USER="$(read_env_value ADMIN_USER)"
ADMIN_PASSWORD="$(read_env_value ADMIN_PASSWORD)"
DEVICE_TOKEN_PEPPER="$(read_env_value DEVICE_TOKEN_PEPPER)"
ALERT_WEBHOOK_URL="$(read_env_value ALERT_WEBHOOK_URL)"
ALERT_WEBHOOK_MIN_SEVERITY="$(read_env_value ALERT_WEBHOOK_MIN_SEVERITY)"
ALERT_WEBHOOK_NOTIFY_RESOLVED="$(read_env_value ALERT_WEBHOOK_NOTIFY_RESOLVED)"
ALERT_WEBHOOK_TIMEOUT_MS="$(read_env_value ALERT_WEBHOOK_TIMEOUT_MS)"

ADMIN_USER="${ADMIN_USER:-admin}"
if [[ "${FORCE_SECRETS}" == "1" || -z "${ADMIN_PASSWORD}" || "${ADMIN_PASSWORD}" == "change-me" ]]; then
  ADMIN_PASSWORD="$(generate_secret)"
fi
if [[ "${FORCE_SECRETS}" == "1" || -z "${DEVICE_TOKEN_PEPPER}" || "${DEVICE_TOKEN_PEPPER}" == "local-development-pepper" ]]; then
  DEVICE_TOKEN_PEPPER="$(generate_secret)"
fi

echo "Misell cloud macOS launch agent setup"
echo "app_dir=${APP_DIR}"
echo "host=${HOST}"
echo "port=${PORT}"
echo "runtime_dir=${RUNTIME_DIR}"
echo "data_dir=${DATA_DIR}"
echo "log_dir=${LOG_DIR}"
echo "env_file=${ENV_FILE}"
echo "starter=${STARTER}"
echo "plist=${PLIST}"

if [[ "${APPLY}" != "1" ]]; then
  echo "DRY RUN. Re-run with --apply to write files and restart launch agent."
  exit 0
fi

mkdir -p "$(dirname "${ENV_FILE}")" "$(dirname "${STARTER}")" "$(dirname "${PLIST}")" "${DATA_DIR}" "${LOG_DIR}"

ENV_TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
cat > "${ENV_TMP}" <<EOF
PORT=${PORT}
HOST=${HOST}
APP_ENV=production
ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
REQUIRE_ADMIN_AUTH=1
DEVICE_TOKEN_PEPPER=${DEVICE_TOKEN_PEPPER}
MISELL_CLOUD_DATA_DIR=${DATA_DIR}
DB_PATH=${DATA_DIR}/misell-cloud.sqlite
EOF
if [[ -n "${ALERT_WEBHOOK_URL}" ]]; then
  printf 'ALERT_WEBHOOK_URL=%s\n' "${ALERT_WEBHOOK_URL}" >> "${ENV_TMP}"
fi
if [[ -n "${ALERT_WEBHOOK_MIN_SEVERITY}" ]]; then
  printf 'ALERT_WEBHOOK_MIN_SEVERITY=%s\n' "${ALERT_WEBHOOK_MIN_SEVERITY}" >> "${ENV_TMP}"
fi
if [[ -n "${ALERT_WEBHOOK_NOTIFY_RESOLVED}" ]]; then
  printf 'ALERT_WEBHOOK_NOTIFY_RESOLVED=%s\n' "${ALERT_WEBHOOK_NOTIFY_RESOLVED}" >> "${ENV_TMP}"
fi
if [[ -n "${ALERT_WEBHOOK_TIMEOUT_MS}" ]]; then
  printf 'ALERT_WEBHOOK_TIMEOUT_MS=%s\n' "${ALERT_WEBHOOK_TIMEOUT_MS}" >> "${ENV_TMP}"
fi
chmod 600 "${ENV_TMP}"
mv "${ENV_TMP}" "${ENV_FILE}"

STARTER_TMP="$(mktemp "${STARTER}.XXXXXX")"
cat > "${STARTER_TMP}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
set -a
. "${ENV_FILE}"
set +a
cd "${APP_DIR}"
exec "$(command -v node)" server.js
EOF
chmod 700 "${STARTER_TMP}"
mv "${STARTER_TMP}" "${STARTER}"

PLIST_TMP="$(mktemp "${PLIST}.XXXXXX")"
cat > "${PLIST_TMP}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${STARTER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>
</dict>
</plist>
EOF
plutil -lint "${PLIST_TMP}" >/dev/null
mv "${PLIST_TMP}" "${PLIST}"

launchctl remove "${LABEL}" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "${PLIST}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed ${LABEL}."
echo "Admin password is stored in ${ENV_FILE}."
