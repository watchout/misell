#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-3000}"
SERVICE_NAME="${MISELL_PLAYER_SERVICE:-misell-player.service}"
APPLY=0
RESTART_SERVICE=1
SKIP_AUDIT=0
REF=""
PREVIOUS_REF=""

usage() {
  cat <<'EOF'
Usage:
  scripts/update-player.sh [--apply] [--ref GIT_REF] [--skip-audit] [--no-restart]

Default is dry-run. For MVP deployments this performs:
  1. optional git fetch/update
  2. npm install --omit=dev
  3. npm run check
  4. npm run validate:playlist
  5. npm audit --audit-level=moderate
  6. systemd user service restart
  7. local /api/health check

Commercial deployments should use release bundles/manifests instead of direct git pull.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --ref)
      REF="$2"
      shift 2
      ;;
    --skip-audit)
      SKIP_AUDIT=1
      shift
      ;;
    --no-restart)
      RESTART_SERVICE=0
      shift
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

run() {
  echo "+ $*"
  if [[ "${APPLY}" == "1" ]]; then
    "$@"
  fi
}

health_check() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is not installed; skipping health check" >&2
    return 0
  fi

  for _ in {1..30}; do
    if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
      echo "health check passed"
      return 0
    fi
    sleep 1
  done

  echo "health check failed" >&2
  return 1
}

restart_player() {
  if [[ "${RESTART_SERVICE}" != "1" ]]; then
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl --user list-unit-files "${SERVICE_NAME}" >/dev/null 2>&1; then
    run systemctl --user restart "${SERVICE_NAME}"
  else
    echo "systemd user service ${SERVICE_NAME} not found; start manually with npm start"
  fi
}

rollback() {
  local status="$1"
  if [[ "${APPLY}" != "1" || -z "${PREVIOUS_REF}" || ! -d "${APP_DIR}/.git" ]]; then
    exit "${status}"
  fi

  echo "update failed; rolling back to ${PREVIOUS_REF}" >&2
  (
    cd "${APP_DIR}"
    git checkout --detach "${PREVIOUS_REF}" || true
    npm install --omit=dev || true
  )
  restart_player || true
  health_check || true
  exit "${status}"
}

trap 'rollback $?' ERR

cd "${APP_DIR}"

echo "Misell player update"
echo "app_dir=${APP_DIR}"
echo "apply=${APPLY}"
echo "ref=${REF:-<current-branch>}"

if [[ -d .git ]]; then
  PREVIOUS_REF="$(git rev-parse HEAD)"
  echo "current_git=${PREVIOUS_REF}"
  run git fetch --all --prune
  if [[ -n "${REF}" ]]; then
    run git checkout --detach "${REF}"
  else
    run git pull --ff-only
  fi
else
  echo "No .git directory in ${APP_DIR}; source update is skipped."
fi

run npm install --omit=dev
run npm run check
run npm run validate:playlist
if [[ "${SKIP_AUDIT}" != "1" ]]; then
  run npm audit --audit-level=moderate
fi

restart_player

if [[ "${APPLY}" == "1" && "${RESTART_SERVICE}" == "1" ]]; then
  health_check
fi

echo "Update flow complete."
