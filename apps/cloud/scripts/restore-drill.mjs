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
  defaultBackupOpsAuditDir
} from "./backup-ops-audit.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

loadEnvFile();

const backupPath = path.resolve(args.backup || args.backup_path || "");
const manifestPath = path.resolve(args.manifest || args.manifest_path || `${backupPath}.manifest.json`);
const assetsDir = cleanString(args.assets_dir || process.env.MISELL_CLOUD_ASSETS_DIR);
const resolvedAssetsDir = assetsDir ? path.resolve(assetsDir) : "";
const verifyAssetFiles = args.verify_asset_files === "0" || args.no_verify_asset_files
  ? false
  : Boolean(assetsDir);
const evidenceDir = path.resolve(
  args.evidence_dir ||
  process.env.MISELL_CLOUD_RESTORE_DRILL_EVIDENCE_DIR ||
  path.join(os.homedir(), ".local", "share", "misell-cloud", "restore-drills")
);
const evidenceRetentionDays = boundedInteger(
  args.evidence_retention_days || process.env.MISELL_CLOUD_RESTORE_DRILL_EVIDENCE_RETENTION_DAYS,
  400,
  30,
  3650
);
const operator = cleanString(args.operator || process.env.MISELL_RESTORE_DRILL_OPERATOR) || "operator";
const context = cleanString(args.context || process.env.MISELL_RESTORE_DRILL_CONTEXT) || "manual";
const ageIdentityFile = cleanString(args.age_identity_file || args.age_identity || process.env.MISELL_RESTORE_DRILL_AGE_IDENTITY_FILE);
const ageCli = cleanString(args.age_cli || process.env.MISELL_RESTORE_DRILL_AGE_CLI || process.env.MISELL_CLOUD_BACKUP_AGE_CLI) || "age";
const requireManifest = truthy(args.require_manifest || process.env.MISELL_RESTORE_DRILL_REQUIRE_MANIFEST);
const backupOpsAuditDir = path.resolve(args.audit_dir || args.backup_audit_dir || process.env.MISELL_CLOUD_BACKUP_OPS_AUDIT_DIR || defaultBackupOpsAuditDir());
const backupOpsAuditRetentionDays = boundedInteger(args.audit_retention_days || process.env.MISELL_CLOUD_BACKUP_OPS_AUDIT_RETENTION_DAYS, 400, 30, 3650);
const jsonOutput = Boolean(args.json);

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (args.help || args.h) {
    usage();
    return;
  }
  if (!backupPath || backupPath === path.resolve("")) {
    throw new Error("--backup PATH is required");
  }
  if (!fs.existsSync(backupPath)) throw new Error(`backup artifact not found: ${backupPath}`);

  await fsp.mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(evidenceDir, 0o700).catch(() => {});
  const drillId = `restore-drill-${timestamp()}-${crypto.randomBytes(3).toString("hex")}`;
  const audit = (event) => appendRestoreDrillAudit(drillId, event);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `${drillId}.`));
  const restoredDbPath = path.join(tempDir, "restored.sqlite");
  const failures = [];
  const warnings = [];
  let restoredDb = null;

  const evidence = {
    version: 1,
    restore_drill_id: drillId,
    created_at: new Date().toISOString(),
    operator,
    context,
    backup_file: path.basename(backupPath),
    backup_path: backupPath,
    manifest_file: fs.existsSync(manifestPath) ? path.basename(manifestPath) : "",
    manifest_path: fs.existsSync(manifestPath) ? manifestPath : "",
    evidence_dir: evidenceDir,
    evidence_retention_days: evidenceRetentionDays,
    checks: {},
    warnings,
    failures
  };

  try {
    evidence.backup_artifact_sha256 = await sha256File(backupPath);
    evidence.backup_artifact_size = (await fsp.stat(backupPath)).size;

    const manifest = await readManifest(manifestPath, warnings);
    if (!manifest && requireManifest) {
      failures.push("backup manifest is required but was not found");
    }
    evidence.manifest = manifest ? {
      compressed: Boolean(manifest.compressed),
      encrypted: Boolean(manifest.encrypted),
      encryption_mode: cleanString(manifest.encryption_mode),
      artifact_sha256: cleanString(manifest.artifact_sha256),
      sqlite_sha256: cleanString(manifest.sqlite_sha256),
      integrity_check: cleanString(manifest.integrity_check),
      created_at: cleanString(manifest.created_at)
    } : null;
    verifyManifest(manifest, evidence, failures);

    await restoreSqliteArtifact(backupPath, restoredDbPath, manifest, tempDir, evidence, failures);
    evidence.sqlite_sha256 = await sha256File(restoredDbPath);
    if (manifest?.sqlite_sha256 && evidence.sqlite_sha256 !== manifest.sqlite_sha256) {
      failures.push("restored sqlite sha256 does not match manifest sqlite_sha256");
    }

    restoredDb = new Database(restoredDbPath, { readonly: true, fileMustExist: true });
    evidence.checks.sqlite = checkSqliteIntegrity(restoredDb, failures);
    evidence.checks.assets = await checkAssets(restoredDb, failures, warnings);
    evidence.checks.report_snapshots = checkReportSnapshots(restoredDb, failures);
    evidence.checks.report_daily_store_metrics = checkDailyMetrics(restoredDb, failures);

    evidence.deleted_old_evidence = await purgeOldEvidence(evidenceDir, evidenceRetentionDays);
    evidence.ok = failures.length === 0;
    evidence.completed_at = new Date().toISOString();
    evidence.evidence_path = path.join(evidenceDir, `${drillId}.json`);
    await writeJsonAtomic(evidence.evidence_path, evidence, 0o600);
    await audit(restoreDrillAuditEvent(evidence));

    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    } else {
      printLines(evidence);
    }
    if (!evidence.ok) process.exitCode = 1;
  } catch (error) {
    failures.push(error.message || "restore drill failed");
    evidence.ok = false;
    evidence.completed_at = new Date().toISOString();
    evidence.evidence_path = path.join(evidenceDir, `${drillId}.json`);
    await writeJsonAtomic(evidence.evidence_path, evidence, 0o600).catch(() => {});
    await audit(restoreDrillAuditEvent(evidence, error)).catch(() => {});
    throw error;
  } finally {
    if (restoredDb) restoredDb.close();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readManifest(filePath, warnings) {
  if (!filePath || !fs.existsSync(filePath)) {
    warnings.push("backup manifest was not found; artifact hash and sqlite checks will still run");
    return null;
  }
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

function verifyManifest(manifest, evidence, failures) {
  if (!manifest) return;
  if (manifest.artifact_sha256 && evidence.backup_artifact_sha256 !== manifest.artifact_sha256) {
    failures.push("backup artifact sha256 does not match manifest artifact_sha256");
  }
  if (manifest.artifact_size && evidence.backup_artifact_size !== manifest.artifact_size) {
    failures.push("backup artifact size does not match manifest artifact_size");
  }
  if (manifest.integrity_check && manifest.integrity_check !== "ok") {
    failures.push(`manifest integrity_check is not ok: ${manifest.integrity_check}`);
  }
}

async function restoreSqliteArtifact(sourcePath, targetPath, manifest, tempDir, evidence, failures) {
  const encrypted = Boolean(manifest?.encrypted) || sourcePath.endsWith(".age");
  let artifactPath = sourcePath;
  let compressed = Boolean(manifest?.compressed) || sourcePath.endsWith(".gz") || sourcePath.endsWith(".gz.age");

  evidence.encryption = {
    encrypted,
    encryption_mode: encrypted ? cleanString(manifest?.encryption_mode || manifest?.encryption?.mode || "age") : "none"
  };

  if (encrypted) {
    if (evidence.encryption.encryption_mode !== "age") {
      throw new Error(`unsupported backup encryption mode: ${evidence.encryption.encryption_mode}`);
    }
    if (!ageIdentityFile) {
      throw new Error("encrypted backup requires --age-identity-file");
    }
    if (!fs.existsSync(ageIdentityFile)) {
      throw new Error("age identity file not found");
    }
    artifactPath = path.join(tempDir, "decrypted-artifact");
    await decryptArtifactWithAge(sourcePath, artifactPath);
    await fsp.chmod(artifactPath, 0o600).catch(() => {});
    evidence.encryption.decrypted = true;
    if (manifest?.encryption?.age_recipient_fingerprints) {
      evidence.encryption.age_recipient_fingerprints = manifest.encryption.age_recipient_fingerprints;
    }
    evidence.plaintext_artifact_sha256 = await sha256File(artifactPath);
    evidence.plaintext_artifact_size = (await fsp.stat(artifactPath)).size;
    if (manifest?.plaintext_artifact_sha256 && evidence.plaintext_artifact_sha256 !== manifest.plaintext_artifact_sha256) {
      failures.push("decrypted artifact sha256 does not match manifest plaintext_artifact_sha256");
    }
    if (manifest?.plaintext_artifact_size && evidence.plaintext_artifact_size !== manifest.plaintext_artifact_size) {
      failures.push("decrypted artifact size does not match manifest plaintext_artifact_size");
    }
    if (!manifest && sourcePath.endsWith(".gz.age")) compressed = true;
  }

  if (compressed) {
    await pipeline(
      fs.createReadStream(artifactPath),
      zlib.createGunzip(),
      fs.createWriteStream(targetPath, { mode: 0o600 })
    );
    return;
  }
  await fsp.copyFile(artifactPath, targetPath);
  await fsp.chmod(targetPath, 0o600).catch(() => {});
}

async function decryptArtifactWithAge(sourcePath, targetPath) {
  await runCommand(ageCli, [
    "-d",
    "-i", ageIdentityFile,
    "-o", targetPath,
    sourcePath
  ], { label: "age decryption", includeStderr: false });
}

function checkSqliteIntegrity(db, failures) {
  const rows = db.pragma("integrity_check");
  const values = rows.map((row) => row.integrity_check || Object.values(row)[0]);
  const ok = values.length === 1 && values[0] === "ok";
  if (!ok) failures.push(`sqlite integrity_check failed: ${values.join("; ")}`);
  return { ok, values };
}

async function checkAssets(db, failures, warnings) {
  if (!tableExists(db, "cloud_assets")) {
    return { ok: true, cloud_asset_count: 0, manifest_link_count: 0, asset_file_check: "skipped_table_missing" };
  }

  const assets = db.prepare("SELECT asset_id, filename, size, sha256, storage_path FROM cloud_assets ORDER BY asset_id").all();
  const missingLinks = tableExists(db, "content_manifest_assets")
    ? db.prepare(`
        SELECT cma.content_id, cma.asset_id
        FROM content_manifest_assets cma
        LEFT JOIN cloud_assets ca ON ca.asset_id = cma.asset_id
        WHERE ca.asset_id IS NULL
        ORDER BY cma.content_id, cma.asset_id
      `).all()
    : [];
  if (missingLinks.length > 0) {
    failures.push(`content_manifest_assets has ${missingLinks.length} link(s) without a cloud_assets row`);
  }

  const result = {
    ok: missingLinks.length === 0,
    cloud_asset_count: assets.length,
    manifest_link_count: tableExists(db, "content_manifest_assets")
      ? db.prepare("SELECT COUNT(*) AS count FROM content_manifest_assets").get().count
      : 0,
    missing_manifest_links: missingLinks,
    asset_file_check: verifyAssetFiles ? "verified" : "skipped_assets_dir_not_configured",
    checked_files: 0,
    invalid_filenames: [],
    missing_files: [],
    hash_mismatches: [],
    size_mismatches: []
  };

  if (!verifyAssetFiles) {
    if (assets.length > 0) warnings.push("asset file verification skipped because --assets-dir was not provided");
    result.ok = result.ok && true;
    return result;
  }

  for (const asset of assets) {
    const resolvedAsset = resolveAssetPath(asset);
    if (resolvedAsset.error) {
      result.invalid_filenames.push({
        asset_id: asset.asset_id,
        filename: asset.filename,
        reason: resolvedAsset.error
      });
      continue;
    }
    const assetPath = resolvedAsset.path;
    if (!assetPath || !fs.existsSync(assetPath)) {
      result.missing_files.push({ asset_id: asset.asset_id, filename: asset.filename });
      continue;
    }
    result.checked_files += 1;
    const stat = await fsp.stat(assetPath);
    if (Number(asset.size) > 0 && stat.size !== Number(asset.size)) {
      result.size_mismatches.push({ asset_id: asset.asset_id, expected: Number(asset.size), actual: stat.size });
    }
    const actualSha = await sha256File(assetPath);
    if (cleanString(asset.sha256) && actualSha !== cleanString(asset.sha256)) {
      result.hash_mismatches.push({ asset_id: asset.asset_id, expected: cleanString(asset.sha256), actual: actualSha });
    }
  }
  if (result.invalid_filenames.length > 0) failures.push(`asset file verification found ${result.invalid_filenames.length} invalid filename(s)`);
  if (result.missing_files.length > 0) failures.push(`asset file verification found ${result.missing_files.length} missing file(s)`);
  if (result.size_mismatches.length > 0) failures.push(`asset file verification found ${result.size_mismatches.length} size mismatch(es)`);
  if (result.hash_mismatches.length > 0) failures.push(`asset file verification found ${result.hash_mismatches.length} sha256 mismatch(es)`);
  result.ok = result.ok &&
    result.invalid_filenames.length === 0 &&
    result.missing_files.length === 0 &&
    result.size_mismatches.length === 0 &&
    result.hash_mismatches.length === 0;
  return result;
}

function resolveAssetPath(asset) {
  if (assetsDir) {
    const filename = cleanString(asset.filename);
    const filenameError = validateAssetFilename(filename);
    if (filenameError) return { path: "", error: filenameError };
    const candidate = path.resolve(resolvedAssetsDir, filename);
    const relative = path.relative(resolvedAssetsDir, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return { path: "", error: "filename escapes assets dir" };
    }
    return { path: candidate, error: "" };
  }
  const storagePath = cleanString(asset.storage_path);
  return { path: storagePath ? path.resolve(storagePath) : "", error: "" };
}

function validateAssetFilename(filename) {
  if (!filename) return "filename is empty";
  if (path.isAbsolute(filename)) return "filename is absolute";
  if (filename.includes("/") || filename.includes("\\")) return "filename contains a path separator";
  if (filename.includes("..")) return "filename contains dot-dot";
  if (!/^[a-zA-Z0-9_.:-]+$/.test(filename)) return "filename contains unsafe characters";
  return "";
}

function checkReportSnapshots(db, failures) {
  if (!tableExists(db, "report_snapshots")) {
    return { ok: true, snapshot_count: 0, invalid_json_count: 0, duplicate_snapshot_key_count: 0 };
  }
  const rows = db.prepare(`
    SELECT snapshot_id, snapshot_key, metrics_json, summary_json, metrics_sha256
    FROM report_snapshots
    ORDER BY id
  `).all();
  const invalidJson = [];
  const hashMismatches = [];
  for (const row of rows) {
    const summarySource = cleanString(row.summary_json || row.metrics_json);
    const parsed = parseJson(summarySource);
    if (!parsed.ok) {
      invalidJson.push({ snapshot_id: row.snapshot_id, error: parsed.error });
      continue;
    }
    if (row.metrics_sha256) {
      const expected = cleanString(row.metrics_sha256);
      const actual = reportMetricsSha256(parsed.value);
      if (actual !== expected) {
        hashMismatches.push({ snapshot_id: row.snapshot_id, expected, actual });
      }
    }
  }
  const duplicates = db.prepare(`
    SELECT snapshot_key, COUNT(*) AS count
    FROM report_snapshots
    WHERE snapshot_key IS NOT NULL AND snapshot_key != ''
    GROUP BY snapshot_key
    HAVING COUNT(*) > 1
  `).all();
  if (invalidJson.length > 0) failures.push(`report_snapshots has ${invalidJson.length} invalid JSON row(s)`);
  if (hashMismatches.length > 0) failures.push(`report_snapshots has ${hashMismatches.length} metrics_sha256 mismatch(es)`);
  if (duplicates.length > 0) failures.push(`report_snapshots has ${duplicates.length} duplicate snapshot_key value(s)`);
  return {
    ok: invalidJson.length === 0 && hashMismatches.length === 0 && duplicates.length === 0,
    snapshot_count: rows.length,
    invalid_json_count: invalidJson.length,
    hash_mismatch_count: hashMismatches.length,
    duplicate_snapshot_key_count: duplicates.length,
    invalid_json: invalidJson,
    hash_mismatches: hashMismatches,
    duplicate_snapshot_keys: duplicates
  };
}

function checkDailyMetrics(db, failures) {
  if (!tableExists(db, "report_daily_store_metrics")) {
    return { ok: true, row_count: 0, duplicate_metric_key_count: 0 };
  }
  const rowCount = db.prepare("SELECT COUNT(*) AS count FROM report_daily_store_metrics").get().count;
  const duplicates = db.prepare(`
    SELECT metric_key, COUNT(*) AS count
    FROM report_daily_store_metrics
    GROUP BY metric_key
    HAVING COUNT(*) > 1
  `).all();
  if (duplicates.length > 0) failures.push(`report_daily_store_metrics has ${duplicates.length} duplicate metric_key value(s)`);
  return {
    ok: duplicates.length === 0,
    row_count: rowCount,
    duplicate_metric_key_count: duplicates.length,
    duplicate_metric_keys: duplicates
  };
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

async function purgeOldEvidence(targetDir, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = await fsp.readdir(targetDir, { withFileTypes: true });
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^restore-drill-\d{8}-\d{6}-[a-f0-9]{6}\.json$/.test(entry.name)) continue;
    const filePath = path.join(targetDir, entry.name);
    const stat = await fsp.stat(filePath);
    if (stat.mtimeMs >= cutoff) continue;
    await fsp.rm(filePath, { force: true });
    deleted += 1;
  }
  return deleted;
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

function parseJson(value) {
  try {
    return { ok: true, value: value ? JSON.parse(value) : {} };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function restoreDrillAuditEvent(evidence, error = null) {
  return {
    event_type: "restore_drill.completed",
    status: evidence.ok ? "success" : "failure",
    restore_drill_id: evidence.restore_drill_id,
    backup_file: evidence.backup_file,
    manifest_file: evidence.manifest_file,
    manifest_present: Boolean(evidence.manifest),
    require_manifest: requireManifest,
    evidence_file: evidence.evidence_path ? path.basename(evidence.evidence_path) : "",
    encrypted: Boolean(evidence.encryption?.encrypted),
    decrypted: Boolean(evidence.encryption?.decrypted),
    failures_count: evidence.failures.length,
    warnings_count: evidence.warnings.length,
    deleted_old_evidence: evidence.deleted_old_evidence || 0,
    error: error ? sanitizeError(error) : ""
  };
}

async function appendRestoreDrillAudit(operationId, event) {
  return appendBackupOpsAuditEvent({
    auditDir: backupOpsAuditDir,
    retentionDays: backupOpsAuditRetentionDays,
    event: {
      operation_id: operationId,
      operation: "restore_drill",
      operator,
      context,
      ...event
    }
  });
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = cleanString(options.label) || command;
    let settled = false;
    let stderr = "";
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(new Error(`failed to run ${command}: ${error.message}`));
    });
    child.on("close", (status) => {
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
    pad(now.getUTCSeconds())
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

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function printLines(evidence) {
  process.stdout.write(`ok=${evidence.ok ? "true" : "false"}\n`);
  process.stdout.write(`restore_drill_id=${evidence.restore_drill_id}\n`);
  process.stdout.write(`evidence=${evidence.evidence_path}\n`);
  process.stdout.write(`backup_artifact_sha256=${evidence.backup_artifact_sha256 || ""}\n`);
  process.stdout.write(`sqlite_sha256=${evidence.sqlite_sha256 || ""}\n`);
  process.stdout.write(`failures=${evidence.failures.length}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  scripts/restore-drill.mjs --backup PATH [--manifest PATH] [--assets-dir DIR]
                            [--evidence-dir DIR] [--operator NAME]
                            [--context TEXT] [--evidence-retention-days DAYS]
                            [--require-manifest] [--audit-dir DIR]
                            [--audit-retention-days DAYS]
                            [--age-identity-file PATH] [--age-cli age]
                            [--json]

Verifies a backup artifact without mutating the live DB and writes restore drill
evidence JSON. If --assets-dir is provided, cloud asset files are checked for
presence, size, and sha256 against the restored DB catalog. Encrypted age
artifacts require an explicit identity file for decrypt-then-verify drills.
Use --require-manifest for product/commercial readiness checks where
manifest-missing artifacts must fail the drill.
`);
}
