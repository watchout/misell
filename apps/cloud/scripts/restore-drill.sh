#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_CLOUD_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_CLOUD_ENV_FILE:-${HOME}/.config/misell-cloud/env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

exec node "${APP_DIR}/scripts/restore-drill.mjs" "$@"
