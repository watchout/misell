#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${MISELL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${MISELL_ENV_FILE:-${HOME}/.config/misell-player/env}"
HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-}"
CONTENT_URL="${MISELL_CONTENT_URL:-}"
ASSET_RESULT_URL="${MISELL_ASSET_RESULT_URL:-}"
CLOUD_BASE_URL="${MISELL_CLOUD_BASE_URL:-}"
DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
ASSETS_DIR="${MISELL_ASSETS_DIR:-${APP_DIR}/assets}"
ASSET_QUARANTINE_DIR="${MISELL_ASSET_QUARANTINE_DIR:-}"
VALIDATE_MEDIA_ASSETS="${MISELL_VALIDATE_MEDIA_ASSETS:-1}"
VALIDATE_MEDIA_WITH_FFPROBE="${MISELL_VALIDATE_MEDIA_WITH_FFPROBE:-0}"
ASSET_QUARANTINE_RETENTION_DAYS="${MISELL_ASSET_QUARANTINE_RETENTION_DAYS:-30}"
ASSET_QUARANTINE_MAX_FILES="${MISELL_ASSET_QUARANTINE_MAX_FILES:-200}"
ASSET_QUARANTINE_MAX_BYTES="${MISELL_ASSET_QUARANTINE_MAX_BYTES:-524288000}"
LOCK_FILE="${MISELL_ASSET_SYNC_LOCK_FILE:-${HOME}/.local/share/misell-player/asset-sync.lock}"
APPLY=1

usage() {
  cat <<'EOF'
Usage:
  scripts/sync-assets.sh [--dry-run]

Fetches the active Cloud content manifest, downloads required image/video
assets, verifies sha256, and writes them under the local assets directory.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      APPLY=0
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
  HEARTBEAT_URL="${MISELL_HEARTBEAT_URL:-${HEARTBEAT_URL}}"
  CONTENT_URL="${MISELL_CONTENT_URL:-${CONTENT_URL}}"
  ASSET_RESULT_URL="${MISELL_ASSET_RESULT_URL:-${ASSET_RESULT_URL}}"
  CLOUD_BASE_URL="${MISELL_CLOUD_BASE_URL:-${CLOUD_BASE_URL}}"
  DEVICE_TOKEN="${MISELL_DEVICE_TOKEN:-${DEVICE_TOKEN:-}}"
  ASSETS_DIR="${MISELL_ASSETS_DIR:-${ASSETS_DIR}}"
  ASSET_QUARANTINE_DIR="${MISELL_ASSET_QUARANTINE_DIR:-${ASSET_QUARANTINE_DIR}}"
  VALIDATE_MEDIA_ASSETS="${MISELL_VALIDATE_MEDIA_ASSETS:-${VALIDATE_MEDIA_ASSETS}}"
  VALIDATE_MEDIA_WITH_FFPROBE="${MISELL_VALIDATE_MEDIA_WITH_FFPROBE:-${VALIDATE_MEDIA_WITH_FFPROBE}}"
  ASSET_QUARANTINE_RETENTION_DAYS="${MISELL_ASSET_QUARANTINE_RETENTION_DAYS:-${ASSET_QUARANTINE_RETENTION_DAYS}}"
  ASSET_QUARANTINE_MAX_FILES="${MISELL_ASSET_QUARANTINE_MAX_FILES:-${ASSET_QUARANTINE_MAX_FILES}}"
  ASSET_QUARANTINE_MAX_BYTES="${MISELL_ASSET_QUARANTINE_MAX_BYTES:-${ASSET_QUARANTINE_MAX_BYTES}}"
fi

ASSET_QUARANTINE_DIR="${ASSET_QUARANTINE_DIR:-${ASSETS_DIR}/.quarantine}"

derive_asset_urls() {
  if [[ "${HEARTBEAT_URL}" == */api/device/heartbeat ]]; then
    local base_url="${HEARTBEAT_URL%/api/device/heartbeat}"
    CONTENT_URL="${CONTENT_URL:-${base_url}/api/device/content-policy}"
    ASSET_RESULT_URL="${ASSET_RESULT_URL:-${base_url}/api/device/asset-result}"
    CLOUD_BASE_URL="${CLOUD_BASE_URL:-${base_url}}"
  fi
  if [[ "${CONTENT_URL}" == */api/device/content-policy ]]; then
    local base_url="${CONTENT_URL%/api/device/content-policy}"
    ASSET_RESULT_URL="${ASSET_RESULT_URL:-${base_url}/api/device/asset-result}"
    CLOUD_BASE_URL="${CLOUD_BASE_URL:-${base_url}}"
  fi
}

json_content_value() {
  local field="$1"
  POLICY_JSON="${policy}" FIELD="${field}" node -e '
    const data = JSON.parse(process.env.POLICY_JSON || "{}");
    const content = data.content || {};
    const field = process.env.FIELD;
    if (field === "asset_count") {
      process.stdout.write(String(Array.isArray(content.assets) ? content.assets.length : 0));
    } else {
      process.stdout.write(String(content[field] || ""));
    }
  '
}

asset_lines_from_policy() {
  POLICY_JSON="${policy}" node -e '
    const data = JSON.parse(process.env.POLICY_JSON || "{}");
    const assets = Array.isArray(data.content && data.content.assets) ? data.content.assets : [];
    for (const asset of assets) {
      const values = [
        String(asset.asset_id || ""),
        String(asset.target_path || ""),
        String(asset.download_url || ""),
        String(asset.sha256 || ""),
        String(Number(asset.size || 0)),
        asset.required === false ? "0" : "1"
      ];
      console.log(values.join("\t"));
    }
  '
}

local_path_for_target() {
  local target_path="$1"
  TARGET_PATH="${target_path}" ASSETS_DIR="${ASSETS_DIR}" node -e '
    const path = require("path");
    const target = process.env.TARGET_PATH || "";
    const assetsDir = path.resolve(process.env.ASSETS_DIR || "assets");
    let subdir = "";
    let filename = "";
    if (target.startsWith("/assets/images/")) {
      subdir = "images";
      filename = target.slice("/assets/images/".length);
    } else if (target.startsWith("/assets/videos/")) {
      subdir = "videos";
      filename = target.slice("/assets/videos/".length);
    } else {
      throw new Error("target_path must start with /assets/images/ or /assets/videos/");
    }
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..") || !/^[a-zA-Z0-9_.:-]+$/.test(filename)) {
      throw new Error("target_path must end with a safe filename");
    }
    const resolved = path.resolve(assetsDir, subdir, filename);
    if (resolved !== assetsDir && !resolved.startsWith(`${assetsDir}${path.sep}`)) {
      throw new Error("target_path resolves outside assets directory");
    }
    process.stdout.write(resolved);
  '
}

sha256_file() {
  local file_path="$1"
  FILE_PATH="${file_path}" node -e '
    const crypto = require("crypto");
    const fs = require("fs");
    const hash = crypto.createHash("sha256").update(fs.readFileSync(process.env.FILE_PATH)).digest("hex");
    process.stdout.write(hash);
  '
}

quarantine_file() {
  local source_path="$1"
  local asset_id="$2"
  local actual_sha="$3"
  local safe_asset_id="${asset_id//[^a-zA-Z0-9_.:-]/-}"
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  safe_asset_id="${safe_asset_id:-asset}"
  mkdir -p "${ASSET_QUARANTINE_DIR}"
  local quarantine_path="${ASSET_QUARANTINE_DIR}/${safe_asset_id}.${actual_sha:0:16}.${timestamp}.quarantine"
  if ! mv "${source_path}" "${quarantine_path}"; then
    return 1
  fi
  chmod 600 "${quarantine_path}" 2>/dev/null || true
  printf '%s' "${quarantine_path}"
}

purge_quarantine() {
  QUARANTINE_DIR="${ASSET_QUARANTINE_DIR}" \
  RETENTION_DAYS="${ASSET_QUARANTINE_RETENTION_DAYS}" \
  MAX_FILES="${ASSET_QUARANTINE_MAX_FILES}" \
  MAX_BYTES="${ASSET_QUARANTINE_MAX_BYTES}" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = process.env.QUARANTINE_DIR;
    if (!dir || !fs.existsSync(dir)) process.exit(0);
    const retentionDays = Math.max(1, Number.parseInt(process.env.RETENTION_DAYS || "30", 10) || 30);
    const maxFiles = Math.max(1, Number.parseInt(process.env.MAX_FILES || "200", 10) || 200);
    const maxBytes = Math.max(1024, Number.parseInt(process.env.MAX_BYTES || "524288000", 10) || 524288000);
    const cutoff = Date.now() - retentionDays * 86400000;
    const entries = fs.readdirSync(dir)
      .filter((name) => name.endsWith(".quarantine"))
      .map((name) => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs, size: stat.size };
      })
      .filter((entry) => {
        if (entry.mtimeMs < cutoff) {
          fs.rmSync(entry.fullPath, { force: true });
          return false;
        }
        return true;
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    while (entries.length > maxFiles || total > maxBytes) {
      const entry = entries.shift();
      if (!entry) break;
      fs.rmSync(entry.fullPath, { force: true });
      total -= entry.size;
    }
  ' || true
}

resolve_download_url() {
  local download_url="$1"
  if [[ "${download_url}" == http://* || "${download_url}" == https://* ]]; then
    printf '%s' "${download_url}"
    return 0
  fi
  if [[ "${download_url}" == /* && -n "${CLOUD_BASE_URL}" ]]; then
    printf '%s%s' "${CLOUD_BASE_URL}" "${download_url}"
    return 0
  fi
  return 1
}

json_payload() {
  local status="$1"
  local message="${2:-}"
  local asset_id="$3"
  local target_path="$4"
  local local_path="${5:-}"
  local sha256="${6:-}"
  local size="${7:-0}"
  local event_id="${8:-}"
  STATUS="${status}" \
  MESSAGE="${message}" \
  EVENT_ID="${event_id}" \
  CONTENT_ID="${CONTENT_ID:-}" \
  ASSET_ID="${asset_id}" \
  TARGET_PATH="${target_path}" \
  LOCAL_PATH="${local_path}" \
  SHA256="${sha256}" \
  SIZE="${size}" \
  node -e '
    const payload = {
      event_id: process.env.EVENT_ID,
      event_type: "asset_result",
      status: process.env.STATUS,
      message: process.env.MESSAGE,
      content_id: process.env.CONTENT_ID,
      asset_id: process.env.ASSET_ID,
      target_path: process.env.TARGET_PATH,
      local_path: process.env.LOCAL_PATH,
      sha256: process.env.SHA256
    };
    const size = Number(process.env.SIZE || 0);
    if (Number.isFinite(size) && size > 0) payload.size = size;
    for (const key of Object.keys(payload)) {
      if (!payload[key]) delete payload[key];
    }
    console.log(JSON.stringify(payload));
  '
}

safe_asset_event_id() {
  local status="$1"
  local asset_id="$2"
  local target_path="$3"
  STATUS="${status}" \
  CONTENT_ID="${CONTENT_ID:-}" \
  ASSET_ID="${asset_id}" \
  TARGET_PATH="${target_path}" \
  node -e '
    const crypto = require("crypto");
    const raw = ["asset-result", process.env.CONTENT_ID || "unknown", process.env.ASSET_ID || "unknown", process.env.STATUS || "unknown", process.env.TARGET_PATH || "unknown"].join(":");
    const safe = raw.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 140);
    const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    process.stdout.write(`${safe}:${digest}`.slice(0, 160));
  '
}

queue_local_asset_result() {
  local event_id="$1"
  local payload="$2"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  PAYLOAD_JSON="${payload}" node "${APP_DIR}/scripts/local-state.js" queue-outbound \
    --endpoint "/api/device/asset-result" \
    --event-id "${event_id}" \
    --event-type "asset_result" >/dev/null || {
      echo "Could not queue local asset result: ${event_id}" >&2
      return 0
    }
}

mark_local_asset_result_sent() {
  local event_id="$1"
  local response_status="${2:-201}"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  node "${APP_DIR}/scripts/local-state.js" mark-outbound-sent \
    --event-id "${event_id}" \
    --response-status "${response_status}" >/dev/null || true
}

mark_local_asset_result_failed() {
  local event_id="$1"
  local message="$2"
  local response_status="${3:-0}"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  node "${APP_DIR}/scripts/local-state.js" mark-outbound-failed \
    --event-id "${event_id}" \
    --message "${message}" \
    --response-status "${response_status}" >/dev/null || true
}

post_asset_result() {
  local status="$1"
  local message="${2:-}"
  local asset_id="$3"
  local target_path="$4"
  local local_path="${5:-}"
  local sha256="${6:-}"
  local size="${7:-0}"
  record_local_asset_state "${status}" "${message}" "${asset_id}" "${target_path}" "${local_path}" "${sha256}" "${size}"
  if [[ "${APPLY}" != "1" ]]; then
    return 0
  fi
  local event_id
  local payload
  event_id="$(safe_asset_event_id "${status}" "${asset_id}" "${target_path}")"
  payload="$(json_payload "${status}" "${message}" "${asset_id}" "${target_path}" "${local_path}" "${sha256}" "${size}" "${event_id}")"
  queue_local_asset_result "${event_id}" "${payload}"
  if [[ -z "${ASSET_RESULT_URL}" ]]; then
    return 0
  fi
  local response_status
  response_status="$(curl -fsS --max-time 20 \
    -w "%{http_code}" \
    -o /dev/null \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    --data-binary "${payload}" \
    "${ASSET_RESULT_URL}" || true)"
  if [[ "${response_status}" =~ ^2[0-9][0-9]$ ]]; then
    mark_local_asset_result_sent "${event_id}" "${response_status}"
  else
    mark_local_asset_result_failed "${event_id}" "Could not report asset ${status} to cloud: ${asset_id}" "${response_status:-0}"
      echo "Could not report asset ${status} to cloud: ${asset_id}" >&2
      return 0
  fi
}

record_local_asset_state() {
  local status="$1"
  local message="${2:-}"
  local asset_id="$3"
  local target_path="$4"
  local local_path="${5:-}"
  local sha256="${6:-}"
  local size="${7:-0}"
  if [[ "${APPLY}" != "1" || ! -f "${APP_DIR}/scripts/local-state.js" ]]; then
    return 0
  fi
  node "${APP_DIR}/scripts/local-state.js" record-asset \
    --status "${status}" \
    --message "${message}" \
    --content-id "${CONTENT_ID:-}" \
    --asset-id "${asset_id}" \
    --target-path "${target_path}" \
    --local-path "${local_path}" \
    --sha256 "${sha256}" \
    --size "${size}" >/dev/null || {
      echo "Could not record local asset state: ${asset_id}" >&2
      return 0
    }
}

validate_media_file() {
  local file_path="$1"
  local target_path="$2"
  if [[ "${VALIDATE_MEDIA_ASSETS}" == "0" ]]; then
    return 0
  fi
  FILE_PATH="${file_path}" \
  TARGET_PATH="${target_path}" \
  VALIDATE_WITH_FFPROBE="${VALIDATE_MEDIA_WITH_FFPROBE}" \
  node -e '
    const fs = require("fs");
    const { spawnSync } = require("child_process");
    const filePath = process.env.FILE_PATH;
    const targetPath = String(process.env.TARGET_PATH || "").toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const hex = (start, end) => buffer.subarray(start, end).toString("hex");
    const ascii = (start, end) => buffer.subarray(start, end).toString("ascii");
    const fail = (message) => {
      console.error(message);
      process.exit(1);
    };
    if (targetPath.endsWith(".png")) {
      if (hex(0, 8) !== "89504e470d0a1a0a") fail("invalid png signature");
      process.exit(0);
    }
    if (targetPath.endsWith(".jpg") || targetPath.endsWith(".jpeg")) {
      if (hex(0, 3) !== "ffd8ff") fail("invalid jpeg signature");
      process.exit(0);
    }
    if (targetPath.endsWith(".gif")) {
      const signature = ascii(0, 6);
      if (signature !== "GIF87a" && signature !== "GIF89a") fail("invalid gif signature");
      process.exit(0);
    }
    if (targetPath.endsWith(".webm")) {
      if (hex(0, 4) !== "1a45dfa3") fail("invalid webm signature");
      process.exit(0);
    }
    if (targetPath.endsWith(".mp4") || targetPath.endsWith(".m4v") || targetPath.endsWith(".mov")) {
      if (buffer.length < 12 || ascii(4, 8) !== "ftyp") fail("invalid mp4 signature");
      if (process.env.VALIDATE_WITH_FFPROBE === "1") {
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", filePath], {
          stdio: ["ignore", "ignore", "pipe"]
        });
        if (probe.error && probe.error.code === "ENOENT") process.exit(0);
        if (probe.status !== 0) fail(`ffprobe rejected media: ${String(probe.stderr || "").slice(0, 300)}`);
      }
      process.exit(0);
    }
    process.exit(0);
  '
}

derive_asset_urls

if [[ -z "${CONTENT_URL}" ]]; then
  echo "MISELL_CONTENT_URL is empty and could not be derived from MISELL_HEARTBEAT_URL; skipping asset sync."
  exit 0
fi

if [[ -z "${DEVICE_TOKEN}" ]]; then
  echo "MISELL_DEVICE_TOKEN is required for asset sync" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for asset sync" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required for asset sync" >&2
  exit 1
fi

mkdir -p "$(dirname "${LOCK_FILE}")"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "Another Misell asset sync is already running."
    exit 0
  fi
fi

echo "Misell asset sync"
echo "app_dir=${APP_DIR}"
echo "content_url=${CONTENT_URL}"
echo "assets_dir=${ASSETS_DIR}"
echo "apply=${APPLY}"
echo "media_validation=${VALIDATE_MEDIA_ASSETS}"

purge_quarantine

policy="$(curl -fsS --max-time 20 \
  -H "Authorization: Bearer ${DEVICE_TOKEN}" \
  "${CONTENT_URL}")"

CONTENT_ID="$(json_content_value content_id)"
PLAYLIST_VERSION="$(json_content_value playlist_version)"
ASSET_COUNT="$(json_content_value asset_count)"

echo "content_id=${CONTENT_ID:-<none>}"
echo "playlist_version=${PLAYLIST_VERSION:-<none>}"
echo "asset_count=${ASSET_COUNT}"

if [[ "${ASSET_COUNT}" == "0" ]]; then
  echo "No assets to sync."
  exit 0
fi

failed=0
while IFS=$'\t' read -r asset_id target_path download_url expected_sha expected_size required; do
  [[ -n "${asset_id}" ]] || continue
  echo "asset=${asset_id} target=${target_path}"

  if [[ -z "${target_path}" || -z "${download_url}" || -z "${expected_sha}" ]]; then
    echo "Asset ${asset_id} is missing target_path, download_url, or sha256" >&2
    post_asset_result "failed" "asset policy is incomplete" "${asset_id}" "${target_path}" "" "${expected_sha}" "${expected_size}"
    [[ "${required}" == "1" ]] && failed=1
    continue
  fi

  if ! local_path="$(local_path_for_target "${target_path}")"; then
    post_asset_result "failed" "target_path is invalid" "${asset_id}" "${target_path}" "" "${expected_sha}" "${expected_size}"
    [[ "${required}" == "1" ]] && failed=1
    continue
  fi

  if [[ -f "${local_path}" ]]; then
    current_sha="$(sha256_file "${local_path}")"
    if [[ "${current_sha}" == "${expected_sha}" ]]; then
      if ! validate_media_file "${local_path}" "${target_path}"; then
        quarantine_path=""
        if quarantine_path="$(quarantine_file "${local_path}" "${asset_id}" "${current_sha}")"; then
          post_asset_result "failed" "asset media validation failed; quarantined" "${asset_id}" "${target_path}" "${quarantine_path}" "${current_sha}" "${expected_size}"
        else
          post_asset_result "failed" "asset media validation failed; quarantine failed" "${asset_id}" "${target_path}" "${local_path}" "${current_sha}" "${expected_size}"
        fi
        [[ "${required}" == "1" ]] && failed=1
        continue
      fi
      echo "Asset already current: ${asset_id}"
      post_asset_result "ready" "asset already current" "${asset_id}" "${target_path}" "${local_path}" "${current_sha}" "${expected_size}"
      continue
    fi
  fi

  if [[ "${APPLY}" != "1" ]]; then
    echo "Would download ${asset_id} to ${local_path}"
    continue
  fi

  if ! resolved_download_url="$(resolve_download_url "${download_url}")"; then
    echo "Could not resolve download_url for ${asset_id}" >&2
    post_asset_result "failed" "download_url could not be resolved" "${asset_id}" "${target_path}" "${local_path}" "${expected_sha}" "${expected_size}"
    [[ "${required}" == "1" ]] && failed=1
    continue
  fi

  mkdir -p "$(dirname "${local_path}")"
  temp_file="$(mktemp "$(dirname "${local_path}")/.${asset_id}.XXXXXX")"
  post_asset_result "downloading" "asset download started" "${asset_id}" "${target_path}" "${local_path}" "${expected_sha}" "${expected_size}"
  if ! curl -fsS --max-time 120 \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    -o "${temp_file}" \
    "${resolved_download_url}"; then
    rm -f "${temp_file}"
    post_asset_result "failed" "asset download failed" "${asset_id}" "${target_path}" "${local_path}" "${expected_sha}" "${expected_size}"
    [[ "${required}" == "1" ]] && failed=1
    continue
  fi

  actual_sha="$(sha256_file "${temp_file}")"
  if [[ "${actual_sha}" != "${expected_sha}" ]]; then
    quarantine_path=""
    if quarantine_path="$(quarantine_file "${temp_file}" "${asset_id}" "${actual_sha}")"; then
      post_asset_result "failed" "asset sha256 mismatch; quarantined" "${asset_id}" "${target_path}" "${quarantine_path}" "${actual_sha}" "${expected_size}"
    else
      rm -f "${temp_file}"
      post_asset_result "failed" "asset sha256 mismatch; quarantine failed" "${asset_id}" "${target_path}" "${local_path}" "${actual_sha}" "${expected_size}"
    fi
    [[ "${required}" == "1" ]] && failed=1
    continue
  fi

  if ! validate_media_file "${temp_file}" "${target_path}"; then
    quarantine_path=""
    if quarantine_path="$(quarantine_file "${temp_file}" "${asset_id}" "${actual_sha}")"; then
      post_asset_result "failed" "asset media validation failed; quarantined" "${asset_id}" "${target_path}" "${quarantine_path}" "${actual_sha}" "${expected_size}"
    else
      rm -f "${temp_file}"
      post_asset_result "failed" "asset media validation failed; quarantine failed" "${asset_id}" "${target_path}" "${local_path}" "${actual_sha}" "${expected_size}"
    fi
    [[ "${required}" == "1" ]] && failed=1
    continue
  fi

  mv "${temp_file}" "${local_path}"
  chmod 644 "${local_path}" 2>/dev/null || true
  post_asset_result "ready" "asset synced" "${asset_id}" "${target_path}" "${local_path}" "${actual_sha}" "${expected_size}"
  echo "Synced ${asset_id}"
done < <(asset_lines_from_policy)

if [[ "${failed}" != "0" ]]; then
  echo "One or more required assets failed to sync." >&2
  exit 1
fi

echo "Asset sync complete."
