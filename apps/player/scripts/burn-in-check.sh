#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_FILE="${MISELL_BURN_IN_LOG:-${APP_DIR}/logs/burn-in.log}"
INTERVAL_SECONDS="${MISELL_BURN_IN_INTERVAL_SECONDS:-60}"
DURATION_SECONDS="${MISELL_BURN_IN_DURATION_SECONDS:-21600}"
PORT="${PORT:-3000}"

mkdir -p "$(dirname "${LOG_FILE}")"

end_at=$(( $(date +%s) + DURATION_SECONDS ))

iso_now() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

echo "burn-in started at $(iso_now)" | tee -a "${LOG_FILE}"
echo "interval=${INTERVAL_SECONDS}s duration=${DURATION_SECONDS}s port=${PORT}" | tee -a "${LOG_FILE}"

while [[ "$(date +%s)" -le "${end_at}" ]]; do
  {
    echo "----- $(iso_now) -----"
    echo "[uptime]"
    uptime || true
    echo "[disk]"
    df -h "${APP_DIR}" || true
    echo "[memory]"
    free -h 2>/dev/null || vm_stat 2>/dev/null || true
    echo "[cpu]"
    top -bn1 2>/dev/null | head -n 12 || top -l 1 | head -n 12 || true
    echo "[temperature]"
    sensors 2>/dev/null || cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null || true
    echo "[misell health]"
    curl -fsS "http://localhost:${PORT}/api/health" 2>/dev/null || true
    echo
  } >> "${LOG_FILE}"
  sleep "${INTERVAL_SECONDS}"
done

echo "burn-in finished at $(iso_now)" | tee -a "${LOG_FILE}"
