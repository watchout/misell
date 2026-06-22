#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { openLocalState } = require("../lib/local-state");

const appDir = path.resolve(__dirname, "..");
const token = "token-content-smoke";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-player-content-apply."));
  const dataDir = path.join(tmpDir, "data");
  const assetsDir = path.join(tmpDir, "assets");
  const playlistPath = path.join(dataDir, "playlist.json");
  const localStatePath = path.join(dataDir, "local_state.sqlite");
  const requests = {
    assetResults: [],
    contentResults: []
  };
  let policy = null;
  let assetBytes = new Map();

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await writePlaylist(playlistPath, "pl-original", "/demo/wide.html");

    const server = http.createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      if (req.method === "GET" && req.url === "/api/device/content-policy") {
        json(res, policy);
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/device/assets/")) {
        const assetId = decodeURIComponent(req.url.split("/")[4] || "");
        const bytes = assetBytes.get(assetId);
        if (!bytes) {
          res.writeHead(404).end("missing asset");
          return;
        }
        res.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
        return;
      }
      if (req.method === "POST" && req.url === "/api/device/asset-result") {
        requests.assetResults.push(await readJson(req));
        json(res, { ok: true });
        return;
      }
      if (req.method === "POST" && req.url === "/api/device/content-result") {
        requests.contentResults.push(await readJson(req));
        json(res, { ok: true });
        return;
      }
      res.writeHead(404).end("not found");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const goodBytes = mp4Bytes("good video bytes");
      policy = buildPolicy({
        contentId: "content-good",
        playlistVersion: "pl-good",
        assetId: "asset-good",
        targetPath: "/assets/videos/good.mp4",
        expectedBytes: goodBytes
      });
      assetBytes = new Map([["asset-good", goodBytes]]);
      const success = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath);
      if (success.status !== 0) {
        throw new Error(`content sync success case failed:\n${success.stdout}\n${success.stderr}`);
      }
      const goodPlaylist = await readPlaylist(playlistPath);
      if (goodPlaylist.playlist_version !== "pl-good") {
        throw new Error(`playlist was not applied: ${JSON.stringify(goodPlaylist)}`);
      }
      await fs.access(path.join(assetsDir, "videos", "good.mp4"));
      const goodRelease = await assertActiveRelease(dataDir, playlistPath, "pl-good");
      const restartValidate = await runValidatePlaylist(tmpDir, playlistPath, assetsDir, localStatePath);
      if (restartValidate.status !== 0) {
        throw new Error(`active release did not validate after restart:\n${restartValidate.stdout}\n${restartValidate.stderr}`);
      }

      const dryRunBytes = mp4Bytes("dry run video bytes");
      policy = buildPolicy({
        contentId: "content-dry-run",
        playlistVersion: "pl-dry-run",
        assetId: "asset-dry-run",
        targetPath: "/assets/videos/dry-run.mp4",
        expectedBytes: dryRunBytes
      });
      assetBytes = new Map();
      const dryRun = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath, ["--dry-run"]);
      if (dryRun.status !== 0) {
        throw new Error(`content sync dry-run failed:\n${dryRun.stdout}\n${dryRun.stderr}`);
      }
      const afterDryRunPlaylist = await readPlaylist(playlistPath);
      if (afterDryRunPlaylist.playlist_version !== "pl-good") {
        throw new Error(`dry-run changed playlist: ${JSON.stringify(afterDryRunPlaylist)}`);
      }

      const nextBytes = mp4Bytes("next video bytes");
      policy = buildPolicy({
        contentId: "content-next",
        playlistVersion: "pl-next",
        assetId: "asset-next",
        targetPath: "/assets/videos/next.mp4",
        expectedBytes: nextBytes
      });
      assetBytes = new Map([["asset-next", nextBytes]]);
      const next = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath);
      if (next.status !== 0) {
        throw new Error(`content sync next release failed:\n${next.stdout}\n${next.stderr}`);
      }
      const nextRelease = await assertActiveRelease(dataDir, playlistPath, "pl-next");
      if (nextRelease.release_id === goodRelease.release_id) {
        throw new Error(`release id did not change between releases: ${JSON.stringify(nextRelease)}`);
      }

      const interruptBytes = mp4Bytes("interrupted video bytes");
      policy = buildPolicy({
        contentId: "content-interrupt",
        playlistVersion: "pl-interrupt",
        assetId: "asset-interrupt",
        targetPath: "/assets/videos/interrupt.mp4",
        expectedBytes: interruptBytes
      });
      assetBytes = new Map([["asset-interrupt", interruptBytes]]);
      const interrupted = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath, [], {
        MISELL_CONTENT_SYNC_INTERRUPT_BEFORE_PROMOTE: "1"
      });
      if (interrupted.status === 0) {
        throw new Error(`interrupted content sync unexpectedly succeeded:\n${interrupted.stdout}\n${interrupted.stderr}`);
      }
      const afterInterruptPlaylist = await readPlaylist(playlistPath);
      if (afterInterruptPlaylist.playlist_version !== "pl-next") {
        throw new Error(`interrupted apply changed playlist: ${JSON.stringify(afterInterruptPlaylist)}`);
      }
      const afterInterruptRelease = await assertActiveRelease(dataDir, playlistPath, "pl-next");
      if (afterInterruptRelease.release_id !== nextRelease.release_id) {
        throw new Error(`interrupted apply changed current release: ${JSON.stringify(afterInterruptRelease)}`);
      }

      const promoteFailBytes = mp4Bytes("promote failure video bytes");
      policy = buildPolicy({
        contentId: "content-promote-fail",
        playlistVersion: "pl-promote-fail",
        assetId: "asset-promote-fail",
        targetPath: "/assets/videos/promote-fail.mp4",
        expectedBytes: promoteFailBytes
      });
      assetBytes = new Map([["asset-promote-fail", promoteFailBytes]]);
      const promoteFailed = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath, [], {
        MISELL_RELEASE_BUNDLE_FAIL_AFTER_CURRENT: "1"
      });
      if (promoteFailed.status === 0) {
        throw new Error(`promote failure injection unexpectedly succeeded:\n${promoteFailed.stdout}\n${promoteFailed.stderr}`);
      }
      const afterPromoteFailurePlaylist = await readPlaylist(playlistPath);
      if (afterPromoteFailurePlaylist.playlist_version !== "pl-next") {
        throw new Error(`promote failure changed playlist pointer: ${JSON.stringify(afterPromoteFailurePlaylist)}`);
      }
      const afterPromoteFailureRelease = await assertActiveRelease(dataDir, playlistPath, "pl-next");
      if (afterPromoteFailureRelease.release_id !== nextRelease.release_id) {
        throw new Error(`promote failure changed current release: ${JSON.stringify(afterPromoteFailureRelease)}`);
      }

      const assetResultCountBeforeRollback = requests.assetResults.length;
      const rollback = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath, ["--rollback", "previous"]);
      if (rollback.status !== 0) {
        throw new Error(`rollback to previous release failed:\n${rollback.stdout}\n${rollback.stderr}`);
      }
      const afterRollbackPlaylist = await readPlaylist(playlistPath);
      if (afterRollbackPlaylist.playlist_version !== "pl-good") {
        throw new Error(`rollback did not restore previous playlist: ${JSON.stringify(afterRollbackPlaylist)}`);
      }
      const rollbackRelease = await assertActiveRelease(dataDir, playlistPath, "pl-good");
      if (rollbackRelease.release_id !== goodRelease.release_id) {
        throw new Error(`rollback selected the wrong release: ${JSON.stringify({ rollbackRelease, goodRelease })}`);
      }
      if (requests.assetResults.length !== assetResultCountBeforeRollback) {
        throw new Error("rollback downloaded or re-synced assets unexpectedly");
      }
      const rollbackState = openLocalState(localStatePath);
      const rollbackSummary = rollbackState.summary({ include_db_path: false });
      rollbackState.close();
      if (
        rollbackSummary.latest_content?.playlist_version !== "pl-good" ||
        rollbackSummary.latest_content?.source !== "release_bundle_rollback" ||
        !rollbackSummary.latest_content?.manifest?.release_bundle?.release_id
      ) {
        throw new Error(`rollback release bundle evidence was not recorded: ${JSON.stringify(rollbackSummary.latest_content)}`);
      }

      const expectedBadBytes = mp4Bytes("expected video bytes");
      const tamperedBytes = mp4Bytes("tampered video bytes");
      policy = buildPolicy({
        contentId: "content-bad",
        playlistVersion: "pl-bad",
        assetId: "asset-bad",
        targetPath: "/assets/videos/bad.mp4",
        expectedBytes: expectedBadBytes
      });
      assetBytes = new Map([["asset-bad", tamperedBytes]]);
      const failed = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath);
      if (failed.status === 0) {
        throw new Error(`content sync unexpectedly succeeded:\n${failed.stdout}\n${failed.stderr}`);
      }
      const afterFailurePlaylist = await readPlaylist(playlistPath);
      if (afterFailurePlaylist.playlist_version !== "pl-good") {
        throw new Error(`failed content apply changed playlist: ${JSON.stringify(afterFailurePlaylist)}`);
      }
      const quarantineDir = path.join(assetsDir, ".quarantine");
      const quarantineFiles = await fs.readdir(quarantineDir);
      if (!quarantineFiles.some((file) => file.startsWith("asset-bad."))) {
        throw new Error(`tampered asset was not quarantined: ${JSON.stringify(quarantineFiles)}`);
      }
      if (!requests.assetResults.some((result) => result.asset_id === "asset-bad" && result.status === "failed")) {
        throw new Error(`asset failure was not reported: ${JSON.stringify(requests.assetResults)}`);
      }
      if (!requests.contentResults.some((result) => result.playlist_version === "pl-bad" && result.status === "failed")) {
        throw new Error(`content failure was not reported: ${JSON.stringify(requests.contentResults)}`);
      }

      const oldQuarantineFile = path.join(quarantineDir, "old.0000000000000000.20000101T000000Z.quarantine");
      await fs.writeFile(oldQuarantineFile, "old quarantine");
      const oldDate = new Date("2000-01-01T00:00:00.000Z");
      await fs.utimes(oldQuarantineFile, oldDate, oldDate);

      const invalidBytes = Buffer.from("not an mp4 even though the hash matches");
      policy = buildPolicy({
        contentId: "content-invalid-media",
        playlistVersion: "pl-invalid-media",
        assetId: "asset-invalid-media",
        targetPath: "/assets/videos/invalid-media.mp4",
        expectedBytes: invalidBytes
      });
      assetBytes = new Map([["asset-invalid-media", invalidBytes]]);
      const invalid = await runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath, [], {
        MISELL_ASSET_QUARANTINE_RETENTION_DAYS: "1",
        MISELL_ASSET_QUARANTINE_MAX_FILES: "20"
      });
      if (invalid.status === 0) {
        throw new Error(`invalid media content sync unexpectedly succeeded:\n${invalid.stdout}\n${invalid.stderr}`);
      }
      const afterInvalidPlaylist = await readPlaylist(playlistPath);
      if (afterInvalidPlaylist.playlist_version !== "pl-good") {
        throw new Error(`invalid media apply changed playlist: ${JSON.stringify(afterInvalidPlaylist)}`);
      }
      const afterInvalidQuarantineFiles = await fs.readdir(quarantineDir);
      if (afterInvalidQuarantineFiles.includes(path.basename(oldQuarantineFile))) {
        throw new Error(`old quarantine file was not purged: ${JSON.stringify(afterInvalidQuarantineFiles)}`);
      }
      if (!afterInvalidQuarantineFiles.some((file) => file.startsWith("asset-invalid-media."))) {
        throw new Error(`invalid media asset was not quarantined: ${JSON.stringify(afterInvalidQuarantineFiles)}`);
      }
      if (!requests.assetResults.some((result) =>
        result.asset_id === "asset-invalid-media" &&
        result.status === "failed" &&
        String(result.message || "").includes("media validation failed")
      )) {
        throw new Error(`invalid media failure was not reported: ${JSON.stringify(requests.assetResults)}`);
      }
      if (!requests.contentResults.some((result) => result.playlist_version === "pl-invalid-media" && result.status === "failed")) {
        throw new Error(`invalid media content failure was not reported: ${JSON.stringify(requests.contentResults)}`);
      }
      const state = openLocalState(localStatePath);
      const summary = state.summary({ include_db_path: false });
      state.close();
      if (summary.latest_apply_job?.playlist_version !== "pl-invalid-media" || summary.latest_apply_job?.status !== "failed") {
        throw new Error(`failed apply job evidence was not recorded: ${JSON.stringify(summary)}`);
      }

      console.log(JSON.stringify({
        ok: true,
        content_apply_success: true,
        release_bundle_current_symlink: true,
        restart_uses_current_release: true,
        interrupted_apply_keeps_current_release: true,
        promote_failure_keeps_current_release: true,
        rollback_previous_release: true,
        rollback_without_asset_download: true,
        dry_run_skips_apply_verification: true,
        asset_verification_blocks_apply: true,
        hash_mismatch_quarantine: true,
        invalid_media_quarantine: true,
        quarantine_retention: true,
        content_apply_job_evidence: true
      }, null, 2));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function buildPolicy({ contentId, playlistVersion, assetId, targetPath, expectedBytes }) {
  const sha256 = sha256Buffer(expectedBytes);
  return {
    ok: true,
    device_id: "DEV-CONTENT-SMOKE",
    current: {
      playlist_version: "pl-current",
      release_channel: "stable"
    },
    content: {
      required: true,
      status: "pending",
      source: "content_manifest",
      content_id: contentId,
      playlist_version: playlistVersion,
      release_channel: "stable",
      assets: [
        {
          asset_id: assetId,
          target_path: targetPath,
          download_url: `/api/device/assets/${encodeURIComponent(assetId)}/download`,
          sha256,
          size: expectedBytes.length,
          required: true
        }
      ],
      playlist: {
        version: 1,
        playlist_version: playlistVersion,
        updatedAt: "2026-06-20T00:00:00.000Z",
        items: [
          {
            item_id: `${assetId}-slot`,
            name: assetId,
            enabled: true,
            layout: "wide",
            duration: 5,
            wide: targetPath
          }
        ]
      }
    }
  };
}

function runContentSync(tmpDir, baseUrl, playlistPath, assetsDir, localStatePath, args = [], envOverrides = {}) {
  return runCommand(path.join(appDir, "scripts", "sync-content.sh"), args, {
    cwd: appDir,
    env: {
      ...process.env,
      MISELL_ENV_FILE: path.join(tmpDir, "missing-env"),
      MISELL_DATA_DIR: path.dirname(playlistPath),
      MISELL_PLAYLIST_PATH: playlistPath,
      MISELL_ASSETS_DIR: assetsDir,
      MISELL_LOCAL_STATE_DB_PATH: localStatePath,
      MISELL_CONTENT_URL: `${baseUrl}/api/device/content-policy`,
      MISELL_CONTENT_RESULT_URL: `${baseUrl}/api/device/content-result`,
      MISELL_ASSET_RESULT_URL: `${baseUrl}/api/device/asset-result`,
      MISELL_CLOUD_BASE_URL: baseUrl,
      MISELL_DEVICE_TOKEN: token,
      ...envOverrides
    }
  });
}

function runValidatePlaylist(tmpDir, playlistPath, assetsDir, localStatePath) {
  return runCommand("npm", ["run", "validate:playlist"], {
    cwd: appDir,
    env: {
      ...process.env,
      MISELL_ENV_FILE: path.join(tmpDir, "missing-env"),
      MISELL_DATA_DIR: path.dirname(playlistPath),
      MISELL_PLAYLIST_PATH: playlistPath,
      MISELL_ASSETS_DIR: assetsDir,
      MISELL_LOCAL_STATE_DB_PATH: localStatePath
    }
  });
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function writePlaylist(playlistPath, playlistVersion, wide) {
  await fs.mkdir(path.dirname(playlistPath), { recursive: true });
  await fs.writeFile(playlistPath, `${JSON.stringify({
    version: 1,
    playlist_version: playlistVersion,
    updatedAt: "2026-06-20T00:00:00.000Z",
    items: [
      {
        item_id: "original-slot",
        name: "Original",
        enabled: true,
        layout: "wide",
        duration: 5,
        wide
      }
    ]
  }, null, 2)}\n`);
}

async function readPlaylist(playlistPath) {
  return JSON.parse(await fs.readFile(playlistPath, "utf8"));
}

async function assertActiveRelease(dataDir, playlistPath, playlistVersion) {
  const releasesDir = path.join(dataDir, "releases");
  const currentLink = path.join(releasesDir, "current");
  const playlistStat = await fs.lstat(playlistPath);
  if (!playlistStat.isSymbolicLink()) {
    throw new Error(`playlist path is not a symlink: ${playlistPath}`);
  }
  const currentStat = await fs.lstat(currentLink);
  if (!currentStat.isSymbolicLink()) {
    throw new Error(`current release is not a symlink: ${currentLink}`);
  }
  const currentTarget = await fs.realpath(currentLink);
  const manifest = JSON.parse(await fs.readFile(path.join(currentTarget, "manifest.json"), "utf8"));
  const playlist = JSON.parse(await fs.readFile(path.join(currentTarget, "playlist.json"), "utf8"));
  if (playlist.playlist_version !== playlistVersion || manifest.playlist_version !== playlistVersion) {
    throw new Error(`active release mismatch: ${JSON.stringify({ manifest, playlist })}`);
  }
  return {
    release_id: manifest.release_id,
    release_dir: currentTarget,
    playlist_version: playlist.playlist_version
  };
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function json(res, payload) {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function mp4Bytes(label) {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypmp42"),
    Buffer.from(label)
  ]);
}
