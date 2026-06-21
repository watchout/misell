import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

const BACKUP_ARTIFACT_PATTERN = /^misell-cloud-\d{8}-\d{6}(?:-\d{3})?\.sqlite(?:\.gz)?(?:\.age)?$/;
const BACKUP_MANIFEST_PATTERN = /^misell-cloud-\d{8}-\d{6}(?:-\d{3})?\.sqlite(?:\.gz)?(?:\.age)?\.manifest\.json$/;
const BACKUP_TEMP_PATTERN = /^misell-cloud-\d{8}-\d{6}(?:-\d{3})?\.sqlite(?:\.gz)?(?:\.age)?\.tmp-\d+$/;
const AUDIT_FILE_PATTERN = /^backup-ops-\d{6}\.jsonl$/;

export function defaultBackupOpsAuditDir() {
  return path.join(os.homedir(), ".local", "share", "misell-cloud", "backup-ops-audit");
}

export async function appendBackupOpsAuditEvent({ auditDir, retentionDays, event }) {
  const targetDir = path.resolve(auditDir || defaultBackupOpsAuditDir());
  await fsp.mkdir(targetDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(targetDir, 0o700).catch(() => {});

  const now = new Date();
  const eventBody = {
    schema_version: 1,
    event_id: `boae-${timestamp(now)}-${crypto.randomBytes(4).toString("hex")}`,
    created_at: now.toISOString(),
    ...event
  };
  const auditPath = path.join(targetDir, `backup-ops-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}.jsonl`);
  await fsp.appendFile(auditPath, `${JSON.stringify(eventBody)}\n`, { mode: 0o600 });
  await fsp.chmod(auditPath, 0o600).catch(() => {});
  const deleted_old_audit_files = await purgeOldBackupOpsAuditFiles(targetDir, retentionDays);
  return {
    audit_path: auditPath,
    deleted_old_audit_files
  };
}

export async function scanBackupArtifacts(backupDir, options = {}) {
  const sampleLimit = Number.isSafeInteger(options.sampleLimit) ? options.sampleLimit : 20;
  const entries = await fsp.readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const artifacts = files.filter((file) => BACKUP_ARTIFACT_PATTERN.test(file));
  const manifests = files.filter((file) => BACKUP_MANIFEST_PATTERN.test(file));
  const temp_artifacts = files.filter((file) => BACKUP_TEMP_PATTERN.test(file));
  const manifestSet = new Set(manifests);
  const artifactSet = new Set(artifacts);
  const manifest_missing_artifacts = artifacts.filter((file) => !manifestSet.has(`${file}.manifest.json`));
  const orphan_manifests = manifests.filter((file) => !artifactSet.has(file.slice(0, -".manifest.json".length)));

  return {
    backup_dir: path.resolve(backupDir),
    artifact_count: artifacts.length,
    manifest_count: manifests.length,
    manifest_missing_count: manifest_missing_artifacts.length,
    orphan_manifest_count: orphan_manifests.length,
    temp_artifact_count: temp_artifacts.length,
    manifest_missing_artifacts: manifest_missing_artifacts.slice(0, sampleLimit),
    orphan_manifests: orphan_manifests.slice(0, sampleLimit),
    temp_artifacts: temp_artifacts.slice(0, sampleLimit)
  };
}

async function purgeOldBackupOpsAuditFiles(targetDir, days) {
  const retentionDays = Number.isFinite(days) ? days : 400;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fsp.readdir(targetDir, { withFileTypes: true }).catch(() => []);
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !AUDIT_FILE_PATTERN.test(entry.name)) continue;
    const filePath = path.join(targetDir, entry.name);
    const stat = await fsp.stat(filePath);
    if (stat.mtimeMs >= cutoff) continue;
    await fsp.rm(filePath, { force: true });
    deleted += 1;
  }
  return deleted;
}

function timestamp(now) {
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

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}
