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

    console.log(JSON.stringify({
      ok: true,
      backup: path.basename(backupPath),
      manifest: path.basename(manifestPath),
      integrity_check: manifest.integrity_check,
      artifact_sha256: manifest.artifact_sha256,
      retention_purge: true,
      backup_dir_hardened: true
    }, null, 2));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function runBackup(dbPath, backupDir) {
  return runCommand(path.join(appDir, "scripts", "backup-sqlite.sh"), [
    "--backup-dir", backupDir,
    "--retention-days", "1"
  ], {
    cwd: appDir,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      MISELL_CLOUD_ENV_FILE: path.join(path.dirname(dbPath), "missing-env")
    }
  });
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
