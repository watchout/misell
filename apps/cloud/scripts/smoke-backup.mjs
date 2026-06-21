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
  try {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE smoke_backup (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO smoke_backup (name) VALUES ('verified-backup');
    `);
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
      s3_upload: true,
      s3_env_file: true,
      s3_timeout: true
    }, null, 2));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
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
