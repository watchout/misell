#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import zlib from "zlib";

import Database from "better-sqlite3";
import dotenv from "dotenv";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

loadEnvFile();

const dbPath = path.resolve(args.db_path || process.env.DB_PATH || path.join(appDir, "data", "misell-cloud.sqlite"));
const backupDir = path.resolve(args.backup_dir || process.env.MISELL_CLOUD_BACKUP_DIR || path.join(os.homedir(), ".local", "share", "misell-cloud", "backups"));
const retentionDays = boundedInteger(args.retention_days || process.env.MISELL_CLOUD_BACKUP_RETENTION_DAYS, 30, 1, 3650);
const gzipEnabled = args.gzip === "0" || args.no_gzip || process.env.MISELL_CLOUD_BACKUP_GZIP === "0" ? false : true;
const jsonOutput = Boolean(args.json);
const s3Uri = cleanString(args.s3_uri || process.env.MISELL_CLOUD_BACKUP_S3_URI);
const s3EndpointUrl = cleanString(args.s3_endpoint_url || process.env.MISELL_CLOUD_BACKUP_S3_ENDPOINT_URL);
const s3StorageClass = cleanString(args.s3_storage_class || process.env.MISELL_CLOUD_BACKUP_S3_STORAGE_CLASS);
const s3Sse = cleanString(args.s3_sse || process.env.MISELL_CLOUD_BACKUP_S3_SSE);
const awsCli = cleanString(args.aws_cli || process.env.MISELL_CLOUD_BACKUP_AWS_CLI) || "aws";
const BACKUP_FILE_PATTERN = /^misell-cloud-\d{8}-\d{6}(?:-\d{3})?\.sqlite(?:\.gz)?(?:\.manifest\.json)?$/;

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (args.help || args.h) {
    usage();
    return;
  }
  if (!fs.existsSync(dbPath)) throw new Error(`DB not found: ${dbPath}`);
  if (s3Uri && !isValidS3Uri(s3Uri)) {
    throw new Error("MISELL_CLOUD_BACKUP_S3_URI must start with s3://bucket or s3://bucket/prefix");
  }

  await fsp.mkdir(backupDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(backupDir, 0o700).catch(() => {});
  const stamp = timestamp();
  const sqliteTarget = path.join(backupDir, `misell-cloud-${stamp}.sqlite`);
  const tempTarget = `${sqliteTarget}.tmp-${process.pid}`;
  const gzipTempTarget = `${sqliteTarget}.gz.tmp-${process.pid}`;

  try {
    let source = null;
    try {
      source = new Database(dbPath, { readonly: true, fileMustExist: true });
      await source.backup(tempTarget);
    } finally {
      if (source) source.close();
    }

    const integrityCheck = verifySqliteBackup(tempTarget);
    const sqliteSha256 = await sha256File(tempTarget);
    const sqliteSize = (await fsp.stat(tempTarget)).size;

    let backupPath = sqliteTarget;
    if (gzipEnabled) {
      backupPath = `${sqliteTarget}.gz`;
      await gzipFile(tempTarget, gzipTempTarget);
      await fsp.rename(gzipTempTarget, backupPath);
      await fsp.rm(tempTarget, { force: true });
    } else {
      await fsp.rename(tempTarget, backupPath);
    }
    await fsp.chmod(backupPath, 0o600).catch(() => {});

    const artifactSha256 = await sha256File(backupPath);
    const artifactSize = (await fsp.stat(backupPath)).size;
    const manifestPath = `${backupPath}.manifest.json`;
    const manifest = {
      version: 1,
      created_at: new Date().toISOString(),
      source_db: path.basename(dbPath),
      backup_file: path.basename(backupPath),
      compressed: gzipEnabled,
      sqlite_size: sqliteSize,
      sqlite_sha256: sqliteSha256,
      artifact_size: artifactSize,
      artifact_sha256: artifactSha256,
      integrity_check: integrityCheck,
      retention_days: retentionDays
    };
    await writeJsonAtomic(manifestPath, manifest, 0o600);

    const s3Upload = await uploadOffsiteArtifacts(backupPath, manifestPath);
    const deleted = await purgeOldBackups(backupDir, retentionDays);
    const result = {
      ok: true,
      backup: backupPath,
      manifest: manifestPath,
      ...manifest,
      ...s3Upload,
      deleted
    };

    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printLines(result);
    }
  } catch (error) {
    await fsp.rm(tempTarget, { force: true }).catch(() => {});
    await fsp.rm(gzipTempTarget, { force: true }).catch(() => {});
    throw error;
  }
}

function verifySqliteBackup(filePath) {
  const backup = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const rows = backup.pragma("integrity_check");
    const values = rows.map((row) => row.integrity_check || Object.values(row)[0]);
    if (values.length !== 1 || values[0] !== "ok") {
      throw new Error(`backup integrity_check failed: ${values.join("; ")}`);
    }
    return "ok";
  } finally {
    backup.close();
  }
}

async function gzipFile(sourcePath, targetPath) {
  await pipeline(
    fs.createReadStream(sourcePath),
    zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION }),
    fs.createWriteStream(targetPath, { mode: 0o600 })
  );
}

async function purgeOldBackups(targetDir, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = await fsp.readdir(targetDir, { withFileTypes: true });
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!BACKUP_FILE_PATTERN.test(entry.name)) continue;
    const filePath = path.join(targetDir, entry.name);
    const stat = await fsp.stat(filePath);
    if (stat.mtimeMs >= cutoff) continue;
    await fsp.rm(filePath, { force: true });
    deleted += 1;
  }
  return deleted;
}

async function uploadOffsiteArtifacts(backupPath, manifestPath) {
  if (!s3Uri) return {};
  const s3Prefix = s3Uri.replace(/\/+$/g, "");
  const backupUri = `${s3Prefix}/${path.basename(backupPath)}`;
  const manifestUri = `${s3Prefix}/${path.basename(manifestPath)}`;
  await uploadToS3(backupPath, backupUri);
  await uploadToS3(manifestPath, manifestUri);
  return {
    s3_backup: backupUri,
    s3_manifest: manifestUri
  };
}

async function uploadToS3(filePath, destinationUri) {
  const awsArgs = [];
  if (s3EndpointUrl) awsArgs.push("--endpoint-url", s3EndpointUrl);
  awsArgs.push("s3", "cp", filePath, destinationUri, "--only-show-errors");
  if (s3StorageClass) awsArgs.push("--storage-class", s3StorageClass);
  if (s3Sse) awsArgs.push("--sse", s3Sse);
  await runCommand(awsCli, awsArgs);
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`failed to run ${command}: ${error.message}`));
    });
    child.on("close", (status) => {
      if (status === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(" ")} failed with status ${status}: ${stderr.trim()}`));
    });
  });
}

async function writeJsonAtomic(filePath, value, mode) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fsp.rename(tempPath, filePath);
  await fsp.chmod(filePath, mode).catch(() => {});
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

function loadEnvFile() {
  const envFile = process.env.MISELL_CLOUD_ENV_FILE || path.join(os.homedir(), ".config", "misell-cloud", "env");
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, override: false, quiet: true });
}

function timestamp() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    "-",
    pad(now.getUTCMilliseconds(), 3)
  ].join("");
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

function isValidS3Uri(value) {
  return /^s3:\/\/[^/]+(?:\/.*)?$/.test(value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function printLines(result) {
  process.stdout.write(`backup=${result.backup}\n`);
  process.stdout.write(`manifest=${result.manifest}\n`);
  if (result.s3_backup) process.stdout.write(`s3_backup=${result.s3_backup}\n`);
  if (result.s3_manifest) process.stdout.write(`s3_manifest=${result.s3_manifest}\n`);
  process.stdout.write(`sqlite_sha256=${result.sqlite_sha256}\n`);
  process.stdout.write(`artifact_sha256=${result.artifact_sha256}\n`);
  process.stdout.write(`integrity_check=${result.integrity_check}\n`);
  process.stdout.write(`deleted=${result.deleted}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  scripts/backup-sqlite.mjs [--db-path PATH] [--backup-dir DIR] [--retention-days DAYS] [--no-gzip] [--json]
                            [--s3-uri s3://bucket/prefix] [--s3-endpoint-url URL]
                            [--s3-storage-class CLASS] [--s3-sse AES256] [--aws-cli aws]

Creates a timestamped, integrity-checked SQLite backup and a JSON manifest.
When S3-compatible storage is configured, uploads both artifacts with aws s3 cp.
`);
}
