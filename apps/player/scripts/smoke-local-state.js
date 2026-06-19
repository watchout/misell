#!/usr/bin/env node

const fs = require("fs/promises");
const http = require("http");
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
    if (summary.outbound_events.sent !== 1) throw new Error(`sent count mismatch: ${JSON.stringify(summary)}`);
    if (summary.latest_content?.content_id !== "content-smoke") throw new Error("applied content was not recorded");
    if (summary.assets.ready !== 1) throw new Error("asset state was not recorded");

    console.log(JSON.stringify({
      ok: true,
      local_state_db: dbPath,
      playlog_sync: true,
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
