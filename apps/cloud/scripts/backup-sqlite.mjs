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

import {
  appendBackupOpsAuditEvent,
  defaultBackupOpsAuditDir,
  scanBackupArtifacts
} from "./backup-ops-audit.mjs";

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
const s3UploadTimeoutMs = boundedInteger(args.s3_timeout_ms || process.env.MISELL_CLOUD_BACKUP_S3_TIMEOUT_MS, 300000, 1000, 3600000);
const encryptionModeInput = args.encryption || process.env.MISELL_CLOUD_BACKUP_ENCRYPTION;
const requireEncryption = truthy(args.require_encryption || process.env.MISELL_CLOUD_BACKUP_REQUIRE_ENCRYPTION);
const ageRecipientsInput = args.age_recipients || process.env.MISELL_CLOUD_BACKUP_AGE_RECIPIENTS;
const ageCli = cleanString(args.age_cli || process.env.MISELL_CLOUD_BACKUP_AGE_CLI) || "age";
const backupOpsAuditDir = path.resolve(args.audit_dir || args.backup_audit_dir || process.env.MISELL_CLOUD_BACKUP_OPS_AUDIT_DIR || defaultBackupOpsAuditDir());
const backupOpsAuditRetentionDays = boundedInteger(args.audit_retention_days || process.env.MISELL_CLOUD_BACKUP_OPS_AUDIT_RETENTION_DAYS, 400, 30, 3650);
const operator = cleanString(args.operator || process.env.MISELL_BACKUP_OPERATOR) || "host-ops";
const context = cleanString(args.context || process.env.MISELL_BACKUP_CONTEXT) || "scheduled";
const BACKUP_FILE_PATTERN = /^misell-cloud-\d{8}-\d{6}(?:-\d{3})?\.sqlite(?:\.gz)?(?:\.age)?(?:\.manifest\.json)?$/;

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
  const encryption = resolveEncryptionConfig();

  await fsp.mkdir(backupDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(backupDir, 0o700).catch(() => {});
  const stamp = timestamp();
  const operationId = `backup-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const audit = (event) => appendBackupAudit(operationId, event);
  const sqliteTarget = path.join(backupDir, `misell-cloud-${stamp}.sqlite`);
  const tempTarget = `${sqliteTarget}.tmp-${process.pid}`;
  const gzipTempTarget = `${sqliteTarget}.gz.tmp-${process.pid}`;
  let plainBackupPath = "";
  let encryptedTempTarget = "";

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

    plainBackupPath = backupPath;
    const plaintextArtifactSha256 = await sha256File(plainBackupPath);
    const plaintextArtifactSize = (await fsp.stat(plainBackupPath)).size;
    let encryptedManifest = null;
    if (encryption.mode === "age") {
      const encryptedPath = `${plainBackupPath}.age`;
      encryptedTempTarget = `${encryptedPath}.tmp-${process.pid}`;
      try {
        await encryptArtifactWithAge(plainBackupPath, encryptedTempTarget, encryption);
        await fsp.rename(encryptedTempTarget, encryptedPath);
        await fsp.chmod(encryptedPath, 0o600).catch(() => {});
        backupPath = encryptedPath;
        encryptedManifest = encryptionManifest(encryption);
      } finally {
        await fsp.rm(plainBackupPath, { force: true }).catch(() => {});
      }
    }

    const artifactSha256 = await sha256File(backupPath);
    const artifactSize = (await fsp.stat(backupPath)).size;
    await audit({
      event_type: "backup.created",
      status: "success",
      backup_file: path.basename(backupPath),
      compressed: gzipEnabled,
      encrypted: encryption.mode !== "none",
      encryption_mode: encryption.mode,
      artifact_size: artifactSize,
      artifact_sha256: artifactSha256,
      sqlite_size: sqliteSize,
      sqlite_sha256: sqliteSha256,
      integrity_check: integrityCheck
    });
    const manifestPath = `${backupPath}.manifest.json`;
    const manifest = {
      version: 1,
      created_at: new Date().toISOString(),
      source_db: path.basename(dbPath),
      backup_file: path.basename(backupPath),
      compressed: gzipEnabled,
      encrypted: encryption.mode !== "none",
      encryption_mode: encryption.mode,
      sqlite_size: sqliteSize,
      sqlite_sha256: sqliteSha256,
      artifact_size: artifactSize,
      artifact_sha256: artifactSha256,
      integrity_check: integrityCheck,
      retention_days: retentionDays
    };
    if (encryptedManifest) {
      manifest.encryption = encryptedManifest;
      manifest.plaintext_artifact_file = path.basename(plainBackupPath);
      manifest.plaintext_artifact_size = plaintextArtifactSize;
      manifest.plaintext_artifact_sha256 = plaintextArtifactSha256;
    }
    await writeJsonAtomic(manifestPath, manifest, 0o600);
    await audit({
      event_type: "backup.manifest_written",
      status: "success",
      backup_file: path.basename(backupPath),
      manifest_file: path.basename(manifestPath),
      artifact_sha256: artifactSha256,
      integrity_check: integrityCheck
    });

    let s3Upload = {};
    try {
      s3Upload = await uploadOffsiteArtifacts(backupPath, manifestPath);
      await audit({
        event_type: "backup.offsite_upload",
        status: s3Uri ? "success" : "skipped",
        backup_file: path.basename(backupPath),
        manifest_file: path.basename(manifestPath),
        s3_configured: Boolean(s3Uri),
        s3_backup: s3Upload.s3_backup || "",
        s3_manifest: s3Upload.s3_manifest || ""
      });
    } catch (error) {
      await audit({
        event_type: "backup.offsite_upload",
        status: "failure",
        backup_file: path.basename(backupPath),
        manifest_file: path.basename(manifestPath),
        s3_configured: Boolean(s3Uri),
        error: sanitizeError(error)
      }).catch(() => {});
      throw error;
    }
    const deleted = await purgeOldBackups(backupDir, retentionDays);
    await audit({
      event_type: "backup.retention_purge",
      status: "success",
      backup_file: path.basename(backupPath),
      retention_days: retentionDays,
      deleted_count: deleted
    });
    const orphanScan = await scanBackupArtifacts(backupDir);
    await audit({
      event_type: "backup.orphan_scan",
      status: orphanScan.manifest_missing_count > 0 || orphanScan.orphan_manifest_count > 0 || orphanScan.temp_artifact_count > 0
        ? "warning"
        : "success",
      backup_file: path.basename(backupPath),
      ...orphanScan
    });
    const result = {
      ok: true,
      backup: backupPath,
      manifest: manifestPath,
      ...manifest,
      ...s3Upload,
      deleted,
      orphan_scan: orphanScan
    };

    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printLines(result);
    }
  } catch (error) {
    await fsp.rm(tempTarget, { force: true }).catch(() => {});
    await fsp.rm(gzipTempTarget, { force: true }).catch(() => {});
    await fsp.rm(encryptedTempTarget, { force: true }).catch(() => {});
    if (encryption.mode === "age" && plainBackupPath) {
      await fsp.rm(plainBackupPath, { force: true }).catch(() => {});
    }
    await audit({
      event_type: "backup.failed",
      status: "failure",
      error: sanitizeError(error)
    }).catch(() => {});
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

async function encryptArtifactWithAge(sourcePath, targetPath, encryption) {
  const ageArgs = [];
  for (const recipient of encryption.ageRecipients) {
    ageArgs.push("-r", recipient);
  }
  ageArgs.push("-o", targetPath, sourcePath);
  await runCommand(ageCli, ageArgs, { label: "age encryption", includeStderr: false });
}

function resolveEncryptionConfig() {
  const mode = normalizeEncryptionMode(encryptionModeInput);
  if (requireEncryption && mode === "none") {
    throw new Error("MISELL_CLOUD_BACKUP_REQUIRE_ENCRYPTION requires MISELL_CLOUD_BACKUP_ENCRYPTION=age");
  }
  if (mode === "none") {
    return { mode: "none", ageRecipients: [] };
  }
  const ageRecipients = parseList(ageRecipientsInput);
  if (ageRecipients.length === 0) {
    throw new Error("MISELL_CLOUD_BACKUP_AGE_RECIPIENTS is required when backup encryption is age");
  }
  return { mode, ageRecipients };
}

function normalizeEncryptionMode(value) {
  const mode = cleanString(value || "none").toLowerCase();
  if (!mode || mode === "0" || mode === "false" || mode === "none") return "none";
  if (mode === "age") return "age";
  throw new Error(`unsupported backup encryption mode: ${mode}`);
}

function encryptionManifest(encryption) {
  return {
    mode: encryption.mode,
    age_recipient_count: encryption.ageRecipients.length,
    age_recipient_fingerprints: encryption.ageRecipients.map((recipient) => crypto
      .createHash("sha256")
      .update(recipient)
      .digest("hex"))
  };
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
  await runCommand(awsCli, awsArgs, { timeoutMs: s3UploadTimeoutMs, label: "aws s3 upload" });
}

async function appendBackupAudit(operationId, event) {
  return appendBackupOpsAuditEvent({
    auditDir: backupOpsAuditDir,
    retentionDays: backupOpsAuditRetentionDays,
    event: {
      operation_id: operationId,
      operation: "backup",
      operator,
      context,
      ...event
    }
  });
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 0;
    const label = cleanString(options.label) || command;
    let settled = false;
    let timedOut = false;
    let timeout = null;
    let forceKillTimeout = null;
    let stderr = "";

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => {
          child.kill("SIGKILL");
        }, 2000);
      }, timeoutMs);
    }
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timedOut) {
        finish(new Error(`${label} timed out after ${timeoutMs}ms`));
        return;
      }
      finish(new Error(`failed to run ${command}: ${error.message}`));
    });
    child.on("close", (status) => {
      if (timedOut) {
        finish(new Error(`${label} timed out after ${timeoutMs}ms`));
        return;
      }
      if (status === 0) {
        finish();
        return;
      }
      const detail = options.includeStderr === false || !stderr.trim() ? "" : `: ${stderr.trim()}`;
      finish(new Error(`${label} failed with status ${status}${detail}`));
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

function parseList(value) {
  return cleanString(value)
    .split(/[,\n]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(cleanString(value).toLowerCase());
}

function sanitizeError(error) {
  return cleanString(error?.message || error)
    .replace(new RegExp(escapeRegExp(ageCli), "g"), path.basename(ageCli))
    .slice(0, 500);
}

function escapeRegExp(value) {
  return cleanString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  process.stdout.write(`encrypted=${result.encrypted ? "true" : "false"}\n`);
  process.stdout.write(`encryption_mode=${result.encryption_mode || "none"}\n`);
  process.stdout.write(`sqlite_sha256=${result.sqlite_sha256}\n`);
  process.stdout.write(`artifact_sha256=${result.artifact_sha256}\n`);
  process.stdout.write(`integrity_check=${result.integrity_check}\n`);
  if (result.orphan_scan) {
    process.stdout.write(`manifest_missing=${result.orphan_scan.manifest_missing_count}\n`);
    process.stdout.write(`orphan_manifests=${result.orphan_scan.orphan_manifest_count}\n`);
  }
  process.stdout.write(`deleted=${result.deleted}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  scripts/backup-sqlite.mjs [--db-path PATH] [--backup-dir DIR] [--retention-days DAYS] [--no-gzip] [--json]
                            [--encryption age] [--age-recipients RECIPIENT[,RECIPIENT]]
                            [--age-cli age] [--require-encryption]
                            [--audit-dir DIR] [--audit-retention-days DAYS]
                            [--operator NAME] [--context TEXT]
                            [--s3-uri s3://bucket/prefix] [--s3-endpoint-url URL]
                            [--s3-storage-class CLASS] [--s3-sse AES256] [--aws-cli aws]
                            [--s3-timeout-ms 300000]

Creates a timestamped, integrity-checked SQLite backup and a JSON manifest.
When age encryption is configured, writes an encrypted .age artifact and removes
the plaintext backup artifact after encryption. When S3-compatible storage is
configured, uploads the final backup artifact and manifest with aws s3 cp.
Writes CLI-only backup operation evidence to a protected JSONL audit directory.
`);
}
