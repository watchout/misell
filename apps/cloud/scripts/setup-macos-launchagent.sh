#!/usr/bin/env bash
set -euo pipefail

APPLY=0
FORCE_SECRETS=0
LABEL="${MISELL_CLOUD_LABEL:-com.misell.cloud}"
PORT="${PORT:-3200}"
HOST="${HOST:-}"
APP_DIR="${MISELL_CLOUD_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_CLOUD_ENV_FILE:-${HOME}/.config/misell-cloud/env}"
STARTER="${MISELL_CLOUD_STARTER:-${HOME}/.local/bin/misell-cloud-start}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_OUT="${MISELL_CLOUD_LOG_OUT:-/tmp/misell-cloud-3200.log}"
LOG_ERR="${MISELL_CLOUD_LOG_ERR:-/tmp/misell-cloud-3200.err}"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-macos-launchagent.sh [--apply] [--force-secrets] [--host IP] [--port PORT]

Default is dry-run. This creates:
  ~/.config/misell-cloud/env
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
echo "env_file=${ENV_FILE}"
echo "starter=${STARTER}"
echo "plist=${PLIST}"

if [[ "${APPLY}" != "1" ]]; then
  echo "DRY RUN. Re-run with --apply to write files and restart launch agent."
  exit 0
fi

mkdir -p "$(dirname "${ENV_FILE}")" "$(dirname "${STARTER}")" "$(dirname "${PLIST}")"

ENV_TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
cat > "${ENV_TMP}" <<EOF
PORT=${PORT}
HOST=${HOST}
APP_ENV=production
ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
REQUIRE_ADMIN_AUTH=1
DEVICE_TOKEN_PEPPER=${DEVICE_TOKEN_PEPPER}
DB_PATH=${APP_DIR}/data/misell-cloud.sqlite
EOF
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
