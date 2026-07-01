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

    const project = await createValidatedProject(records);
    const scene = project.scenes.find((entry) => entry.cta_text) || project.scenes[0];
    if (!scene) throw new Error("expected generated project scene");

    const missingQr = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/measurement-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      measurement_goal: "qr_scan_count",
      expected_action: "qr_scan",
      item_type: "sponsor",
      content_layer: "campaign_refresh",
      creative_id: `CR-D1-${runId}`,
      ad_slot_id: `ADS-D1-${runId}`,
      variation_group: `VG-D1-${runId}`,
      improvement_reason: "初回QR CTAの反応を測る",
      measurement_label: "measured",
      data_source_class: "misell_qr"
    });
    const binding = missingQr.data.studio_measurement_binding;
    if (binding.validation_status !== "invalid") throw new Error(`binding should be invalid before QR is linked: ${missingQr.text}`);
    if (!binding.validation_errors.some((error) => error.code === "required_for_qr_scan")) {
      throw new Error(`missing QR validation error not present: ${missingQr.text}`);
    }

    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/measurement-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      measurement_goal: "sales_lift",
      expected_action: "qr_scan",
      creative_id: `CR-INCR-${runId}`,
      measurement_label: "incremental",
      data_source_class: "misell_qr"
    }, 400, "incremental");

    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/measurement-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      measurement_goal: "qr_scan_count",
      expected_action: "qr_scan",
      creative_id: `CR-EXT-${runId}`,
      measurement_label: "measured",
      data_source_class: "external_estimate"
    }, 400, "measured");

    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/measurement-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      measurement_goal: "qr_scan_count",
      expected_action: "qr_scan",
      creative_id: `CR-PUBLISH-${runId}`,
      publish: true
    }, 400, "out of scope");

    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/measurement-bindings`, {
      tenant_id: records.otherTenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      measurement_goal: "qr_scan_count",
      expected_action: "qr_scan",
      creative_id: `CR-SCOPE-${runId}`
    }, 403, "tenant scope");

    const qrResult = await admin("POST", `/api/admin/studio-measurement-bindings/${binding.measurement_binding_id}/qr-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      target_url: `https://example.invalid/misell-d1-${runId}`,
      status: "active",
      expires_at: "2099-12-31T00:00:00.000Z"
    });
    const qrBinding = qrResult.data.studio_qr_binding;
    const validatedBinding = qrResult.data.studio_measurement_binding;
    if (validatedBinding.validation_status !== "valid" || validatedBinding.qr_link_id !== qrBinding.qr_link_id) {
      throw new Error(`binding should become valid after QR link: ${qrResult.text}`);
    }
    if (qrBinding.attribution_claim !== "measured_response_only") {
      throw new Error(`QR binding must be response-only: ${qrResult.text}`);
    }

    const fetched = await admin("GET", `/api/admin/studio-measurement-bindings/${binding.measurement_binding_id}?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    if (!fetched.data.studio_measurement_binding.qr_bindings.some((entry) => entry.qr_link_id === qrBinding.qr_link_id)) {
      throw new Error(`QR binding missing from detail response: ${fetched.text}`);
    }
    await expectAdminError("GET", `/api/admin/studio-measurement-bindings/${binding.measurement_binding_id}?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");

    const scan = await publicRequest("GET", `/q/${qrBinding.qr_token}?visit_id=VISIT-D1-${runId}`, { redirect: "manual" });
    if (![302, 303, 307, 308].includes(scan.response.status)) {
      throw new Error(`expected QR redirect after scan evidence, got ${scan.response.status}: ${scan.text}`);
    }
    const scanRow = db().prepare("SELECT * FROM qr_scans WHERE qr_link_id = ?").get(qrBinding.qr_link_id);
    if (!scanRow) throw new Error("QR scan row was not recorded");
    assertEqual(scanRow.campaign_project_id, project.campaign_project_id, "scan campaign_project_id");
    assertEqual(scanRow.campaign_project_scene_id, scene.campaign_project_scene_id, "scan scene_id");
    assertEqual(scanRow.creative_id, binding.creative_id, "scan creative_id");
    assertEqual(scanRow.ad_slot_id, binding.ad_slot_id, "scan ad_slot_id");
    assertEqual(scanRow.measurement_label, "measured", "scan measurement_label");
    assertEqual(scanRow.data_source_class, "misell_qr", "scan data_source_class");
    assertEqual(scanRow.attribution_claim, "measured_response_only", "scan attribution_claim");

    const projectDetail = await admin("GET", `/api/admin/campaign-projects/${project.campaign_project_id}`);
    const updatedScene = projectDetail.data.campaign_project.scenes.find((entry) => entry.campaign_project_scene_id === scene.campaign_project_scene_id);
    if (updatedScene.measurement.qr_link_id !== qrBinding.qr_link_id) {
      throw new Error(`scene measurement fields were not updated: ${JSON.stringify(updatedScene)}`);
    }
    if (!projectDetail.data.campaign_project.events.some((event) => event.action === "qr_binding.created")) {
      throw new Error(`qr_binding event missing: ${projectDetail.text}`);
    }

    const deleted = await admin("DELETE", `/api/admin/studio-measurement-bindings/${binding.measurement_binding_id}`);
    if (deleted.data.studio_measurement_binding.status !== "deleted") {
      throw new Error(`measurement binding should soft delete: ${deleted.text}`);
    }
    const deletedQr = db().prepare("SELECT * FROM studio_qr_bindings WHERE qr_link_id = ?").get(qrBinding.qr_link_id);
    if (deletedQr.status !== "deleted" || !deletedQr.deleted_at) throw new Error(`QR binding should soft delete: ${JSON.stringify(deletedQr)}`);
    const revokedQr = db().prepare("SELECT * FROM qr_links WHERE qr_link_id = ?").get(qrBinding.qr_link_id);
    if (revokedQr.status !== "revoked") throw new Error(`active QR link should be revoked on binding delete: ${JSON.stringify(revokedQr)}`);

    if (tableCount("content_manifests") !== beforeContentManifestCount) throw new Error("content_manifest should not be created by D1");
    if (tableCount("publish_history") !== beforePublishHistoryCount) throw new Error("publish_history should not be created by D1");
    if (tableCount("device_commands") !== beforeDeviceCommandCount) throw new Error("device commands should not be created by D1");
    if (optionalTableCount("ai_credit_ledger") !== beforeCreditLedgerCount) throw new Error("credit ledger should not be touched by D1");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      studio_measurement_binding: true,
      qr_binding_reverse_lookup: true,
      incremental_without_evidence_blocked: true,
      measured_external_source_blocked: true,
      qr_scan_response_only: true,
      tenant_store_screen_group_isolation: true,
      soft_delete: true,
      no_roi_fabrication: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_player_device_mutation: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function createValidatedProject(records) {
  const projectResponse = await admin("POST", "/api/admin/campaign-projects/free-input", {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    title: "D1 measurement binding smoke",
    objective: "QR反応を測れるキャンペーンにする",
    target_audience: "館内サイネージを見る来店客",
    store_context: "3面横並びのサイネージが入口にある",
    offer_or_message: "QRから詳しい案内を確認できる",
    cta: "QRから詳細を見る",
    success_metrics: ["qr_scan_count", "play_count"],
    constraints: ["保証表現を避ける", "個人情報を入れない"],
    auto_generate_scenes: true
  });
  const project = projectResponse.data.campaign_project;
  const validated = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/validate`, {});
  if (!validated.data.valid) throw new Error(`project should validate: ${validated.text}`);
  return validated.data.campaign_project;
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-D1-${runId}`,
    otherTenantId: `TEN-D1-OTHER-${runId}`,
    storeId: `STO-D1-${runId}`,
    otherStoreId: `STO-D1-OTHER-${runId}`,
    screenGroupId: `SG-D1-${runId}`,
    otherScreenGroupId: `SG-D1-OTHER-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-D1-${runId}`);
  await seedDevice(records.otherTenantId, records.otherStoreId, records.otherScreenGroupId, `DEV-D1-OTHER-${runId}`);
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

async function publicRequest(method, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: options.redirect || "follow"
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
}

function tableCount(table) {
  const handle = db();
  try {
    return handle.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    handle.close();
  }
}

function optionalTableCount(table) {
  const handle = db();
  try {
    const exists = handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return exists ? handle.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count : 0;
  } finally {
    handle.close();
  }
}

function db() {
  return new Database(dbPath);
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-studio-measurement-binding-"));
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
      DEVICE_TOKEN_PEPPER: "studio-measurement-binding-smoke-pepper",
      NODE_ENV: "test"
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
