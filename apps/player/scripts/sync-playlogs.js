#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const dotenv = require("dotenv");

const { PLAYLOG_ENDPOINT, openLocalState } = require("../lib/local-state");

const APP_DIR = path.resolve(__dirname, "..");

loadEnvFile();

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args.dry_run);
const limit = Number.parseInt(args.limit || process.env.MISELL_PLAYLOG_SYNC_LIMIT || "100", 10);
const timeoutMs = boundedInteger(args.timeout_ms || process.env.MISELL_PLAYLOG_SYNC_TIMEOUT_MS, 15000, 1000, 120000);
const sentRetentionDays = boundedInteger(args.sent_retention_days || process.env.MISELL_PLAYLOG_SENT_RETENTION_DAYS, 30, 1, 3650);
const playlogUrl = playlogEndpointUrl();
const deviceToken = process.env.MISELL_DEVICE_TOKEN || process.env.DEVICE_TOKEN || "";
const state = openLocalState(localStateDbPath());

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  try {
    if (!playlogUrl) {
      print({ ok: true, skipped: true, reason: "MISELL_PLAYLOG_URL is empty and could not be derived", local_state: state.summary() });
      return;
    }
    if (!deviceToken) {
      throw new Error("MISELL_DEVICE_TOKEN is required for playlog sync");
    }

    const events = dryRun
      ? state.listPendingOutboundEvents({ endpoint: PLAYLOG_ENDPOINT, limit })
      : state.claimPendingOutboundEvents({ endpoint: PLAYLOG_ENDPOINT, limit });
    if (dryRun) {
      print({ ok: true, dry_run: true, playlog_url: playlogUrl, timeout_ms: timeoutMs, pending: events.length, events: events.map((event) => event.event_id) });
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const event of events) {
      let timeout = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(playlogUrl, {
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
          failed += 1;
          state.markOutboundFailed(event.event_id, `HTTP ${response.status}: ${text.slice(0, 500)}`, { response_status: response.status });
          continue;
        }
        sent += 1;
        state.markOutboundSent(event.event_id, { response_status: response.status });
      } catch (error) {
        failed += 1;
        const message = error.name === "AbortError"
          ? `playlog sync timed out after ${timeoutMs}ms`
          : (error.message || "playlog sync failed");
        state.markOutboundFailed(event.event_id, message);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    const purged_sent = state.purgeSentOutboundEvents({ endpoint: PLAYLOG_ENDPOINT, retention_days: sentRetentionDays });
    print({
      ok: failed === 0,
      playlog_url: playlogUrl,
      timeout_ms: timeoutMs,
      attempted: events.length,
      sent,
      failed,
      purged_sent,
      local_state: state.summary()
    });
    if (failed > 0) process.exitCode = 1;
  } finally {
    state.close();
  }
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

function playlogEndpointUrl() {
  if (process.env.MISELL_PLAYLOG_URL) return process.env.MISELL_PLAYLOG_URL;
  const heartbeatUrl = process.env.MISELL_HEARTBEAT_URL || "";
  if (heartbeatUrl.endsWith("/api/device/heartbeat")) {
    return `${heartbeatUrl.slice(0, -"/api/device/heartbeat".length)}${PLAYLOG_ENDPOINT}`;
  }
  return "";
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

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
