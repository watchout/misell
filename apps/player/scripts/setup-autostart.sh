#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
MISELL_CONFIG_DIR="${HOME}/.config/misell-player"
MISELL_ENV_FILE="${MISELL_CONFIG_DIR}/env"
MISELL_RUNTIME_DIR="${MISELL_RUNTIME_DIR:-${HOME}/.local/share/misell-player}"
MISELL_DATA_DIR="${MISELL_DATA_DIR:-${MISELL_RUNTIME_DIR}/data}"
MISELL_ASSETS_DIR="${MISELL_ASSETS_DIR:-${MISELL_RUNTIME_DIR}/assets}"
MISELL_LOG_DIR="${MISELL_LOG_DIR:-${MISELL_RUNTIME_DIR}/logs}"
MISELL_CONTENT_BACKUP_DIR="${MISELL_CONTENT_BACKUP_DIR:-${MISELL_RUNTIME_DIR}/backups}"
INSTALL_KIOSK="${INSTALL_KIOSK:-1}"
INSTALL_HEARTBEAT="${INSTALL_HEARTBEAT:-0}"
INSTALL_UPDATE="${INSTALL_UPDATE:-0}"
INSTALL_CONTENT_SYNC="${INSTALL_CONTENT_SYNC:-0}"
INSTALL_LOG_ROTATE="${INSTALL_LOG_ROTATE:-1}"

mkdir -p "${SYSTEMD_USER_DIR}"
mkdir -p "${MISELL_CONFIG_DIR}"
mkdir -p "${MISELL_DATA_DIR}" "${MISELL_ASSETS_DIR}/images" "${MISELL_ASSETS_DIR}/videos" "${MISELL_LOG_DIR}" "${MISELL_CONTENT_BACKUP_DIR}"

copy_if_missing() {
  local source="$1"
  local target="$2"
  if [[ -f "${source}" && ! -f "${target}" ]]; then
    cp "${source}" "${target}"
  fi
}

ensure_env_setting() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "${MISELL_ENV_FILE}" 2>/dev/null; then
    printf '%s=%s\n' "${key}" "${value}" >> "${MISELL_ENV_FILE}"
  fi
}

copy_if_missing "${APP_DIR}/data/playlist.json" "${MISELL_DATA_DIR}/playlist.json"
copy_if_missing "${APP_DIR}/data/config.json" "${MISELL_DATA_DIR}/config.json"
chmod 600 "${MISELL_DATA_DIR}/config.json" 2>/dev/null || true

if [[ ! -f "${MISELL_ENV_FILE}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 2>/dev/null || node -e "console.log(require('crypto').randomBytes(18).toString('base64'))")"
  cat > "${MISELL_ENV_FILE}" <<EOF
ADMIN_USER=admin
ADMIN_PASSWORD=${ADMIN_PASSWORD}
REQUIRE_ADMIN_AUTH=1
APP_ENV=production
UPLOAD_MAX_MB=2048
MISELL_DATA_DIR=${MISELL_DATA_DIR}
MISELL_ASSETS_DIR=${MISELL_ASSETS_DIR}
MISELL_LOG_DIR=${MISELL_LOG_DIR}
MISELL_CONTENT_BACKUP_DIR=${MISELL_CONTENT_BACKUP_DIR}
MISELL_PLAYLIST_PATH=${MISELL_DATA_DIR}/playlist.json
MISELL_DEVICE_CONFIG_PATH=${MISELL_DATA_DIR}/config.json
EOF
  chmod 600 "${MISELL_ENV_FILE}"
  echo "Created ${MISELL_ENV_FILE}"
  echo "Initial admin login: admin / ${ADMIN_PASSWORD}"
fi

ensure_env_setting "MISELL_DATA_DIR" "${MISELL_DATA_DIR}"
ensure_env_setting "MISELL_ASSETS_DIR" "${MISELL_ASSETS_DIR}"
ensure_env_setting "MISELL_LOG_DIR" "${MISELL_LOG_DIR}"
ensure_env_setting "MISELL_CONTENT_BACKUP_DIR" "${MISELL_CONTENT_BACKUP_DIR}"
ensure_env_setting "MISELL_PLAYLIST_PATH" "${MISELL_DATA_DIR}/playlist.json"
ensure_env_setting "MISELL_DEVICE_CONFIG_PATH" "${MISELL_DATA_DIR}/config.json"

sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-player.service" \
  > "${SYSTEMD_USER_DIR}/misell-player.service"

if [[ "${INSTALL_KIOSK}" == "1" ]]; then
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-kiosk.service" \
    > "${SYSTEMD_USER_DIR}/misell-kiosk.service"
fi

if [[ "${INSTALL_HEARTBEAT}" == "1" ]]; then
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-heartbeat.service" \
    > "${SYSTEMD_USER_DIR}/misell-heartbeat.service"
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-heartbeat.timer" \
    > "${SYSTEMD_USER_DIR}/misell-heartbeat.timer"
fi

if [[ "${INSTALL_UPDATE}" == "1" ]]; then
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-update.service" \
    > "${SYSTEMD_USER_DIR}/misell-update.service"
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-update.timer" \
    > "${SYSTEMD_USER_DIR}/misell-update.timer"
fi

if [[ "${INSTALL_CONTENT_SYNC}" == "1" ]]; then
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-content-sync.service" \
    > "${SYSTEMD_USER_DIR}/misell-content-sync.service"
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-content-sync.timer" \
    > "${SYSTEMD_USER_DIR}/misell-content-sync.timer"
fi

if [[ "${INSTALL_LOG_ROTATE}" == "1" ]]; then
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-log-rotate.service" \
    > "${SYSTEMD_USER_DIR}/misell-log-rotate.service"
  sed "s#__MISELL_HOME__#${APP_DIR}#g" "${APP_DIR}/systemd/misell-log-rotate.timer" \
    > "${SYSTEMD_USER_DIR}/misell-log-rotate.timer"
fi

systemctl --user daemon-reload
systemctl --user enable --now misell-player.service

if [[ "${INSTALL_KIOSK}" == "1" ]]; then
  systemctl --user enable --now misell-kiosk.service || {
    echo "Kiosk service could not start now. It usually needs an active Ubuntu desktop session." >&2
    echo "After logging into the desktop, run: systemctl --user restart misell-kiosk.service" >&2
  }
fi

if [[ "${INSTALL_HEARTBEAT}" == "1" ]]; then
  systemctl --user enable --now misell-heartbeat.timer
fi

if [[ "${INSTALL_UPDATE}" == "1" ]]; then
  systemctl --user enable --now misell-update.timer
fi

if [[ "${INSTALL_CONTENT_SYNC}" == "1" ]]; then
  systemctl --user enable --now misell-content-sync.timer
fi

if [[ "${INSTALL_LOG_ROTATE}" == "1" ]]; then
  systemctl --user enable --now misell-log-rotate.timer
fi

echo "Installed user services in ${SYSTEMD_USER_DIR}"
echo "Server status: systemctl --user status misell-player.service"
echo "Kiosk status:  systemctl --user status misell-kiosk.service"
echo "Heartbeat timer: systemctl --user status misell-heartbeat.timer"
echo "Update timer: systemctl --user status misell-update.timer"
echo "Content sync timer: systemctl --user status misell-content-sync.timer"
echo "Log rotate timer: systemctl --user status misell-log-rotate.timer"
echo "For boot without manual login, consider: sudo loginctl enable-linger ${USER}"
