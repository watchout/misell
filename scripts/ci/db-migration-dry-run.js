#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

async function main() {
  const repoRoot = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "misell-cloud-db-dry-run-"));
  const port = await getFreePort();
  const dbPath = path.join(tempDir, "misell-cloud.sqlite");
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_PATH: dbPath,
    MISELL_CLOUD_DATA_DIR: tempDir,
    MISELL_CLOUD_ASSETS_DIR: path.join(tempDir, "assets"),
    ADMIN_PASSWORD: "ci-admin-password",
    DEVICE_TOKEN_PEPPER: "ci-device-token-pepper-value"
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(repoRoot, "apps/cloud"),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(port);
    if (!fs.existsSync(dbPath)) throw new Error(`Expected dry-run DB to exist at ${dbPath}`);
    assertStudioPhase1Schema(repoRoot, dbPath);
    console.log(`Cloud DB dry-run passed: ${dbPath}`);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (stderr.trim()) console.log(stderr.trim());
}

function assertStudioPhase1Schema(repoRoot, dbPath) {
  const Database = require(path.join(repoRoot, "apps/cloud/node_modules/better-sqlite3"));
  const db = new Database(dbPath, { readonly: true });
  try {
    for (const table of [
      "screen_slots",
      "screen_device_bindings",
      "content_approvals",
      "publish_history",
      "studio_layout_templates",
      "studio_cut_plans",
      "studio_render_manifests",
      "studio_render_qa_results",
      "studio_publish_preflight_results",
      "content_manifest_draft_transforms",
      "studio_measurement_bindings",
      "studio_qr_bindings"
    ]) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!row) throw new Error(`Expected Studio Phase 1 table '${table}' to exist`);
    }
    assertColumns(db, "content_manifests", [
      "tenant_id",
      "store_id",
      "screen_group_id",
      "screen_slot_id",
      "manifest_schema_version",
      "manifest_version",
      "content_hash",
      "lifecycle_status"
    ]);
    assertColumns(db, "content_approvals", [
      "approval_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "screen_slot_id",
      "content_type",
      "subject_type",
      "subject_id",
      "subject_hash",
      "content_hash",
      "approval_status"
    ]);
    assertColumns(db, "publish_history", [
      "publish_history_id",
      "content_id",
      "manifest_version",
      "manifest_schema_version",
      "content_hash",
      "approval_snapshot_json",
      "approval_hash"
    ]);
    assertColumns(db, "studio_cut_plans", [
      "cut_plan_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "campaign_project_id",
      "cut_plan_version",
      "layout_template_id",
      "deterministic_identity_json",
      "validation_status"
    ]);
    assertColumns(db, "studio_render_manifests", [
      "render_manifest_id",
      "cut_plan_id",
      "renderer_version",
      "output_type",
      "output_sha256",
      "qa_status",
      "render_state_json"
    ]);
    assertColumns(db, "studio_render_qa_results", [
      "render_qa_result_id",
      "render_manifest_id",
      "qa_suite_version",
      "checks_json",
      "blocked_reasons_json"
    ]);
    assertColumns(db, "studio_publish_preflight_results", [
      "publish_preflight_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "campaign_project_id",
      "render_manifest_id",
      "required_asset_ids_json",
      "content_type",
      "publish_mode",
      "status",
      "checks_json",
      "blocked_reasons_json",
      "docs99_gate_ref",
      "docs99_gate_verdict",
      "approval_gate_ref",
      "no_active_content_manifest_mutation",
      "no_content_manifest_activation",
      "no_publish",
      "no_player_device_mutation",
      "no_schedule_activation",
      "dry_run_only"
    ]);
    assertColumns(db, "content_manifest_draft_transforms", [
      "draft_transform_id",
      "publish_preflight_id",
      "campaign_project_id",
      "render_manifest_id",
      "draft_content_manifest_id",
      "status",
      "transform_errors_json",
      "playlist_item_draft_ids_json",
      "content_manifest_draft_json",
      "content_manifest_draft_sha256",
      "no_active_content_manifest_mutation",
      "no_content_manifest_activation",
      "no_publish",
      "no_player_device_mutation",
      "no_schedule_activation"
    ]);
    assertColumns(db, "studio_measurement_bindings", [
      "measurement_binding_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "campaign_project_id",
      "campaign_project_scene_id",
      "render_manifest_id",
      "content_layer",
      "item_type",
      "measurement_goal",
      "expected_action",
      "creative_id",
      "qr_link_id",
      "measurement_label",
      "data_source_class",
      "baseline_evidence_ref",
      "holdout_evidence_ref",
      "validation_status",
      "validation_checks_json",
      "deleted_at"
    ]);
    assertColumns(db, "studio_qr_bindings", [
      "qr_binding_id",
      "qr_link_id",
      "qr_token",
      "measurement_binding_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "campaign_project_id",
      "campaign_project_scene_id",
      "creative_id",
      "target_url",
      "status",
      "attribution_claim",
      "deleted_at"
    ]);
    assertColumns(db, "qr_links", [
      "measurement_binding_id",
      "campaign_project_id",
      "campaign_project_scene_id",
      "creative_id",
      "ad_slot_id",
      "measurement_label",
      "data_source_class",
      "attribution_claim"
    ]);
    assertColumns(db, "qr_scans", [
      "measurement_binding_id",
      "campaign_project_id",
      "campaign_project_scene_id",
      "creative_id",
      "ad_slot_id",
      "measurement_label",
      "data_source_class",
      "attribution_claim"
    ]);
    assertColumns(db, "studio_generation_providers", [
      "provider_id",
      "capabilities_json",
      "external_network_allowed",
      "secrets_required",
      "mcp_runtime_dependency"
    ]);
    assertColumns(db, "ai_generation_jobs", [
      "ai_generation_job_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "campaign_project_id",
      "campaign_project_scene_id",
      "provider_id",
      "capability",
      "input_sha256",
      "idempotency_key",
      "status",
      "error_class",
      "provider_job_id",
      "output_asset_id",
      "retry_count",
      "no_external_provider_call",
      "no_secret_material",
      "no_credit_consumption",
      "no_content_manifest_creation",
      "no_publish"
    ]);
    assertColumns(db, "asset_provenance", [
      "asset_provenance_id",
      "asset_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "campaign_project_id",
      "ai_generation_job_id",
      "source_type",
      "license_status",
      "commercial_use_allowed",
      "rights_review_status",
      "publish_candidate_allowed",
      "no_external_provider_call",
      "no_secret_material",
      "no_credit_consumption",
      "no_content_manifest_creation",
      "no_publish"
    ]);
  } finally {
    db.close();
  }
}

function assertColumns(db, table, columns) {
  const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const column of columns) {
    if (!present.has(column)) throw new Error(`Expected ${table}.${column} to exist`);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForHealth(port) {
  const deadline = Date.now() + 15000;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${port}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for cloud server health during DB dry-run"));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
