import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import zlib from "zlib";
import { promisify } from "util";

import Database from "better-sqlite3";

const gunzip = promisify(zlib.gunzip);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "misell-cloud-backup."));
  const dbPath = path.join(tmpDir, "misell-cloud.sqlite");
  const backupDir = path.join(tmpDir, "backups");
  const assetsDir = path.join(tmpDir, "assets");
  try {
    await fsp.mkdir(assetsDir, { recursive: true });
    const assetBytes = Buffer.from("verified cloud asset");
    const assetPath = path.join(assetsDir, "asset-restore-smoke.mp4");
    await fsp.writeFile(assetPath, assetBytes);
    const assetSha256 = sha256Buffer(assetBytes);
    const reportSummary = {
      generated_at: "2026-06-20T00:00:00.000Z",
      totals: {
        play_started_count: 1,
        error_count: 0
      },
      daily: []
    };
    const metricsSha256 = reportMetricsSha256(reportSummary);
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE smoke_backup (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO smoke_backup (name) VALUES ('verified-backup');

      CREATE TABLE cloud_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        label TEXT,
        notes TEXT,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        download_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE content_manifest_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        target_path TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(content_id, asset_id)
      );

      CREATE TABLE report_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT NOT NULL UNIQUE,
        snapshot_key TEXT,
        campaign_id TEXT,
        advertiser_id TEXT,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        snapshot_type TEXT NOT NULL DEFAULT 'monthly',
        report_type TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        metrics_json TEXT NOT NULL,
        summary_json TEXT,
        metrics_sha256 TEXT,
        notes TEXT,
        created_by TEXT,
        generated_at TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE report_daily_store_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_key TEXT NOT NULL UNIQUE,
        metric_date TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_from TEXT NOT NULL,
        source_to TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO cloud_assets (
        asset_id, type, filename, original_name, mime_type, size, sha256,
        storage_path, download_path, created_at, updated_at
      ) VALUES (?, 'video', ?, ?, 'video/mp4', ?, ?, ?, ?, ?, ?)
    `).run(
      "asset-restore-smoke",
      path.basename(assetPath),
      path.basename(assetPath),
      assetBytes.length,
      assetSha256,
      assetPath,
      "/api/admin/assets/asset-restore-smoke/download",
      "2026-06-20T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z"
    );
    db.prepare(`
      INSERT INTO content_manifest_assets (
        content_id, asset_id, target_path, required, created_at, updated_at
      ) VALUES ('content-restore-smoke', 'asset-restore-smoke', '/assets/videos/asset-restore-smoke.mp4', 1, ?, ?)
    `).run("2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
    db.prepare(`
      INSERT INTO report_snapshots (
        snapshot_id, snapshot_key, period_start, period_end, snapshot_type,
        report_type, status, metrics_json, summary_json, metrics_sha256,
        created_by, generated_at, created_at
      ) VALUES (?, ?, '2026-06-01', '2026-06-30', 'monthly_summary',
        'monthly_summary', 'published', ?, ?, ?, 'smoke', ?, ?)
    `).run(
      "rpts-restore-smoke",
      "monthly_summary:restore-smoke",
      JSON.stringify(reportSummary),
      JSON.stringify(reportSummary),
      metricsSha256,
      "2026-06-20T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z"
    );
    db.prepare(`
      INSERT INTO report_daily_store_metrics (
        metric_key, metric_date, period_start, period_end, tenant_id, store_id,
        generated_at, updated_at, source_from, source_to
      ) VALUES ('metric-restore-smoke', '2026-06-01', '2026-06-01', '2026-06-30',
        'TEN-RESTORE', 'STO-RESTORE', ?, ?, ?, ?)
    `).run(
      "2026-06-20T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      "2026-06-30T23:59:59.999Z"
    );
    db.close();

    await createOldBackupFixtures(backupDir);
    const result = await runBackup(dbPath, backupDir);
    if (result.status !== 0) {
      throw new Error(`backup command failed:\n${result.stdout}\n${result.stderr}`);
    }

    const backupPath = parseOutputPath(result.stdout, "backup");
    const manifestPath = parseOutputPath(result.stdout, "manifest");
    if (!backupPath || !manifestPath) throw new Error(`backup output missing paths: ${result.stdout}`);

    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (manifest.integrity_check !== "ok") throw new Error(`integrity_check was not ok: ${JSON.stringify(manifest)}`);
    if (manifest.artifact_sha256 !== await sha256File(backupPath)) throw new Error("artifact sha256 mismatch");

    const restoredPath = path.join(tmpDir, "restored.sqlite");
    if (backupPath.endsWith(".gz")) {
      await fsp.writeFile(restoredPath, await gunzip(await fsp.readFile(backupPath)));
    } else {
      await fsp.copyFile(backupPath, restoredPath);
    }
    const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
    try {
      const row = restored.prepare("SELECT name FROM smoke_backup WHERE id = 1").get();
      if (row?.name !== "verified-backup") throw new Error(`restored row mismatch: ${JSON.stringify(row)}`);
    } finally {
      restored.close();
    }

    const files = await fsp.readdir(backupDir);
    if (files.some((file) => file.includes("20000101"))) {
      throw new Error(`old backup files were not purged: ${JSON.stringify(files)}`);
    }
    const backupDirMode = (await fsp.stat(backupDir)).mode & 0o777;
    if (backupDirMode !== 0o700) {
      throw new Error(`backup dir mode was not hardened: ${backupDirMode.toString(8)}`);
    }

    await runRestoreDrillSmoke(tmpDir, backupPath, manifestPath, assetsDir);
    await runRestoreDrillAssetContainmentSmoke(tmpDir, dbPath, assetsDir);
    await runS3CliBackupSmoke(tmpDir, dbPath);
    await runS3EnvFileBackupSmoke(tmpDir, dbPath);
    await runS3TimeoutSmoke(tmpDir, dbPath);

    console.log(JSON.stringify({
      ok: true,
      backup: path.basename(backupPath),
      manifest: path.basename(manifestPath),
      integrity_check: manifest.integrity_check,
      artifact_sha256: manifest.artifact_sha256,
      retention_purge: true,
      backup_dir_hardened: true,
      restore_drill: true,
      restore_drill_asset_containment: true,
      s3_upload: true,
      s3_env_file: true,
      s3_timeout: true
    }, null, 2));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function runRestoreDrillSmoke(tmpDir, backupPath, manifestPath, assetsDir) {
  const evidenceDir = path.join(tmpDir, "restore-drills");
  await fsp.mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const oldEvidence = path.join(evidenceDir, "restore-drill-20000101-000000-abcdef.json");
  await fsp.writeFile(oldEvidence, "{}\n", { mode: 0o600 });
  const oldTime = new Date("2000-01-01T00:00:00.000Z");
  await fsp.utimes(oldEvidence, oldTime, oldTime);
  const result = await runCommand(process.execPath, [
    path.join(appDir, "scripts", "restore-drill.mjs"),
    "--backup", backupPath,
    "--manifest", manifestPath,
    "--assets-dir", assetsDir,
    "--evidence-dir", evidenceDir,
    "--operator", "smoke",
    "--context", "smoke-backup",
    "--json"
  ], { cwd: appDir });
  if (result.status !== 0) {
    throw new Error(`restore drill failed:\n${result.stdout}\n${result.stderr}`);
  }
  const evidence = JSON.parse(result.stdout);
  if (!evidence.ok) throw new Error(`restore drill evidence was not ok: ${result.stdout}`);
  if (evidence.checks.sqlite.ok !== true) throw new Error(`sqlite check failed: ${result.stdout}`);
  if (evidence.checks.assets.checked_files !== 1) throw new Error(`asset file check did not run: ${result.stdout}`);
  if (evidence.checks.report_snapshots.snapshot_count !== 1) throw new Error(`report snapshot check did not run: ${result.stdout}`);
  if (evidence.checks.report_daily_store_metrics.row_count !== 1) throw new Error(`daily metrics check did not run: ${result.stdout}`);
  if (evidence.deleted_old_evidence !== 1) throw new Error(`old restore drill evidence was not purged: ${result.stdout}`);
  await fsp.access(evidence.evidence_path);
  try {
    await fsp.access(oldEvidence);
    throw new Error("old restore drill evidence still exists");
  } catch (error) {
    if (error.message === "old restore drill evidence still exists") throw error;
  }
  const evidenceMode = (await fsp.stat(evidence.evidence_path)).mode & 0o777;
  if (evidenceMode !== 0o600) throw new Error(`restore drill evidence mode was not 0600: ${evidenceMode.toString(8)}`);
}

async function runRestoreDrillAssetContainmentSmoke(tmpDir, dbPath, assetsDir) {
  const traversalDbPath = path.join(tmpDir, "misell-cloud-traversal.sqlite");
  const outsidePath = path.join(tmpDir, "outside-secret.txt");
  const outsideBytes = Buffer.from("outside asset dir secret");
  await fsp.copyFile(dbPath, traversalDbPath);
  await fsp.writeFile(outsidePath, outsideBytes, { mode: 0o600 });

  const db = new Database(traversalDbPath);
  try {
    db.prepare(`
      INSERT INTO cloud_assets (
        asset_id, type, filename, original_name, mime_type, size, sha256,
        storage_path, download_path, created_at, updated_at
      ) VALUES (?, 'video', ?, ?, 'video/mp4', ?, ?, ?, ?, ?, ?)
    `).run(
      "asset-traversal-smoke",
      "../outside-secret.txt",
      "outside-secret.txt",
      outsideBytes.length,
      sha256Buffer(outsideBytes),
      outsidePath,
      "/api/admin/assets/asset-traversal-smoke/download",
      "2026-06-20T00:00:00.000Z",
      "2026-06-20T00:00:00.000Z"
    );
  } finally {
    db.close();
  }

  const backupDir = path.join(tmpDir, "traversal-backups");
  const backupResult = await runBackup(traversalDbPath, backupDir);
  if (backupResult.status !== 0) {
    throw new Error(`traversal backup failed:\n${backupResult.stdout}\n${backupResult.stderr}`);
  }
  const backupPath = parseOutputPath(backupResult.stdout, "backup");
  const manifestPath = parseOutputPath(backupResult.stdout, "manifest");
  if (!backupPath || !manifestPath) throw new Error(`traversal backup output missing paths: ${backupResult.stdout}`);

  const evidenceDir = path.join(tmpDir, "restore-drill-traversal");
  const result = await runCommand(process.execPath, [
    path.join(appDir, "scripts", "restore-drill.mjs"),
    "--backup", backupPath,
    "--manifest", manifestPath,
    "--assets-dir", assetsDir,
    "--evidence-dir", evidenceDir,
    "--operator", "smoke",
    "--context", "smoke-asset-containment",
    "--json"
  ], { cwd: appDir });
  if (result.status === 0) {
    throw new Error(`restore drill traversal smoke unexpectedly succeeded:\n${result.stdout}\n${result.stderr}`);
  }
  const evidence = JSON.parse(result.stdout);
  if (evidence.ok !== false) throw new Error(`traversal evidence was not failed: ${result.stdout}`);
  if (evidence.checks.assets.checked_files !== 1) {
    throw new Error(`traversal smoke should only check the safe asset file: ${result.stdout}`);
  }
  const invalid = evidence.checks.assets.invalid_filenames || [];
  const traversal = invalid.find((entry) => entry.asset_id === "asset-traversal-smoke");
  if (!traversal || traversal.filename !== "../outside-secret.txt") {
    throw new Error(`traversal filename was not rejected: ${result.stdout}`);
  }
  if (!String(traversal.reason || "").includes("path separator")) {
    throw new Error(`unexpected traversal rejection reason: ${result.stdout}`);
  }
  if (!evidence.failures.some((failure) => failure.includes("invalid filename"))) {
    throw new Error(`traversal failure summary missing: ${result.stdout}`);
  }
}

async function runBackup(dbPath, backupDir, options = {}) {
  return runCommand(path.join(appDir, "scripts", "backup-sqlite.sh"), [
    "--backup-dir", backupDir,
    "--retention-days", "1",
    ...(options.args || [])
  ], {
    cwd: appDir,
    env: {
      ...process.env,
      ...(options.env || {}),
      DB_PATH: dbPath,
      MISELL_CLOUD_ENV_FILE: options.envFile || path.join(path.dirname(dbPath), "missing-env")
    }
  });
}

async function runS3CliBackupSmoke(tmpDir, dbPath) {
  const backupDir = path.join(tmpDir, "s3-cli-backups");
  const fakeAws = await createFakeAwsCli(tmpDir, "fake-aws-cli");
  const result = await runBackup(dbPath, backupDir, {
    args: [
      "--s3-uri", "s3://misell-test/backups",
      "--s3-endpoint-url", "https://s3.example.test",
      "--s3-storage-class", "STANDARD_IA",
      "--s3-sse", "AES256",
      "--aws-cli", fakeAws.bin
    ],
    env: {
      MISELL_FAKE_AWS_LOG: fakeAws.log
    }
  });
  if (result.status !== 0) throw new Error(`s3 cli backup failed:\n${result.stdout}\n${result.stderr}`);
  assertS3BackupResult(result.stdout, fakeAws.log, {
    prefix: "s3://misell-test/backups",
    endpoint: "https://s3.example.test",
    storageClass: "STANDARD_IA",
    sse: "AES256"
  });
}

async function runS3EnvFileBackupSmoke(tmpDir, dbPath) {
  const backupDir = path.join(tmpDir, "s3-env-backups");
  const fakeAws = await createFakeAwsCli(tmpDir, "fake-aws-env");
  const envFile = path.join(tmpDir, "cloud-env");
  await fsp.writeFile(envFile, [
    "MISELL_CLOUD_BACKUP_S3_URI=s3://misell-env/backups",
    "MISELL_CLOUD_BACKUP_S3_ENDPOINT_URL=https://env-s3.example.test",
    `MISELL_CLOUD_BACKUP_AWS_CLI=${fakeAws.bin}`,
    `MISELL_FAKE_AWS_LOG=${fakeAws.log}`,
    ""
  ].join("\n"), { mode: 0o600 });
  const result = await runBackup(dbPath, backupDir, { envFile });
  if (result.status !== 0) throw new Error(`s3 env backup failed:\n${result.stdout}\n${result.stderr}`);
  assertS3BackupResult(result.stdout, fakeAws.log, {
    prefix: "s3://misell-env/backups",
    endpoint: "https://env-s3.example.test"
  });
}

async function runS3TimeoutSmoke(tmpDir, dbPath) {
  const backupDir = path.join(tmpDir, "s3-timeout-backups");
  const fakeAws = await createFakeAwsCli(tmpDir, "fake-aws-timeout");
  const startedAt = Date.now();
  const result = await runBackup(dbPath, backupDir, {
    args: [
      "--s3-uri", "s3://misell-timeout/backups",
      "--s3-timeout-ms", "1000",
      "--aws-cli", fakeAws.bin
    ],
    env: {
      MISELL_FAKE_AWS_LOG: fakeAws.log,
      MISELL_FAKE_AWS_SLEEP_MS: "5000"
    }
  });
  const elapsedMs = Date.now() - startedAt;
  if (result.status === 0) throw new Error("s3 timeout backup unexpectedly succeeded");
  if (elapsedMs > 4500) throw new Error(`s3 timeout took too long: ${elapsedMs}ms`);
  if (!result.stderr.includes("timed out after 1000ms")) {
    throw new Error(`s3 timeout message missing:\n${result.stdout}\n${result.stderr}`);
  }
}

async function createFakeAwsCli(tmpDir, label) {
  const bin = path.join(tmpDir, `${label}.mjs`);
  const log = path.join(tmpDir, `${label}.jsonl`);
  await fsp.writeFile(bin, `#!/usr/bin/env node
import fs from "fs";
const sleepMs = Number(process.env.MISELL_FAKE_AWS_SLEEP_MS || 0);
if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));
fs.appendFileSync(process.env.MISELL_FAKE_AWS_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`, { mode: 0o700 });
  await fsp.chmod(bin, 0o700);
  return { bin, log };
}

async function assertS3BackupResult(stdout, logPath, expected) {
  const s3Backup = parseOutputPath(stdout, "s3_backup");
  const s3Manifest = parseOutputPath(stdout, "s3_manifest");
  if (!s3Backup || !s3Manifest) throw new Error(`s3 output missing paths: ${stdout}`);
  if (!s3Backup.startsWith(`${expected.prefix}/misell-cloud-`)) throw new Error(`unexpected s3 backup path: ${s3Backup}`);
  if (s3Manifest !== `${s3Backup}.manifest.json`) throw new Error(`unexpected s3 manifest path: ${s3Manifest}`);

  const calls = (await fsp.readFile(logPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (calls.length !== 2) throw new Error(`expected 2 aws uploads, got ${calls.length}: ${JSON.stringify(calls)}`);
  for (const call of calls) {
    if (expected.endpoint && !call.includes(expected.endpoint)) throw new Error(`missing endpoint arg: ${JSON.stringify(call)}`);
    if (!call.includes("s3") || !call.includes("cp") || !call.includes("--only-show-errors")) {
      throw new Error(`unexpected aws call: ${JSON.stringify(call)}`);
    }
    if (expected.storageClass && !call.includes(expected.storageClass)) {
      throw new Error(`missing storage class arg: ${JSON.stringify(call)}`);
    }
    if (expected.sse && !call.includes(expected.sse)) {
      throw new Error(`missing sse arg: ${JSON.stringify(call)}`);
    }
  }
}

async function createOldBackupFixtures(backupDir) {
  await fsp.mkdir(backupDir, { recursive: true, mode: 0o755 });
  await fsp.chmod(backupDir, 0o755);
  const oldTime = new Date("2000-01-01T00:00:00.000Z");
  for (const filename of [
    "misell-cloud-20000101-000000.sqlite.gz",
    "misell-cloud-20000101-000000-000.sqlite.gz"
  ]) {
    const oldBackup = path.join(backupDir, filename);
    const oldManifest = `${oldBackup}.manifest.json`;
    await fsp.writeFile(oldBackup, "old");
    await fsp.writeFile(oldManifest, "{}\n");
    await fsp.utimes(oldBackup, oldTime, oldTime);
    await fsp.utimes(oldManifest, oldTime, oldTime);
  }
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

function parseOutputPath(output, key) {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : "";
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function reportMetricsSha256(report) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableReportPayloadForHash(report)))
    .digest("hex");
}

function stableReportPayloadForHash(value) {
  if (Array.isArray(value)) {
    return value.map(stableReportPayloadForHash);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "generated_at") continue;
    result[key] = stableReportPayloadForHash(value[key]);
  }
  return result;
}
