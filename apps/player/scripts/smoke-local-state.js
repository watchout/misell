#!/usr/bin/env node

const fs = require("fs/promises");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { PLAYLOG_ENDPOINT, openLocalState } = require("../lib/local-state");

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

    state.enqueueOutboundEvent({
      event_id: "play-race-sent",
      payload: { event_id: "play-race-sent" }
    });
    state.markOutboundSent("play-race-sent", { now: "2026-06-19T10:00:00.000Z", response_status: 201 });
    state.markOutboundFailed("play-race-sent", "late concurrent failure", { now: "2026-06-19T10:00:01.000Z", response_status: 500 });
    const afterLateFailure = state.summary();
    if (afterLateFailure.outbound_events.failed) throw new Error(`sent event reverted to failed: ${JSON.stringify(afterLateFailure)}`);

    const claimGuardEndpoint = "/api/device/playlog-claim-smoke";
    state.enqueueOutboundEvent({
      event_id: "play-claim-guard",
      endpoint: claimGuardEndpoint,
      payload: { event_id: "play-claim-guard" }
    });
    const oldClaim = state.claimPendingOutboundEvents({
      endpoint: claimGuardEndpoint,
      limit: 1,
      claim_token: "old-claim",
      now: "2026-06-19T10:00:00.000Z"
    })[0];
    if (oldClaim?.claim_token !== "old-claim") throw new Error(`old claim failed: ${JSON.stringify(oldClaim)}`);
    const newClaim = state.claimPendingOutboundEvents({
      endpoint: claimGuardEndpoint,
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
    state.markOutboundSent("play-claim-guard", {
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
    state.close();

    let received = 0;
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== PLAYLOG_ENDPOINT || req.headers.authorization !== "Bearer token-smoke") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}");
        if (payload.event_id !== "play-smoke-1") {
          res.writeHead(400).end("bad event_id");
          return;
        }
        received += 1;
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, event_id: payload.event_id }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const result = await runNode([path.join(appDir, "scripts", "sync-playlogs.js"), "--limit", "10"], {
      cwd: appDir,
      env: {
        ...process.env,
        MISELL_LOCAL_STATE_DB_PATH: dbPath,
        MISELL_PLAYLOG_URL: `http://127.0.0.1:${port}${PLAYLOG_ENDPOINT}`,
        MISELL_DEVICE_TOKEN: "token-smoke"
      },
      encoding: "utf8"
    });
    await new Promise((resolve) => server.close(resolve));
    if (result.status !== 0) {
      throw new Error(`sync-playlogs failed: ${result.stdout}\n${result.stderr}`);
    }
    if (received !== 1) throw new Error(`expected one playlog upload, got ${received}`);

    const verify = openLocalState(dbPath);
    const summary = verify.summary();
    verify.close();
    if (summary.outbound_events.sent !== 3) throw new Error(`sent count mismatch: ${JSON.stringify(summary)}`);
    if (summary.latest_content?.content_id !== "content-smoke") throw new Error("applied content was not recorded");
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
    const timeoutResult = await runNode([path.join(appDir, "scripts", "sync-playlogs.js"), "--limit", "10", "--timeout-ms", "1000"], {
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

    const failOpen = await smokePlayerFailOpen(tmpDir);

    console.log(JSON.stringify({
      ok: true,
      local_state_db: dbPath,
      playlog_sync: true,
      timeout_failure: true,
      sent_does_not_revert_to_failed: true,
      claim_token_guard: true,
      unsafe_event_id_rejected: true,
      sent_retention_purge: true,
      player_fail_open: failOpen,
      applied_content: true,
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
