#!/usr/bin/env bash
set -euo pipefail

APPLY=0
ADMIN_PORT="${PORT:-3000}"
LAN_CIDR="${MISELL_LAN_CIDR:-}"
TAILSCALE_CIDR="${MISELL_TAILSCALE_CIDR:-100.64.0.0/10}"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-ubuntu-security.sh [--apply]

Environment:
  PORT=3000                         Admin port to allow for MVP LAN access.
  MISELL_LAN_CIDR=192.168.1.0/24    LAN CIDR allowed to reach /admin.
  MISELL_TAILSCALE_CIDR=100.64.0.0/10 CIDR allowed to SSH.

Default mode is dry-run. Use --apply to run sudo ufw and SSH hardening commands.
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

write_ssh_hardening() {
  local target="/etc/ssh/sshd_config.d/99-misell-hardening.conf"
  echo "+ write ${target}"
  if [[ "${APPLY}" == "1" ]]; then
    sudo mkdir -p /etc/ssh/sshd_config.d
    sudo tee "${target}" >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl reload ssh || sudo systemctl reload sshd
    fi
  fi
}

if [[ "${APPLY}" != "1" ]]; then
  echo "DRY RUN. No changes will be applied. Re-run with --apply to configure this terminal."
fi

if ! command -v ufw >/dev/null 2>&1; then
  if [[ "${APPLY}" == "1" ]]; then
    echo "ufw is not installed. Install it with: sudo apt install ufw" >&2
    exit 1
  fi
  echo "ufw is not installed. Dry-run will still print the intended commands."
fi

run sudo ufw default deny incoming
run sudo ufw default allow outgoing

if [[ -n "${TAILSCALE_CIDR}" ]]; then
  run sudo ufw allow from "${TAILSCALE_CIDR}" to any port 22 proto tcp
fi

if [[ -n "${LAN_CIDR}" ]]; then
  run sudo ufw allow from "${LAN_CIDR}" to any port "${ADMIN_PORT}" proto tcp
else
  echo "MISELL_LAN_CIDR is empty; admin port ${ADMIN_PORT}/tcp will not be opened."
fi

write_ssh_hardening
run sudo ufw --force enable
run sudo ufw status verbose

if [[ "${APPLY}" == "1" ]]; then
  echo "Security baseline complete."
else
  echo "Security baseline dry-run complete."
fi
