#!/usr/bin/env bash
set -euo pipefail

DEFAULT_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

APP_DIR="${MISELL_HOME:-${DEFAULT_APP_DIR}}"
PORT="${PORT:-3000}"
LOG_DIR="${MISELL_LOG_DIR:-${APP_DIR}/logs}"
HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
LOGS_URL="${MISELL_LOGS_URL:-}"
DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT_DIR=""
UPLOAD=0
LABEL="${MISELL_EVIDENCE_LABEL:-manual}"
REASON="${MISELL_EVIDENCE_REASON:-}"

usage() {
  cat <<'EOF'
Usage:
  scripts/collect-device-evidence.sh [options] [out_dir]

Options:
  --upload             Upload the captured evidence to Misell Cloud.
  --logs-url URL       Cloud log upload endpoint. Derived from MISELL_HEARTBEAT_URL when possible.
  --label LABEL        Short upload label. Default: manual
  --reason TEXT        Reason or incident note for this collection.

Environment:
  MISELL_HEARTBEAT_URL, MISELL_LOGS_URL, MISELL_DEVICE_TOKEN, MISELL_LOG_DIR
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload)
      UPLOAD=1
      shift
      ;;
    --logs-url)
      LOGS_URL="$2"
      shift 2
      ;;
    --label)
      LABEL="$2"
      shift 2
      ;;
    --reason)
      REASON="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      OUT_DIR="$1"
      shift
      ;;
  esac
done

OUT_DIR="${OUT_DIR:-${APP_DIR}/evidence/${STAMP}}"

if [[ -z "${LOGS_URL}" && "${HEARTBEAT_URL}" == */api/device/heartbeat ]]; then
  LOGS_URL="${HEARTBEAT_URL%/api/device/heartbeat}/api/device/logs"
fi

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
capture_shell "misell_services" "systemctl --user status misell-player.service misell-kiosk.service misell-heartbeat.timer misell-update.timer misell-log-rotate.timer --no-pager"
capture_shell "misell_journal_player" "journalctl --user -u misell-player.service -n 200 --no-pager"
capture_shell "misell_journal_kiosk" "journalctl --user -u misell-kiosk.service -n 200 --no-pager"
capture_shell "misell_journal_heartbeat" "journalctl --user -u misell-heartbeat.service -n 100 --no-pager"
capture_shell "misell_journal_update" "journalctl --user -u misell-update.service -n 100 --no-pager"
capture_shell "misell_journal_log_rotate" "journalctl --user -u misell-log-rotate.service -n 100 --no-pager"
capture_shell "misell_logs" "find '${LOG_DIR}' -maxdepth 1 -type f \\( -name '*.jsonl' -o -name '*.log' \\) -print -exec tail -n 20 {} \\;"

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

if [[ "${UPLOAD}" == "1" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to build the upload payload" >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to upload evidence" >&2
    exit 1
  fi
  if [[ -z "${LOGS_URL}" ]]; then
    echo "Log upload URL is not configured. Set MISELL_LOGS_URL or MISELL_HEARTBEAT_URL." >&2
    exit 1
  fi
  if [[ -z "${DEVICE_TOKEN}" ]]; then
    echo "MISELL_DEVICE_TOKEN is required to upload evidence" >&2
    exit 1
  fi

  PAYLOAD_FILE="${OUT_DIR}/cloud-log-payload.json"
  MISELL_EVIDENCE_DIR="${OUT_DIR}" \
  MISELL_EVIDENCE_STAMP="${STAMP}" \
  MISELL_EVIDENCE_LABEL="${LABEL}" \
  MISELL_EVIDENCE_REASON="${REASON}" \
  MISELL_APP_DIR="${APP_DIR}" \
  MISELL_EVIDENCE_MAX_ENTRY_BYTES="${MISELL_EVIDENCE_MAX_ENTRY_BYTES:-20000}" \
  MISELL_EVIDENCE_MAX_TOTAL_BYTES="${MISELL_EVIDENCE_MAX_TOTAL_BYTES:-450000}" \
  MISELL_TENANT_ID="${MISELL_TENANT_ID:-}" \
  MISELL_STORE_ID="${MISELL_STORE_ID:-}" \
  MISELL_LOCATION_ID="${MISELL_LOCATION_ID:-}" \
  MISELL_SCREEN_GROUP_ID="${MISELL_SCREEN_GROUP_ID:-}" \
  MISELL_DEVICE_ID="${MISELL_DEVICE_ID:-}" \
  MISELL_RELEASE_ID="${MISELL_RELEASE_ID:-}" \
  MISELL_RELEASE_CHANNEL="${MISELL_RELEASE_CHANNEL:-}" \
  MISELL_CONFIG_VERSION="${MISELL_CONFIG_VERSION:-}" \
  node <<'NODE' > "${PAYLOAD_FILE}"
const fs = require("fs");
const os = require("os");
const path = require("path");

const outDir = process.env.MISELL_EVIDENCE_DIR;
const maxEntryBytes = boundedNumber(process.env.MISELL_EVIDENCE_MAX_ENTRY_BYTES, 20000, 1024, 100000);
const maxTotalBytes = boundedNumber(process.env.MISELL_EVIDENCE_MAX_TOTAL_BYTES, 450000, 16384, 900000);

function boundedNumber(value, fallback, min, max) {
  const number = Number.parseInt(value || "", 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function readBounded(filePath, maxBytes) {
  const text = fs.readFileSync(filePath, "utf8").replace(/\0/g, "");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return { content: text, originalBytes: buffer.length, truncated: false };
  }
  const headBytes = Math.floor(maxBytes * 0.4);
  const tailBytes = Math.max(0, maxBytes - headBytes - 28);
  return {
    content: `${buffer.subarray(0, headBytes).toString("utf8")}\n... truncated ...\n${buffer.subarray(buffer.length - tailBytes).toString("utf8")}`,
    originalBytes: buffer.length,
    truncated: true
  };
}

let totalBytes = 0;
const entries = [];
for (const filename of fs.readdirSync(outDir).sort()) {
  if (filename === "cloud-log-payload.json") continue;
  if (!filename.endsWith(".txt") && filename !== "README.md") continue;
  if (totalBytes >= maxTotalBytes) break;

  const filePath = path.join(outDir, filename);
  if (!fs.statSync(filePath).isFile()) continue;

  const remainingBytes = maxTotalBytes - totalBytes;
  const bounded = readBounded(filePath, Math.min(maxEntryBytes, remainingBytes));
  const bytes = Buffer.byteLength(bounded.content, "utf8");
  entries.push({
    name: filename.replace(/\.(txt|md)$/i, ""),
    filename,
    kind: "text",
    content: bounded.content,
    bytes,
    original_bytes: bounded.originalBytes,
    truncated: bounded.truncated
  });
  totalBytes += bytes;
}

let appVersion = "";
try {
  appVersion = JSON.parse(fs.readFileSync(path.join(process.env.MISELL_APP_DIR || process.cwd(), "package.json"), "utf8")).version || "";
} catch {
  appVersion = "";
}

const payload = {
  device_id: process.env.MISELL_DEVICE_ID || "",
  tenant_id: process.env.MISELL_TENANT_ID || "",
  store_id: process.env.MISELL_STORE_ID || "",
  location_id: process.env.MISELL_LOCATION_ID || "",
  screen_group_id: process.env.MISELL_SCREEN_GROUP_ID || "",
  captured_at: new Date().toISOString(),
  label: process.env.MISELL_EVIDENCE_LABEL || "manual",
  reason: process.env.MISELL_EVIDENCE_REASON || "",
  source: "collect-device-evidence.sh",
  hostname: os.hostname(),
  app_version: appVersion,
  release_id: process.env.MISELL_RELEASE_ID || "",
  release_channel: process.env.MISELL_RELEASE_CHANNEL || "",
  config_version: process.env.MISELL_CONFIG_VERSION || "",
  stamp: process.env.MISELL_EVIDENCE_STAMP || "",
  entries
};

process.stdout.write(JSON.stringify(payload));
NODE

  curl -fsS --max-time 90 \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    --data-binary "@${PAYLOAD_FILE}" \
    "${LOGS_URL}"
  echo
  echo "Evidence uploaded to ${LOGS_URL}"
fi
