#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-3000}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT_DIR="${1:-${APP_DIR}/evidence/${STAMP}}"

mkdir -p "${OUT_DIR}"

run_capture() {
  local name="$1"
  shift
  {
    echo "\$ $*"
    echo
    "$@" 2>&1 || true
  } > "${OUT_DIR}/${name}.txt"
}

capture_shell() {
  local name="$1"
  local command="$2"
  {
    echo "\$ ${command}"
    echo
    bash -lc "${command}" 2>&1 || true
  } > "${OUT_DIR}/${name}.txt"
}

run_capture "date" date
run_capture "hostname" hostname
run_capture "uname" uname -a
run_capture "uptime" uptime
run_capture "disk" df -h
run_capture "memory" free -h
capture_shell "cpu_load" "top -bn1 | head -n 20"
capture_shell "network" "ip addr && echo && ip route"
capture_shell "node_versions" "node --version && npm --version"
capture_shell "chromium_version" "chromium-browser --version || chromium --version || google-chrome --version || google-chrome-stable --version"
capture_shell "xrandr" "xrandr --query"
capture_shell "display_env" "env | grep -E '^(DISPLAY|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP)='"
capture_shell "temperature" "sensors || cat /sys/class/thermal/thermal_zone*/temp"
capture_shell "misell_health" "curl -fsS http://localhost:${PORT}/api/health"
capture_shell "misell_status" "curl -fsS http://localhost:${PORT}/api/status"
capture_shell "misell_heartbeat" "'${APP_DIR}/scripts/emit-heartbeat.sh'"
capture_shell "misell_playlist" "curl -fsS http://localhost:${PORT}/api/playlist"
capture_shell "misell_services" "systemctl --user status misell-player.service misell-kiosk.service misell-heartbeat.timer misell-log-rotate.timer --no-pager"
capture_shell "misell_journal_player" "journalctl --user -u misell-player.service -n 200 --no-pager"
capture_shell "misell_journal_kiosk" "journalctl --user -u misell-kiosk.service -n 200 --no-pager"
capture_shell "misell_journal_heartbeat" "journalctl --user -u misell-heartbeat.service -n 100 --no-pager"
capture_shell "misell_journal_log_rotate" "journalctl --user -u misell-log-rotate.service -n 100 --no-pager"
capture_shell "misell_logs" "find '${APP_DIR}/logs' -maxdepth 1 -type f \\( -name '*.jsonl' -o -name '*.log' \\) -print -exec tail -n 20 {} \\;"

cat > "${OUT_DIR}/README.md" <<EOF
# Misell Device Evidence ${STAMP}

Fill this after the device test.

- Device:
- Store:
- Location:
- Screen group:
- Tester:
- Test start:
- Test end:

## Gate Results

- Gate 1 Local Dev Pass:
- Gate 2 Device Display Pass:
- Gate 3 Security Minimum Pass:
- Gate 4 Burn-in Pass:
- Gate 5 Demo Ready Pass:

## Notes

- Display order:
- Kiosk behavior:
- Playback issues:
- Upload/security tests:
- CPU/RAM/temperature observations:
- Follow-up issues:
EOF

echo "Evidence captured in ${OUT_DIR}"
