#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"
PORT="${PORT:-3000}"
STATUS_URL="${MISELL_STATUS_URL:-http://localhost:${PORT}/api/status}"
HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
  PORT="${PORT:-3000}"
  STATUS_URL="${MISELL_STATUS_URL:-http://localhost:${PORT}/api/status}"
  HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
  DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to emit heartbeat" >&2
  exit 1
fi

payload="$(curl -fsS --max-time 10 "${STATUS_URL}")"

if [[ -z "${HEARTBEAT_URL}" ]]; then
  echo "${payload}"
  exit 0
fi

headers=(-H "Content-Type: application/json")
if [[ -n "${DEVICE_TOKEN}" ]]; then
  headers+=(-H "Authorization: Bearer ${DEVICE_TOKEN}")
else
  echo "MISELL_HEARTBEAT_URL is set but MISELL_DEVICE_TOKEN is empty" >&2
  exit 1
fi

curl -fsS --max-time 20 \
  -X POST \
  "${headers[@]}" \
  --data-binary "${payload}" \
  "${HEARTBEAT_URL}"
