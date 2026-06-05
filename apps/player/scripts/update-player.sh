#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"
PORT="${PORT:-3000}"
SERVICE_NAME="${MISELL_PLAYER_SERVICE:-misell-player.service}"
APPLY=0
RESTART_SERVICE=1
SKIP_AUDIT=0
REF=""
TARGET_RELEASE_ID=""
TARGET_RELEASE_CHANNEL=""
PREVIOUS_REF=""
PREVIOUS_ENV_RELEASE_ID=""
PREVIOUS_ENV_RELEASE_CHANNEL=""
GIT_ROOT=""

usage() {
  cat <<'EOF'
Usage:
  scripts/update-player.sh [--apply] [--ref GIT_REF] [--release-id ID] [--release-channel CHANNEL] [--skip-audit] [--no-restart]

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
    --release-id)
      TARGET_RELEASE_ID="$2"
      shift 2
      ;;
    --release-channel)
      TARGET_RELEASE_CHANNEL="$2"
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

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi
PREVIOUS_ENV_RELEASE_ID="${MISELL_RELEASE_ID:-${RELEASE_ID:-}}"
PREVIOUS_ENV_RELEASE_CHANNEL="${MISELL_RELEASE_CHANNEL:-}"

run() {
  echo "+ $*"
  if [[ "${APPLY}" == "1" ]]; then
    "$@"
  fi
}

set_env_setting() {
  local key="$1"
  local value="$2"
  echo "+ set ${key} in ${ENV_FILE}"
  if [[ "${APPLY}" != "1" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "${ENV_FILE}")"
  touch "${ENV_FILE}"
  chmod 600 "${ENV_FILE}" 2>/dev/null || true
  local temp_file
  temp_file="$(mktemp "${ENV_FILE}.XXXXXX")"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { done = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      done = 1
      next
    }
    { print }
    END {
      if (!done) print key "=" value
    }
  ' "${ENV_FILE}" > "${temp_file}"
  chmod 600 "${temp_file}" 2>/dev/null || true
  mv "${temp_file}" "${ENV_FILE}"
}

validate_git_ref() {
  local ref="$1"
  if [[ -z "${ref}" ]]; then
    return 0
  fi
  if [[ ! "${ref}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ ]]; then
    echo "--ref must be a safe git ref, tag, or commit hash" >&2
    exit 1
  fi
  if [[ "${ref}" == *..* || "${ref}" == *//* || "${ref}" == *@\{* || "${ref}" == *.lock ]]; then
    echo "--ref contains an invalid git ref sequence" >&2
    exit 1
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
  if [[ "${APPLY}" != "1" || -z "${PREVIOUS_REF}" || -z "${GIT_ROOT}" ]]; then
    exit "${status}"
  fi

  echo "update failed; rolling back to ${PREVIOUS_REF}" >&2
  (
    git -C "${GIT_ROOT}" checkout --detach "${PREVIOUS_REF}" || true
    cd "${APP_DIR}"
    npm install --omit=dev || true
  )
  if [[ -n "${TARGET_RELEASE_ID}" ]]; then
    set_env_setting "MISELL_RELEASE_ID" "${PREVIOUS_ENV_RELEASE_ID}" || true
  fi
  if [[ -n "${TARGET_RELEASE_CHANNEL}" ]]; then
    set_env_setting "MISELL_RELEASE_CHANNEL" "${PREVIOUS_ENV_RELEASE_CHANNEL}" || true
  fi
  restart_player || true
  health_check || true
  exit "${status}"
}

trap 'rollback $?' ERR

cd "${APP_DIR}"
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

echo "Misell player update"
echo "app_dir=${APP_DIR}"
echo "git_root=${GIT_ROOT:-<none>}"
echo "apply=${APPLY}"
echo "ref=${REF:-<current-branch>}"
echo "release_id=${TARGET_RELEASE_ID:-<unchanged>}"
echo "release_channel=${TARGET_RELEASE_CHANNEL:-<unchanged>}"
validate_git_ref "${REF}"

if [[ -n "${GIT_ROOT}" ]]; then
  PREVIOUS_REF="$(git -C "${GIT_ROOT}" rev-parse HEAD)"
  echo "current_git=${PREVIOUS_REF}"
  run git -C "${GIT_ROOT}" fetch --all --prune
  if [[ -n "${REF}" ]]; then
    run git -C "${GIT_ROOT}" checkout --detach "${REF}"
  else
    run git -C "${GIT_ROOT}" pull --ff-only
  fi
else
  echo "No Git checkout found for ${APP_DIR}; source update is skipped."
fi

run npm install --omit=dev
run npm run check
run npm run validate:playlist
if [[ "${SKIP_AUDIT}" != "1" ]]; then
  run npm audit --audit-level=moderate
fi

if [[ -n "${TARGET_RELEASE_ID}" ]]; then
  set_env_setting "MISELL_RELEASE_ID" "${TARGET_RELEASE_ID}"
fi
if [[ -n "${TARGET_RELEASE_CHANNEL}" ]]; then
  set_env_setting "MISELL_RELEASE_CHANNEL" "${TARGET_RELEASE_CHANNEL}"
fi

restart_player

if [[ "${APPLY}" == "1" && "${RESTART_SERVICE}" == "1" ]]; then
  health_check
fi

echo "Update flow complete."
