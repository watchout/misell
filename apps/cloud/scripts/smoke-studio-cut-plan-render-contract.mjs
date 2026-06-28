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
    const beforeCreditLedgerCount = optionalTableCount("ai_credit_ledger");

    const project = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "A1 deterministic render contract",
      objective: "3面サイネージ向けのカット割を検証する",
      target_audience: "受付後に案内を見る来店客",
      store_context: "入口正面に3面横並びのモニターがある",
      offer_or_message: "短く読める見出しとQR誘導で次の行動を案内する",
      cta: "QRから案内を見る",
      success_metrics: ["play_count", "qr_scan_count"],
      constraints: ["保証表現を避ける", "個人情報を入れない"],
      auto_generate_scenes: true
    });
    const projectId = project.data.campaign_project.campaign_project_id;
    const validateProject = await admin("POST", `/api/admin/campaign-projects/${projectId}/validate`, {});
    if (!validateProject.data.valid) throw new Error(`project should validate before cut plan: ${validateProject.text}`);

    const createCutPlan = await admin("POST", `/api/admin/campaign-projects/${projectId}/cut-plans`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId
    });
    const cutPlan = createCutPlan.data.studio_cut_plan;
    assertCutPlan(cutPlan, { projectId, records, expectedSceneCount: 3 });
    if (cutPlan.status !== "draft" || cutPlan.validation_status !== "pending") {
      throw new Error(`new cut plan should be draft/pending: ${createCutPlan.text}`);
    }

    await expectAdminError("POST", `/api/admin/campaign-projects/${projectId}/cut-plans`, {
      tenant_id: records.otherTenantId
    }, 403, "tenant scope");
    await expectAdminError("POST", `/api/admin/campaign-projects/${projectId}/cut-plans`, {
      render_job_id: "out-of-scope"
    }, 400, "out of scope");

    const validateCutPlan = await admin("POST", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/validate`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId
    });
    if (!validateCutPlan.data.valid || validateCutPlan.data.studio_cut_plan.status !== "validated") {
      throw new Error(`cut plan did not validate: ${validateCutPlan.text}`);
    }
    await expectAdminError("POST", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/validate`, {
      tenant_id: records.otherTenantId
    }, 403, "tenant scope");

    const manifestResponse = await admin("POST", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/render-manifests`, {
      output_type: "html_preview"
    });
    const manifest = manifestResponse.data.studio_render_manifest;
    assertRenderManifest(manifest, { cutPlan, records, expectedSceneCount: 3 });
    if (!Array.isArray(manifest.qa_results) || manifest.qa_results.length < 1 || manifest.qa_results[0].status !== "passed") {
      throw new Error(`render QA result missing: ${manifestResponse.text}`);
    }
    await expectAdminError("POST", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/render-manifests`, {
      output_type: "mp4_export"
    }, 400, "html_preview");

    const rerunQa = await admin("POST", `/api/admin/studio-render-manifests/${manifest.render_manifest_id}/qa`, {});
    if (rerunQa.data.qa_result.status !== "passed") throw new Error(`QA rerun should pass: ${rerunQa.text}`);
    const manifestDetail = await admin("GET", `/api/admin/studio-render-manifests/${manifest.render_manifest_id}?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    assertRenderManifest(manifestDetail.data.studio_render_manifest, { cutPlan, records, expectedSceneCount: 3 });
    await expectAdminError("GET", `/api/admin/studio-render-manifests/${manifest.render_manifest_id}?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");

    const invalidProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "A1 invalid cut plan",
      objective: "不正Sceneをcut-planにしない",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "QRを見る",
      scenes: [{
        scene_order: 1,
        scene_type: "hook",
        headline: "売上が必ず上がるキャンペーン",
        body_text: "担当 test@example.com へ連絡",
        visual_direction: "不正な検証用",
        cta_text: "QRを見る",
        duration_seconds: 6
      }]
    });
    await expectAdminError("POST", `/api/admin/campaign-projects/${invalidProject.data.campaign_project.campaign_project_id}/cut-plans`, {}, 400, "cut plan validation failed");

    const projectAfterContract = await admin("GET", `/api/admin/campaign-projects/${projectId}`);
    for (const action of ["cut_plan.created", "cut_plan.validated", "render_manifest.created", "render_manifest.qa_rerun"]) {
      if (!projectAfterContract.data.campaign_project.events.some((event) => event.action === action)) {
        throw new Error(`project event missing: ${action}`);
      }
    }

    const deletedManifest = await admin("DELETE", `/api/admin/studio-render-manifests/${manifest.render_manifest_id}`);
    if (deletedManifest.data.studio_render_manifest.status !== "deleted" || deletedManifest.data.studio_render_manifest.qa_status !== "deleted") {
      throw new Error(`render manifest was not soft deleted: ${deletedManifest.text}`);
    }
    const manifestList = await admin("GET", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}/render-manifests`);
    if (manifestList.data.studio_render_manifests.some((entry) => entry.render_manifest_id === manifest.render_manifest_id)) {
      throw new Error("deleted render manifest should be hidden from default list");
    }
    const deletedCutPlan = await admin("DELETE", `/api/admin/studio-cut-plans/${cutPlan.cut_plan_id}`);
    if (deletedCutPlan.data.studio_cut_plan.status !== "deleted" || !deletedCutPlan.data.studio_cut_plan.deleted_at) {
      throw new Error(`cut plan was not soft deleted: ${deletedCutPlan.text}`);
    }
    const cutPlanList = await admin("GET", `/api/admin/campaign-projects/${projectId}/cut-plans`);
    if (cutPlanList.data.studio_cut_plans.some((entry) => entry.cut_plan_id === cutPlan.cut_plan_id)) {
      throw new Error("deleted cut plan should be hidden from default list");
    }

    if (tableCount("content_manifests") !== beforeContentManifestCount) throw new Error("content_manifest should not be created by A1");
    if (tableCount("publish_history") !== beforePublishHistoryCount) throw new Error("publish_history should not be created by A1");
    if (optionalTableCount("ai_credit_ledger") !== beforeCreditLedgerCount) throw new Error("credit ledger should not be touched by A1");
    if (tableCount("studio_layout_templates") < 1) throw new Error("studio_layout_templates seed missing");
    if (tableCount("studio_cut_plans") < 1) throw new Error("studio_cut_plans row missing");
    if (tableCount("studio_render_manifests") < 1) throw new Error("studio_render_manifests row missing");
    if (tableCount("studio_render_qa_results") < 2) throw new Error("studio_render_qa_results rows missing");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      studio_cut_plan_contract: true,
      scene_to_cut_plan_mapping: true,
      render_manifest_contract: true,
      html_preview_state_source_of_truth: true,
      executable_render_qa: true,
      invalid_cut_plan_reject: true,
      tenant_store_screen_group_isolation: true,
      soft_delete_cut_plan_manifest: true,
      no_external_ai: true,
      no_media_generation: true,
      no_mp4_export: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

function assertCutPlan(cutPlan, { projectId, records, expectedSceneCount }) {
  if (cutPlan.campaign_project_id !== projectId) throw new Error(`cut plan project mismatch: ${JSON.stringify(cutPlan)}`);
  if (cutPlan.tenant_id !== records.tenantId || cutPlan.store_id !== records.storeId || cutPlan.screen_group_id !== records.screenGroupId) {
    throw new Error(`cut plan scope mismatch: ${JSON.stringify(cutPlan)}`);
  }
  if (!cutPlan.cut_plan_version || cutPlan.source_scene_ids.length !== expectedSceneCount) {
    throw new Error(`cut plan source identity missing: ${JSON.stringify(cutPlan)}`);
  }
  if (!cutPlan.screen_bindings?.left?.length || !cutPlan.screen_bindings?.center?.length || !cutPlan.screen_bindings?.right?.length) {
    throw new Error(`cut plan screen bindings missing: ${JSON.stringify(cutPlan.screen_bindings)}`);
  }
  for (const field of ["no_external_ai", "no_media_generation", "no_mp4_export", "no_content_manifest_creation", "no_publish"]) {
    if (cutPlan[field] !== true) throw new Error(`cut plan missing guard ${field}: ${JSON.stringify(cutPlan)}`);
  }
}

function assertRenderManifest(manifest, { cutPlan, records, expectedSceneCount }) {
  if (manifest.cut_plan_id !== cutPlan.cut_plan_id) throw new Error(`manifest cut plan mismatch: ${JSON.stringify(manifest)}`);
  if (manifest.tenant_id !== records.tenantId || manifest.store_id !== records.storeId || manifest.screen_group_id !== records.screenGroupId) {
    throw new Error(`manifest scope mismatch: ${JSON.stringify(manifest)}`);
  }
  if (manifest.output_type !== "html_preview" || manifest.renderer !== "html" || manifest.qa_status !== "passed") {
    throw new Error(`manifest render contract mismatch: ${JSON.stringify(manifest)}`);
  }
  if (!manifest.output_sha256 || !manifest.output_ref.startsWith("render-state:")) {
    throw new Error(`manifest output identity missing: ${JSON.stringify(manifest)}`);
  }
  if (manifest.scene_ids.length !== expectedSceneCount || manifest.render_state?.scenes?.length !== expectedSceneCount) {
    throw new Error(`manifest scenes missing: ${JSON.stringify(manifest)}`);
  }
  if (manifest.generated_asset_ids.length !== 0 || manifest.provider_job_ids.length !== 0 || manifest.no_mp4_export !== true) {
    throw new Error(`manifest out-of-scope side effect detected: ${JSON.stringify(manifest)}`);
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-SCP-${runId}`,
    otherTenantId: `TEN-SCP-OTHER-${runId}`,
    storeId: `STO-SCP-${runId}`,
    otherStoreId: `STO-SCP-OTHER-${runId}`,
    screenGroupId: `SG-SCP-${runId}`,
    otherScreenGroupId: `SG-SCP-OTHER-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-SCP-${runId}`);
  await seedDevice(records.otherTenantId, records.otherStoreId, records.otherScreenGroupId, `DEV-SCP-OTHER-${runId}`);
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-studio-cut-plan-"));
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
      DEVICE_TOKEN_PEPPER: "studio-cut-plan-smoke-pepper"
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
