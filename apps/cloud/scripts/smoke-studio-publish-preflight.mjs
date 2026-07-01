import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const adminAuth = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`;
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let serverProcess = null;
let tmpDir = "";
let dbPath = "";
let baseUrl = "";

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  process.exit(1);
});

async function main() {
  await startServer();
  try {
    const records = await seedDevices();
    const beforeContentManifestCount = tableCount("content_manifests");
    const beforePublishHistoryCount = tableCount("publish_history");
    const beforeDeviceCommandCount = tableCount("device_commands");
    const beforeCreditLedgerCount = optionalTableCount("ai_credit_ledger");

    const { project, manifest } = await createValidatedRenderedProject(records, "C1 publish preflight happy path");
    const approvedAssetId = `asset-c1-approved-${runId}`;
    await admin("POST", "/api/admin/asset-provenance", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_id: project.campaign_project_id,
      asset_id: approvedAssetId,
      source_type: "manual_upload",
      license_status: "customer_provided",
      commercial_use_allowed: true,
      rights_review_status: "approved",
      publish_candidate_allowed: true,
      review_notes: "C1 smoke approved internal asset"
    });
    db().prepare(`
      UPDATE studio_render_manifests
      SET source_asset_ids_json = ?,
          updated_at = ?
      WHERE render_manifest_id = ?
    `).run(JSON.stringify([approvedAssetId]), new Date().toISOString(), manifest.render_manifest_id);

    const happy = await createPreflight(project, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      render_manifest_id: manifest.render_manifest_id,
      content_type: "normal",
      docs99_gate_verdict: "not_applicable",
      request_reason: "happy path"
    });
    assertPreflight(happy.data.studio_publish_preflight, {
      status: "passed",
      transformStatus: "draft_created",
      expectDraft: true,
      requiredAssetId: approvedAssetId
    });

    const fetched = await admin("GET", `/api/admin/studio-publish-preflights/${happy.data.studio_publish_preflight.publish_preflight_id}?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    assertPreflight(fetched.data.studio_publish_preflight, {
      status: "passed",
      transformStatus: "draft_created",
      expectDraft: true
    });
    const listed = await admin("GET", `/api/admin/campaign-projects/${project.campaign_project_id}/publish-preflights?tenant_id=${records.tenantId}`);
    if (!listed.data.studio_publish_preflights.some((entry) => entry.publish_preflight_id === happy.data.studio_publish_preflight.publish_preflight_id)) {
      throw new Error(`preflight missing from project list: ${listed.text}`);
    }

    const humanReview = await createPreflight(project, {
      render_manifest_id: manifest.render_manifest_id,
      content_type: "ad",
      docs99_gate_verdict: "human_review_required",
      docs99_gate_ref: "docs/99#smoke-human-review"
    });
    assertPreflight(humanReview.data.studio_publish_preflight, {
      status: "human_review_required",
      transformStatus: "failed_preflight",
      expectDraft: false,
      requiredBlockedReason: "docs99_gate_fail_closed"
    });

    const docsBlock = await createPreflight(project, {
      render_manifest_id: manifest.render_manifest_id,
      content_type: "sponsor",
      docs99_gate_verdict: "block",
      docs99_gate_ref: "docs/99#smoke-block"
    });
    assertPreflight(docsBlock.data.studio_publish_preflight, {
      status: "failed",
      transformStatus: "failed_preflight",
      expectDraft: false,
      requiredBlockedReason: "docs99_gate_fail_closed"
    });

    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/publish-preflights`, {
      tenant_id: records.otherTenantId,
      render_manifest_id: manifest.render_manifest_id
    }, 403, "tenant scope");
    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/publish-preflights`, {
      render_manifest_id: manifest.render_manifest_id,
      publish: true
    }, 400, "out of scope");

    const qaProject = await createValidatedRenderedProject(records, "C1 render QA failed path");
    db().prepare(`
      UPDATE studio_render_manifests
      SET qa_status = 'failed',
          qa_errors_json = '[{"code":"smoke_qa_failed"}]',
          updated_at = ?
      WHERE render_manifest_id = ?
    `).run(new Date().toISOString(), qaProject.manifest.render_manifest_id);
    const qaFailed = await createPreflight(qaProject.project, {
      render_manifest_id: qaProject.manifest.render_manifest_id,
      content_type: "normal",
      docs99_gate_verdict: "not_applicable"
    });
    assertPreflight(qaFailed.data.studio_publish_preflight, {
      status: "failed",
      transformStatus: "failed_preflight",
      expectDraft: false,
      requiredBlockedReason: "render_manifest_qa_passed"
    });

    db().prepare(`
      UPDATE campaign_projects
      SET status = 'draft',
          validation_status = 'draft',
          updated_at = ?
      WHERE campaign_project_id = ?
    `).run(new Date().toISOString(), project.campaign_project_id);
    const projectInvalid = await createPreflight(project, {
      render_manifest_id: manifest.render_manifest_id,
      content_type: "normal",
      docs99_gate_verdict: "not_applicable"
    });
    assertPreflight(projectInvalid.data.studio_publish_preflight, {
      status: "failed",
      transformStatus: "failed_preflight",
      expectDraft: false,
      requiredBlockedReason: "campaign_project_validated"
    });

    const projectDetail = await admin("GET", `/api/admin/campaign-projects/${project.campaign_project_id}`);
    if (!projectDetail.data.campaign_project.events.some((event) => event.action === "publish_preflight.created")) {
      throw new Error(`publish preflight event missing: ${projectDetail.text}`);
    }

    if (tableCount("content_manifests") !== beforeContentManifestCount) throw new Error("content_manifest should not be created by C1");
    if (tableCount("publish_history") !== beforePublishHistoryCount) throw new Error("publish_history should not be created by C1");
    if (tableCount("device_commands") !== beforeDeviceCommandCount) throw new Error("device commands should not be created by C1");
    if (optionalTableCount("ai_credit_ledger") !== beforeCreditLedgerCount) throw new Error("credit ledger should not be touched by C1");
    if (tableCount("studio_publish_preflight_results") < 5) throw new Error("studio_publish_preflight_results rows missing");
    if (tableCount("content_manifest_draft_transforms") < 5) throw new Error("content_manifest_draft_transforms rows missing");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      studio_publish_preflight: true,
      dry_run_transform: true,
      docs99_fail_closed: true,
      render_qa_required: true,
      project_validation_required: true,
      tenant_store_screen_group_isolation: true,
      no_active_content_manifest_mutation: true,
      no_content_manifest_creation: true,
      no_content_manifest_activation: true,
      no_publish: true,
      no_player_device_mutation: true,
      no_schedule_activation: true,
      no_credit_consumption: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function createValidatedRenderedProject(records, title) {
  const projectResponse = await admin("POST", "/api/admin/campaign-projects/free-input", {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    title,
    objective: "C1 publish preflight の検証",
    target_audience: "館内サイネージを見る来店客",
    store_context: "3面横並びのサイネージが入口にある",
    offer_or_message: "QRから詳しい案内を確認できる",
    cta: "QRから詳細を見る",
    success_metrics: ["play_count", "qr_scan_count"],
    constraints: ["保証表現を避ける", "個人情報を入れない"],
    auto_generate_scenes: true
  });
  const project = projectResponse.data.campaign_project;
  const validateProject = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/validate`, {});
  if (!validateProject.data.valid) throw new Error(`project should validate: ${validateProject.text}`);
  const cutPlanResponse = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/cut-plans`, {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId
  });
  const cutPlan = cutPlanResponse.data.studio_cut_plan;
  const validateCutPlan = await admin("POST", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/validate`, {});
  if (!validateCutPlan.data.valid) throw new Error(`cut plan should validate: ${validateCutPlan.text}`);
  const manifestResponse = await admin("POST", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/render-manifests`, {
    output_type: "html_preview"
  });
  const manifest = manifestResponse.data.studio_render_manifest;
  if (manifest.qa_status !== "passed" || !manifest.output_sha256) {
    throw new Error(`render manifest should be QA-passed: ${manifestResponse.text}`);
  }
  return {
    project: validateProject.data.campaign_project,
    cutPlan,
    manifest
  };
}

async function createPreflight(project, body) {
  return admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/publish-preflights`, body);
}

function assertPreflight(preflight, { status, transformStatus, expectDraft, requiredBlockedReason = "", requiredAssetId = "" }) {
  if (preflight.status !== status) throw new Error(`preflight status mismatch: ${JSON.stringify(preflight)}`);
  if (!Array.isArray(preflight.checks) || preflight.checks.length < 5) throw new Error(`preflight checks missing: ${JSON.stringify(preflight)}`);
  for (const guard of [
    "no_active_content_manifest_mutation",
    "no_content_manifest_activation",
    "no_publish",
    "no_player_device_mutation",
    "no_schedule_activation",
    "dry_run_only"
  ]) {
    if (preflight[guard] !== true) throw new Error(`preflight missing guard ${guard}: ${JSON.stringify(preflight)}`);
  }
  if (requiredBlockedReason && !preflight.blocked_reasons.includes(requiredBlockedReason)) {
    throw new Error(`blocked reason ${requiredBlockedReason} missing: ${JSON.stringify(preflight)}`);
  }
  if (requiredAssetId && !preflight.required_asset_ids.includes(requiredAssetId)) {
    throw new Error(`required asset id missing: ${JSON.stringify(preflight)}`);
  }
  const transform = preflight.content_manifest_draft_transform;
  if (!transform || transform.status !== transformStatus) throw new Error(`draft transform mismatch: ${JSON.stringify(preflight)}`);
  for (const guard of [
    "no_active_content_manifest_mutation",
    "no_content_manifest_activation",
    "no_publish",
    "no_player_device_mutation",
    "no_schedule_activation"
  ]) {
    if (transform[guard] !== true) throw new Error(`transform missing guard ${guard}: ${JSON.stringify(transform)}`);
  }
  if (expectDraft) {
    if (!transform.content_manifest_draft_sha256 || transform.content_manifest_draft?.status !== "draft") {
      throw new Error(`draft content manifest evidence missing: ${JSON.stringify(transform)}`);
    }
    if (transform.content_manifest_draft?.activation?.status !== "not_requested") {
      throw new Error(`draft transform should not request activation: ${JSON.stringify(transform.content_manifest_draft)}`);
    }
  } else if (transform.content_manifest_draft_sha256 || Object.keys(transform.content_manifest_draft || {}).length > 0) {
    throw new Error(`failed preflight should not create draft manifest evidence: ${JSON.stringify(transform)}`);
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-SPPF-${runId}`,
    otherTenantId: `TEN-SPPF-OTHER-${runId}`,
    storeId: `STO-SPPF-${runId}`,
    otherStoreId: `STO-SPPF-OTHER-${runId}`,
    screenGroupId: `SG-SPPF-${runId}`,
    otherScreenGroupId: `SG-SPPF-OTHER-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-SPPF-${runId}`);
  await seedDevice(records.otherTenantId, records.otherStoreId, records.otherScreenGroupId, `DEV-SPPF-OTHER-${runId}`);
  return records;
}

async function seedDevice(tenantId, storeId, screenGroupId, deviceId) {
  await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: `${tenantId} Name`,
    store_id: storeId,
    store_name: `${storeId} Store`,
    location_id: `LOC-${screenGroupId}`,
    location_name: "Main",
    screen_group_id: screenGroupId,
    screen_group_name: `${screenGroupId} Front`,
    device_id: deviceId,
    device_name: `${deviceId} Player`,
    release_channel: "stable"
  });
}

async function admin(method, endpoint, body = undefined) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: adminAuth,
      ...(body === undefined || body === null ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined || body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`Admin ${method} ${endpoint} failed ${response.status}: ${text}`);
    error.status = response.status;
    error.text = text;
    throw error;
  }
  return { response, data, text };
}

async function expectAdminError(method, endpoint, body, status, message) {
  try {
    await admin(method, endpoint, body);
  } catch (error) {
    if (error.status !== status || !String(error.text || error.message).includes(message)) {
      throw new Error(`Expected ${status}/${message}, got ${error.status}: ${error.text || error.message}`);
    }
    return;
  }
  throw new Error(`Expected ${method} ${endpoint} to fail with ${status}`);
}

function tableCount(table) {
  return db().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function optionalTableCount(table) {
  const exists = db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return exists ? tableCount(table) : 0;
}

function db() {
  return new Database(dbPath);
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-studio-publish-preflight-"));
  dbPath = path.join(tmpDir, "misell-cloud.sqlite");
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DB_PATH: dbPath,
      MISELL_CLOUD_DATA_DIR: tmpDir,
      MISELL_CLOUD_ASSETS_DIR: path.join(tmpDir, "assets"),
      ADMIN_USER: adminUser,
      ADMIN_PASSWORD: adminPassword,
      DEVICE_TOKEN_PEPPER: "studio-publish-preflight-smoke-pepper"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.trim()) process.stderr.write(text);
  });
  await waitForHealth();
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess = null;
  }
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
}

function waitForHealth() {
  const deadline = Date.now() + 15000;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // retry
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for cloud server"));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
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
