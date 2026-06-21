#!/usr/bin/env bash
set -euo pipefail

APPLY=0
LABEL="${MISELL_CLOUD_BACKUP_LABEL:-com.misell.cloud.backup}"
APP_DIR="${MISELL_CLOUD_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_CLOUD_ENV_FILE:-${HOME}/.config/misell-cloud/env}"
STARTER="${MISELL_CLOUD_BACKUP_STARTER:-${HOME}/.local/bin/misell-cloud-backup}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
RUNTIME_DIR="${MISELL_CLOUD_RUNTIME_DIR:-${HOME}/.local/share/misell-cloud}"
BACKUP_DIR="${MISELL_CLOUD_BACKUP_DIR:-${RUNTIME_DIR}/backups}"
LOG_DIR="${MISELL_CLOUD_LOG_DIR:-${RUNTIME_DIR}/logs}"
INTERVAL_SECONDS="${MISELL_CLOUD_BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${MISELL_CLOUD_BACKUP_RETENTION_DAYS:-30}"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-macos-backup-launchagent.sh [--apply] [--interval-seconds N] [--retention-days N]

Default is dry-run. This creates a user LaunchAgent that runs
scripts/backup-sqlite.sh on a fixed interval. Offsite S3-compatible backup
settings are read by backup-sqlite.sh from the configured env file.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --interval-seconds)
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --retention-days)
      RETENTION_DAYS="$2"
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

echo "Misell cloud backup launch agent setup"
echo "app_dir=${APP_DIR}"
echo "env_file=${ENV_FILE}"
echo "backup_dir=${BACKUP_DIR}"
echo "log_dir=${LOG_DIR}"
echo "interval_seconds=${INTERVAL_SECONDS}"
echo "retention_days=${RETENTION_DAYS}"
echo "starter=${STARTER}"
echo "plist=${PLIST}"
echo "s3_uri=${MISELL_CLOUD_BACKUP_S3_URI:-<env-file or disabled>}"

if [[ "${APPLY}" != "1" ]]; then
  echo "DRY RUN. Re-run with --apply to write files and restart launch agent."
  exit 0
fi

mkdir -p "$(dirname "${STARTER}")" "$(dirname "${PLIST}")" "${BACKUP_DIR}" "${LOG_DIR}"

STARTER_TMP="$(mktemp "${STARTER}.XXXXXX")"
cat > "${STARTER_TMP}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export MISELL_CLOUD_HOME="${APP_DIR}"
export MISELL_CLOUD_ENV_FILE="${ENV_FILE}"
export MISELL_CLOUD_BACKUP_DIR="${BACKUP_DIR}"
export MISELL_CLOUD_BACKUP_RETENTION_DAYS="${RETENTION_DAYS}"
exec "${APP_DIR}/scripts/backup-sqlite.sh"
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
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/misell-cloud-backup.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/misell-cloud-backup.err</string>
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
