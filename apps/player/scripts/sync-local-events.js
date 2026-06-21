#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const dotenv = require("dotenv");

const {
  ASSET_RESULT_ENDPOINT,
  CONTENT_RESULT_ENDPOINT,
  ERROR_ENDPOINT,
  OUTBOUND_ENDPOINTS,
  PLAYLOG_ENDPOINT,
  openLocalState
} = require("../lib/local-state");

const APP_DIR = path.resolve(__dirname, "..");

loadEnvFile();

const args = parseArgs(process.argv.slice(2));
const endpointFilter = cleanString(args.endpoint || process.env.MISELL_LOCAL_EVENT_SYNC_ENDPOINT || "all");
const dryRun = Boolean(args.dry_run);
const limit = boundedInteger(args.limit || process.env.MISELL_LOCAL_EVENT_SYNC_LIMIT, 100, 1, 500);
const timeoutMs = boundedInteger(
  args.timeout_ms || process.env.MISELL_LOCAL_EVENT_SYNC_TIMEOUT_MS || process.env.MISELL_PLAYLOG_SYNC_TIMEOUT_MS,
  15000,
  1000,
  120000
);
const sentRetentionDays = boundedInteger(
  args.sent_retention_days || process.env.MISELL_LOCAL_EVENT_SENT_RETENTION_DAYS || process.env.MISELL_PLAYLOG_SENT_RETENTION_DAYS,
  30,
  1,
  3650
);
const deviceToken = process.env.MISELL_DEVICE_TOKEN || process.env.DEVICE_TOKEN || "";
const state = openLocalState(localStateDbPath());

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  try {
    if (!deviceToken && !dryRun) {
      throw new Error("MISELL_DEVICE_TOKEN is required for local event sync");
    }

    const endpoints = selectedEndpoints(endpointFilter);
    const results = [];
    let totalFailed = 0;

    for (const endpoint of endpoints) {
      const url = endpointUrl(endpoint);
      if (!url) {
        results.push({ endpoint, skipped: true, reason: "endpoint URL is empty and could not be derived" });
        continue;
      }

      const events = dryRun
        ? state.listPendingOutboundEvents({ endpoint, limit })
        : state.claimPendingOutboundEvents({ endpoint, limit });
      if (dryRun) {
        results.push({
          endpoint,
          dry_run: true,
          url,
          pending: events.length,
          events: events.map((event) => event.event_id)
        });
        continue;
      }

      let sent = 0;
      let failed = 0;
      for (const event of events) {
        const result = await sendEvent(endpoint, url, event);
        if (result.ok) sent += 1;
        else failed += 1;
      }
      const purged_sent = state.purgeSentOutboundEvents({ endpoint, retention_days: sentRetentionDays });
      totalFailed += failed;
      results.push({ endpoint, url, attempted: events.length, sent, failed, purged_sent });
    }

    print({
      ok: totalFailed === 0,
      dry_run: dryRun,
      timeout_ms: timeoutMs,
      sent_retention_days: sentRetentionDays,
      results,
      local_state: state.summary()
    });
    if (totalFailed > 0) process.exitCode = 1;
  } finally {
    state.close();
  }
}

async function sendEvent(endpoint, url, event) {
  let timeout = null;
  const claimOptions = { claim_token: event.claim_token };
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify(event.payload),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      state.markOutboundFailed(event.event_id, `HTTP ${response.status}: ${text.slice(0, 500)}`, {
        ...claimOptions,
        response_status: response.status
      });
      return { ok: false };
    }
    state.markOutboundSent(event.event_id, {
      ...claimOptions,
      response_status: response.status
    });
    return { ok: true };
  } catch (error) {
    const message = error.name === "AbortError"
      ? `${endpoint} sync timed out after ${timeoutMs}ms`
      : (error.message || `${endpoint} sync failed`);
    state.markOutboundFailed(event.event_id, message, claimOptions);
    return { ok: false };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function selectedEndpoints(value) {
  if (value === "all") return Array.from(OUTBOUND_ENDPOINTS);
  if (!OUTBOUND_ENDPOINTS.has(value)) {
    throw new Error(`endpoint must be "all" or one of: ${Array.from(OUTBOUND_ENDPOINTS).join(", ")}`);
  }
  return [value];
}

function endpointUrl(endpoint) {
  if (endpoint === PLAYLOG_ENDPOINT && process.env.MISELL_PLAYLOG_URL) return process.env.MISELL_PLAYLOG_URL;
  if (endpoint === ERROR_ENDPOINT && process.env.MISELL_ERROR_URL) return process.env.MISELL_ERROR_URL;
  if (endpoint === CONTENT_RESULT_ENDPOINT && process.env.MISELL_CONTENT_RESULT_URL) return process.env.MISELL_CONTENT_RESULT_URL;
  if (endpoint === ASSET_RESULT_ENDPOINT && process.env.MISELL_ASSET_RESULT_URL) return process.env.MISELL_ASSET_RESULT_URL;
  const baseUrl = process.env.MISELL_LOCAL_EVENTS_BASE_URL || baseUrlFromHeartbeat();
  return baseUrl ? `${baseUrl}${endpoint}` : "";
}

function baseUrlFromHeartbeat() {
  const heartbeatUrl = process.env.MISELL_HEARTBEAT_URL || "";
  if (heartbeatUrl.endsWith("/api/device/heartbeat")) {
    return heartbeatUrl.slice(0, -"/api/device/heartbeat".length);
  }
  return "";
}

function boundedInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function loadEnvFile() {
  const envFile = process.env.MISELL_ENV_FILE || path.join(os.homedir(), ".config", "misell-player", "env");
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, override: false, quiet: true });
}

function localStateDbPath() {
  if (process.env.MISELL_LOCAL_STATE_DB_PATH) return path.resolve(process.env.MISELL_LOCAL_STATE_DB_PATH);
  const dataDir = process.env.MISELL_DATA_DIR
    ? path.resolve(process.env.MISELL_DATA_DIR)
    : path.join(APP_DIR, "data");
  return path.join(dataDir, "local_state.sqlite");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const normalized = key.slice(2).replace(/-/g, "_");
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[normalized] = "1";
    } else {
      parsed[normalized] = next;
      index += 1;
    }
  }
  return parsed;
}

function cleanString(value) {
  return String(value || "").trim();
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
