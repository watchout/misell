#!/usr/bin/env bash
set -euo pipefail

LEFT_OUTPUT="${1:-${MISELL_LEFT_OUTPUT:-HDMI-1}}"
CENTER_OUTPUT="${2:-${MISELL_CENTER_OUTPUT:-DP-1}}"
RIGHT_OUTPUT="${3:-${MISELL_RIGHT_OUTPUT:-DP-2}}"
MODE="${MISELL_DISPLAY_MODE:-1920x1080}"

if ! command -v xrandr >/dev/null 2>&1; then
  echo "xrandr not found. Install with: sudo apt install x11-xserver-utils" >&2
  exit 1
fi

for output in "${LEFT_OUTPUT}" "${CENTER_OUTPUT}" "${RIGHT_OUTPUT}"; do
  if ! xrandr --query | grep -q "^${output} connected"; then
    echo "Display output '${output}' is not connected." >&2
    echo "Run 'xrandr --query' and set MISELL_LEFT_OUTPUT, MISELL_CENTER_OUTPUT, MISELL_RIGHT_OUTPUT." >&2
    xrandr --query >&2
    exit 1
  fi
done

xrandr \
  --output "${LEFT_OUTPUT}" --mode "${MODE}" --pos 0x0 --rotate normal \
  --output "${CENTER_OUTPUT}" --mode "${MODE}" --pos 1920x0 --rotate normal \
  --output "${RIGHT_OUTPUT}" --mode "${MODE}" --pos 3840x0 --rotate normal

echo "Configured 3 displays as ${MODE} x 3: ${LEFT_OUTPUT}, ${CENTER_OUTPUT}, ${RIGHT_OUTPUT}"
