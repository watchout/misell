#!/usr/bin/env node

const fs = require("fs/promises");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  ASSET_RESULT_ENDPOINT,
  CONTENT_RESULT_ENDPOINT,
  ERROR_ENDPOINT,
  PLAYLOG_ENDPOINT,
  openLocalState
} = require("../lib/local-state");

const appDir = path.resolve(__dirname, "..");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-player-local-state."));
  const dbPath = path.join(tmpDir, "local_state.sqlite");
  const state = openLocalState(dbPath);

  try {
    state.enqueueOutboundEvent({
      event_id: "play-smoke-1",
      event_type: "playback",
      endpoint: PLAYLOG_ENDPOINT,
      payload: {
        device_id: "DEV-SMOKE",
        event_id: "play-smoke-1",
        event_type: "playback",
        timestamp: "2026-06-19T10:00:00.000Z",
        playlist_item_id: "slot-1",
        result: "started"
      }
    });
    const duplicate = state.enqueueOutboundEvent({
      event_id: "play-smoke-1",
      payload: { event_id: "play-smoke-1" }
    });
    if (duplicate.inserted !== false) throw new Error("duplicate outbound event was inserted");

    assertThrows(() => state.enqueueOutboundEvent({
      event_id: "play smoke unsafe",
      payload: { event_id: "play smoke unsafe" }
    }), "unsafe event_id was not rejected");
    assertThrows(() => state.enqueueOutboundEvent({
      event_id: "unknown-endpoint",
      endpoint: "/api/device/not-allowed",
      payload: { event_id: "unknown-endpoint" }
    }), "unknown outbound endpoint was not rejected");
    assertThrows(() => state.enqueueOutboundEvent({
      event_id: "oversized-payload",
      endpoint: ERROR_ENDPOINT,
      payload: { event_id: "oversized-payload", message: "x".repeat(20 * 1024) }
    }), "oversized outbound payload was not rejected");

    state.enqueueOutboundEvent({
      event_id: "play-race-sent",
      payload: { event_id: "play-race-sent" }
    });
    state.markOutboundSent("play-race-sent", { now: "2026-06-19T10:00:00.000Z", response_status: 201 });
    state.markOutboundFailed("play-race-sent", "late concurrent failure", { now: "2026-06-19T10:00:01.000Z", response_status: 500 });
    const afterLateFailure = state.summary();
    if (afterLateFailure.outbound_events.failed) throw new Error(`sent event reverted to failed: ${JSON.stringify(afterLateFailure)}`);

    state.enqueueOutboundEvent({
      event_id: "error-claim-guard",
      endpoint: ERROR_ENDPOINT,
      event_type: "device_error",
      payload: { event_id: "error-claim-guard", event_type: "device_error" }
    });
    const oldClaim = state.claimPendingOutboundEvents({
      endpoint: ERROR_ENDPOINT,
      limit: 1,
      claim_token: "old-claim",
      now: "2026-06-19T10:00:00.000Z"
    })[0];
    if (oldClaim?.claim_token !== "old-claim") throw new Error(`old claim failed: ${JSON.stringify(oldClaim)}`);
    const newClaim = state.claimPendingOutboundEvents({
      endpoint: ERROR_ENDPOINT,
      limit: 1,
      claim_token: "new-claim",
      now: "2026-06-19T10:20:00.000Z",
      stale_claim_seconds: 30
    })[0];
    if (newClaim?.claim_token !== "new-claim") throw new Error(`new claim failed: ${JSON.stringify(newClaim)}`);
    state.markOutboundFailed("play-claim-guard", "late old claim failure", {
      claim_token: "old-claim",
      now: "2026-06-19T10:20:01.000Z",
      response_status: 500
    });
    const afterOldClaimFailure = state.summary();
    if (afterOldClaimFailure.outbound_events.failed) {
      throw new Error(`old claim failure reverted newer claim: ${JSON.stringify(afterOldClaimFailure)}`);
    }
    state.markOutboundSent("error-claim-guard", {
      claim_token: "new-claim",
      now: "2026-06-19T10:20:02.000Z",
      response_status: 201
    });

    state.enqueueOutboundEvent({
      event_id: "play-purge-old",
      payload: { event_id: "play-purge-old" }
    });
    state.markOutboundSent("play-purge-old", { now: "2026-01-01T00:00:00.000Z", response_status: 201 });
    const purged = state.purgeSentOutboundEvents({ now: "2026-06-19T00:00:00.000Z", retention_days: 30 });
    if (purged !== 1) throw new Error(`expected one purged sent event, got ${purged}`);

    state.recordAppliedContent({
      content_id: "content-smoke",
      playlist_version: "pl-smoke",
      source: "content_manifest",
      status: "success",
      message: "content applied",
      manifest: { content_id: "content-smoke" }
    });
    state.recordContentApplyJob({
      job_id: "content-apply:content-smoke:pl-smoke",
      content_id: "content-smoke",
      playlist_version: "pl-smoke",
      source: "content_manifest",
      status: "success",
      message: "content applied",
      manifest: { content_id: "content-smoke" }
    });
    state.recordAssetState({
      content_id: "content-smoke",
      asset_id: "asset-smoke",
      target_path: "/assets/videos/smoke.mp4",
      local_path: path.join(tmpDir, "smoke.mp4"),
      sha256: "abc123",
      size: 12,
      status: "ready",
      message: "asset synced"
    });
    state.enqueueOutboundEvent({
      event_id: "error-smoke-1",
      event_type: "device_error",
      endpoint: ERROR_ENDPOINT,
      payload: {
        device_id: "DEV-SMOKE",
        event_id: "error-smoke-1",
        event_type: "device_error",
        severity: "warning",
        message: "smoke error"
      }
    });
    state.enqueueOutboundEvent({
      event_id: "content-result-smoke-1",
      event_type: "content_result",
      endpoint: CONTENT_RESULT_ENDPOINT,
      payload: {
        device_id: "DEV-SMOKE",
        event_id: "content-result-smoke-1",
        event_type: "content_result",
        status: "success",
        content_id: "content-smoke",
        playlist_version: "pl-smoke"
      }
    });
    state.enqueueOutboundEvent({
      event_id: "asset-result-smoke-1",
      event_type: "asset_result",
      endpoint: ASSET_RESULT_ENDPOINT,
      payload: {
        device_id: "DEV-SMOKE",
        event_id: "asset-result-smoke-1",
        event_type: "asset_result",
        status: "ready",
        content_id: "content-smoke",
        asset_id: "asset-smoke",
        target_path: "/assets/videos/smoke.mp4"
      }
    });
    state.close();

    const received = new Map();
    const server = http.createServer((req, res) => {
      if (
        req.method !== "POST" ||
        ![PLAYLOG_ENDPOINT, ERROR_ENDPOINT, CONTENT_RESULT_ENDPOINT, ASSET_RESULT_ENDPOINT].includes(req.url) ||
        req.headers.authorization !== "Bearer token-smoke"
      ) {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}");
        const expected = {
          [PLAYLOG_ENDPOINT]: "play-smoke-1",
          [ERROR_ENDPOINT]: "error-smoke-1",
          [CONTENT_RESULT_ENDPOINT]: "content-result-smoke-1",
          [ASSET_RESULT_ENDPOINT]: "asset-result-smoke-1"
        }[req.url];
        if (payload.event_id !== expected) {
          res.writeHead(400).end("bad event_id");
          return;
        }
        received.set(req.url, (received.get(req.url) || 0) + 1);
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, event_id: payload.event_id }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const result = await runNode([path.join(appDir, "scripts", "sync-local-events.js"), "--limit", "10"], {
      cwd: appDir,
      env: {
        ...process.env,
        MISELL_LOCAL_STATE_DB_PATH: dbPath,
        MISELL_LOCAL_EVENTS_BASE_URL: `http://127.0.0.1:${port}`,
        MISELL_DEVICE_TOKEN: "token-smoke"
      },
      encoding: "utf8"
    });
    await new Promise((resolve) => server.close(resolve));
    if (result.status !== 0) {
      throw new Error(`sync-local-events failed: ${result.stdout}\n${result.stderr}`);
    }
    for (const endpoint of [PLAYLOG_ENDPOINT, ERROR_ENDPOINT, CONTENT_RESULT_ENDPOINT, ASSET_RESULT_ENDPOINT]) {
      if (received.get(endpoint) !== 1) {
        throw new Error(`expected one upload for ${endpoint}, got ${received.get(endpoint) || 0}`);
      }
    }

    const verify = openLocalState(dbPath);
    const summary = verify.summary();
    verify.close();
    if (summary.outbound_events.sent !== 6) throw new Error(`sent count mismatch: ${JSON.stringify(summary)}`);
    if (summary.latest_content?.content_id !== "content-smoke") throw new Error("applied content was not recorded");
    if (summary.latest_apply_job?.status !== "success") throw new Error("content apply job was not recorded");
    if (summary.assets.ready !== 1) throw new Error("asset state was not recorded");

    const timeoutState = openLocalState(dbPath);
    timeoutState.enqueueOutboundEvent({
      event_id: "play-timeout-1",
      payload: {
        device_id: "DEV-SMOKE",
        event_id: "play-timeout-1",
        timestamp: "2026-06-19T10:01:00.000Z",
        playlist_item_id: "slot-timeout",
        result: "started"
      }
    });
    timeoutState.close();

    const hangingServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === PLAYLOG_ENDPOINT) {
        req.resume();
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => hangingServer.listen(0, "127.0.0.1", resolve));
    const hangingPort = hangingServer.address().port;
    const timeoutResult = await runNode([path.join(appDir, "scripts", "sync-local-events.js"), "--endpoint", PLAYLOG_ENDPOINT, "--limit", "10", "--timeout-ms", "1000"], {
      cwd: appDir,
      env: {
        ...process.env,
        MISELL_LOCAL_STATE_DB_PATH: dbPath,
        MISELL_PLAYLOG_URL: `http://127.0.0.1:${hangingPort}${PLAYLOG_ENDPOINT}`,
        MISELL_DEVICE_TOKEN: "token-smoke"
      }
    });
    await new Promise((resolve) => hangingServer.close(resolve));
    if (timeoutResult.status === 0) throw new Error("timeout sync unexpectedly succeeded");
    const afterTimeout = openLocalState(dbPath);
    const timeoutSummary = afterTimeout.summary();
    afterTimeout.close();
    if (timeoutSummary.outbound_events.failed !== 1) throw new Error(`timeout event was not marked failed: ${JSON.stringify(timeoutSummary)}`);

    const playerErrorQueue = await smokePlayerErrorQueue(tmpDir);
    const failOpen = await smokePlayerFailOpen(tmpDir);

    console.log(JSON.stringify({
      ok: true,
      local_state_db: dbPath,
      playlog_sync: true,
      timeout_failure: true,
      sent_does_not_revert_to_failed: true,
      claim_token_guard: true,
      unsafe_event_id_rejected: true,
      unknown_endpoint_rejected: true,
      oversized_payload_rejected: true,
      sent_retention_purge: true,
      player_error_queue: playerErrorQueue,
      player_fail_open: failOpen,
      applied_content: true,
      content_apply_job: true,
      local_event_sync: true,
      asset_state: true
    }, null, 2));
  } finally {
    try {
      state.close();
    } catch {
      // already closed
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function smokePlayerErrorQueue(tmpDir) {
  const port = await availablePort();
  const runtimeDir = path.join(tmpDir, "player-error-queue");
  const localStatePath = path.join(runtimeDir, "data", "local_state.sqlite");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(port),
      MISELL_DATA_DIR: path.join(runtimeDir, "data"),
      MISELL_LOG_DIR: path.join(runtimeDir, "logs"),
      MISELL_ASSETS_DIR: path.join(runtimeDir, "assets"),
      MISELL_GENERATED_DIR: path.join(runtimeDir, "generated"),
      MISELL_CONTENT_BACKUP_DIR: path.join(runtimeDir, "backups"),
      MISELL_PLAYLIST_PATH: path.join(runtimeDir, "data", "playlist.json"),
      MISELL_DEVICE_CONFIG_PATH: path.join(runtimeDir, "data", "config.json"),
      MISELL_LOCAL_STATE_DB_PATH: localStatePath,
      MISELL_DEVICE_ID: "DEV-ERROR-QUEUE"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        healthy = response.ok;
        if (healthy) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!healthy) throw new Error(`player did not start for error queue smoke: ${stderr}`);

    const response = await fetch(`http://127.0.0.1:${port}/api/playback-log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    if (response.status !== 400) throw new Error(`expected bad JSON to return 400, got ${response.status}`);

    const state = openLocalState(localStatePath);
    const summary = state.summary({ include_db_path: false });
    state.close();
    const errorQueue = summary.outbound_events_by_endpoint?.[ERROR_ENDPOINT]?.pending || 0;
    if (errorQueue !== 1) throw new Error(`request error was not queued: ${JSON.stringify(summary)}`);
    return true;
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

async function smokePlayerFailOpen(tmpDir) {
  const port = await availablePort();
  const runtimeDir = path.join(tmpDir, "player-fail-open");
  const badLocalStatePath = path.join(runtimeDir, "bad-local-state-dir");
  await fs.mkdir(badLocalStatePath, { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(port),
      MISELL_DATA_DIR: path.join(runtimeDir, "data"),
      MISELL_LOG_DIR: path.join(runtimeDir, "logs"),
      MISELL_ASSETS_DIR: path.join(runtimeDir, "assets"),
      MISELL_GENERATED_DIR: path.join(runtimeDir, "generated"),
      MISELL_CONTENT_BACKUP_DIR: path.join(runtimeDir, "backups"),
      MISELL_PLAYLIST_PATH: path.join(runtimeDir, "data", "playlist.json"),
      MISELL_DEVICE_CONFIG_PATH: path.join(runtimeDir, "data", "config.json"),
      MISELL_LOCAL_STATE_DB_PATH: badLocalStatePath,
      MISELL_DEVICE_ID: "DEV-FAIL-OPEN"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    let status = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/status`);
        status = await response.json();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!status) throw new Error(`player did not start with bad local_state path: ${stderr}`);
    if (!status.local_state_error || status.local_state?.ok !== false) {
      throw new Error(`status did not expose local_state failure safely: ${JSON.stringify(status)}`);
    }
    if (JSON.stringify(status).includes(badLocalStatePath)) {
      throw new Error("status leaked local_state db_path");
    }
    return true;
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function assertThrows(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function runNode(args, options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
