#!/usr/bin/env bash
set -euo pipefail

APPLY=0
APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APT_PACKAGES=(
  curl
  ffmpeg
  ufw
  x11-xserver-utils
  chromium-browser
  lm-sensors
)

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-ubuntu-device.sh [--apply]

Checks and installs the baseline Ubuntu packages for a Misell local player.
Default mode is dry-run. Use --apply on the actual terminal after reviewing output.

If the Ubuntu package source does not provide Node.js 20+, set:
  MISELL_INSTALL_NODESOURCE=1 scripts/setup-ubuntu-device.sh --apply
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
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

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node --version | sed -E 's/^v([0-9]+).*/\1/'
}

echo "Misell Ubuntu device setup"
echo "app_dir=${APP_DIR}"

if [[ "${APPLY}" != "1" ]]; then
  echo "DRY RUN. No changes will be applied. Re-run with --apply to install packages."
fi

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  echo "os=${PRETTY_NAME:-unknown}"
else
  echo "os=unknown"
fi

if command -v apt-get >/dev/null 2>&1; then
  run sudo apt-get update
  run sudo apt-get install -y "${APT_PACKAGES[@]}"
else
  echo "apt-get not found. This script targets Ubuntu terminals." >&2
fi

NODE_MAJOR="$(node_major)"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node.js 20+ is required. Current major version: ${NODE_MAJOR}."
  if [[ "${APPLY}" == "1" ]]; then
    if [[ "${MISELL_INSTALL_NODESOURCE:-0}" == "1" ]]; then
      run bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
      run sudo apt-get install -y nodejs
      NODE_MAJOR="$(node_major)"
      if [[ "${NODE_MAJOR}" -lt 20 ]]; then
        echo "Node.js 20+ installation did not complete. Current major version: ${NODE_MAJOR}." >&2
        exit 1
      fi
    else
      echo "Install Node.js 20+ using your approved package source before production use."
      echo "To use NodeSource explicitly: MISELL_INSTALL_NODESOURCE=1 scripts/setup-ubuntu-device.sh --apply"
      exit 1
    fi
  else
    echo "Install Node.js 20+ using your approved package source before production use."
    echo "Dry-run only: NodeSource install would run when MISELL_INSTALL_NODESOURCE=1 and --apply are both set."
  fi
else
  echo "Node.js version OK: $(node --version)"
fi

if [[ "${APPLY}" == "1" ]]; then
  (cd "${APP_DIR}" && npm install --omit=dev)
else
  echo "+ (cd ${APP_DIR} && npm install --omit=dev)"
fi

echo
echo "Next steps:"
echo "1. Review xrandr outputs: xrandr --query"
echo "2. Configure three displays: scripts/set-display-3x.sh"
echo "3. Install services: scripts/setup-autostart.sh"
echo "4. Apply security baseline after LAN CIDR is known: MISELL_LAN_CIDR=192.168.1.0/24 scripts/setup-ubuntu-security.sh --apply"
