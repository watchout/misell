#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-3000}"
PLAYER_URL="${MISELL_PLAYER_URL:-http://localhost:${PORT}/player}"
WIDTH="${MISELL_KIOSK_WIDTH:-5760}"
HEIGHT="${MISELL_KIOSK_HEIGHT:-1080}"
PROFILE_DIR="${MISELL_CHROME_PROFILE:-/tmp/misell-chromium-profile}"

if [[ "${MISELL_SET_DISPLAY:-0}" == "1" ]]; then
  "${APP_DIR}/scripts/set-display-3x.sh"
fi

find_chromium() {
  command -v chromium-browser 2>/dev/null \
    || command -v chromium 2>/dev/null \
    || command -v google-chrome 2>/dev/null \
    || command -v google-chrome-stable 2>/dev/null
}

CHROMIUM_BIN="$(find_chromium || true)"
if [[ -z "${CHROMIUM_BIN}" ]]; then
  echo "Chromium not found. Install with: sudo apt install chromium-browser" >&2
  exit 1
fi

mkdir -p "${PROFILE_DIR}"

if command -v curl >/dev/null 2>&1; then
  for _ in {1..60}; do
    if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

exec "${CHROMIUM_BIN}" \
  --kiosk "${PLAYER_URL}" \
  --window-position=0,0 \
  --window-size="${WIDTH},${HEIGHT}" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --autoplay-policy=no-user-gesture-required
