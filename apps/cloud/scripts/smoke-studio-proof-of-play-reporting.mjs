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
    seedCampaign(records);

    const measurement = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/measurement-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      measurement_goal: "qr_scan_count",
      expected_action: "qr_scan",
      item_type: "sponsor",
      content_layer: "campaign_refresh",
      campaign_id: records.campaignId,
      media_campaign_id: `MC-D3-${runId}`,
      creative_id: `CR-D3-${runId}`,
      ad_slot_id: `ADS-D3-${runId}`,
      variation_group: `VG-D3-${runId}`,
      measurement_label: "measured",
      data_source_class: "misell_qr"
    });
    const binding = measurement.data.studio_measurement_binding;
    const qrResult = await admin("POST", `/api/admin/studio-measurement-bindings/${binding.measurement_binding_id}/qr-bindings`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      target_url: `https://example.invalid/misell-d3-${runId}`,
      status: "active",
      expires_at: "2099-12-31T00:00:00.000Z"
    });
    const qrBinding = qrResult.data.studio_qr_binding;
    const validatedBinding = qrResult.data.studio_measurement_binding;
    if (validatedBinding.validation_status !== "valid") throw new Error(`measurement binding should be valid: ${qrResult.text}`);

    await publicRequest("GET", `/q/${qrBinding.qr_token}?visit_id=VISIT-D3-${runId}`, { redirect: "manual" });
    insertPlaylogSource(records, validatedBinding, qrBinding);

    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/proof-of-play-bindings/rebuild`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      roi: true
    }, 400, "out of scope");
    await expectAdminError("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/proof-of-play-bindings/rebuild`, {
      tenant_id: records.otherTenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId
    }, 403, "tenant scope");

    const rebuild = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/proof-of-play-bindings/rebuild`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId
    });
    assertProofSummary(rebuild.data.studio_proof_of_play_summary);
    const firstCount = tableCount("studio_proof_of_play_bindings");
    if (firstCount !== 2) throw new Error(`expected 2 proof rows after first rebuild, got ${firstCount}: ${rebuild.text}`);

    const secondRebuild = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/proof-of-play-bindings/rebuild`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId
    });
    assertProofSummary(secondRebuild.data.studio_proof_of_play_summary);
    const secondCount = tableCount("studio_proof_of_play_bindings");
    if (secondCount !== firstCount) throw new Error(`rebuild should be idempotent, before=${firstCount} after=${secondCount}`);

    const list = await admin("GET", `/api/admin/campaign-projects/${project.campaign_project_id}/proof-of-play-bindings?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    const proofRows = list.data.studio_proof_of_play_bindings;
    if (proofRows.length !== 2) throw new Error(`expected list to return 2 proof rows: ${list.text}`);
    const playProof = proofRows.find((row) => row.source_system === "playlog");
    const qrProof = proofRows.find((row) => row.source_system === "qr_scan");
    if (!playProof || !qrProof) throw new Error(`expected playlog and qr_scan proof rows: ${list.text}`);
    assertEqual(playProof.evidence_label, "measured_play_evidence", "play evidence label");
    assertEqual(playProof.source_data_class, "misell_playlog", "play source data class");
    assertEqual(playProof.measurement_label, "measured", "play measurement label");
    assertEqual(playProof.data_source_class, "misell_qr", "play D1 data source class");
    assertEqual(qrProof.evidence_label, "measured_response_only", "QR evidence label");
    assertEqual(qrProof.attribution_claim, "measured_response_only", "QR attribution claim");
    assertEqual(qrProof.source_data_class, "misell_qr", "QR source data class");
    assertEqual(qrProof.measurement_binding_id, binding.measurement_binding_id, "QR measurement binding");
    assertEqual(qrProof.campaign_project_scene_id, scene.campaign_project_scene_id, "QR scene reverse lookup");
    if (qrProof.no_roi_fabrication !== true || playProof.no_roi_fabrication !== true) {
      throw new Error(`proof rows must declare no ROI fabrication: ${list.text}`);
    }

    const detail = await admin("GET", `/api/admin/studio-proof-of-play-bindings/${qrProof.proof_binding_id}?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    if (detail.data.studio_proof_of_play_binding.proof_binding_id !== qrProof.proof_binding_id) {
      throw new Error(`proof detail mismatch: ${detail.text}`);
    }
    await expectAdminError("GET", `/api/admin/studio-proof-of-play-bindings/${qrProof.proof_binding_id}?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");

    const projectDetail = await admin("GET", `/api/admin/campaign-projects/${project.campaign_project_id}`);
    if (!projectDetail.data.campaign_project.events.some((event) => event.action === "proof_of_play.rebuilt")) {
      throw new Error(`proof rebuild event missing: ${projectDetail.text}`);
    }

    if (tableCount("content_manifests") !== beforeContentManifestCount) throw new Error("content_manifest should not be created by D3");
    if (tableCount("publish_history") !== beforePublishHistoryCount) throw new Error("publish_history should not be created by D3");
    if (tableCount("device_commands") !== beforeDeviceCommandCount) throw new Error("device commands should not be created by D3");
    if (optionalTableCount("ai_credit_ledger") !== beforeCreditLedgerCount) throw new Error("credit ledger should not be touched by D3");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      studio_proof_of_play_reporting: true,
      idempotent_rebuild: true,
      duplicate_protection: true,
      tenant_store_screen_group_isolation: true,
      labels_preserved: true,
      playlog_measured_play_evidence_only: true,
      qr_scan_measured_response_only: true,
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
    title: "D3 proof of play smoke",
    objective: "放映証跡とQR反応証跡を分けて確認できるようにする",
    target_audience: "館内サイネージを見る来店客",
    store_context: "3面横並びのサイネージが入口にある",
    offer_or_message: "QRから詳しい案内を確認できる",
    cta: "QRから詳細を見る",
    success_metrics: ["play_count", "qr_scan_count"],
    constraints: ["ROIを断定しない", "個人情報を入れない"],
    auto_generate_scenes: true
  });
  const project = projectResponse.data.campaign_project;
  const validated = await admin("POST", `/api/admin/campaign-projects/${project.campaign_project_id}/validate`, {});
  if (!validated.data.valid) throw new Error(`project should validate: ${validated.text}`);
  return validated.data.campaign_project;
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-D3-${runId}`,
    otherTenantId: `TEN-D3-OTHER-${runId}`,
    storeId: `STO-D3-${runId}`,
    otherStoreId: `STO-D3-OTHER-${runId}`,
    screenGroupId: `SG-D3-${runId}`,
    otherScreenGroupId: `SG-D3-OTHER-${runId}`,
    deviceId: `DEV-D3-${runId}`,
    campaignId: `CAM-D3-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, records.deviceId);
  await seedDevice(records.otherTenantId, records.otherStoreId, records.otherScreenGroupId, `DEV-D3-OTHER-${runId}`);
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

function seedCampaign(records) {
  const handle = db();
  try {
    const now = "2026-06-28T00:00:00.000Z";
    handle.prepare(`
      INSERT INTO campaigns (
        campaign_id, advertiser_id, campaign_name, status, start_date, end_date,
        target_store_ids_json, target_time_slots_json, priority, qr_url, notes,
        created_at, updated_at
      ) VALUES (?, NULL, ?, 'active', ?, ?, ?, '[]', 0, '', ?, ?, ?)
    `).run(
      records.campaignId,
      `D3 smoke campaign ${runId}`,
      "2026-06-01",
      "2026-06-30",
      JSON.stringify([records.storeId]),
      "Studio proof-of-play smoke campaign",
      now,
      now
    );
  } finally {
    handle.close();
  }
}

function insertPlaylogSource(records, binding, qrBinding) {
  const handle = db();
  try {
    const occurredAt = "2026-06-28T12:00:00.000Z";
    handle.prepare(`
      INSERT INTO playlogs (
        device_id, tenant_id, store_id, screen_group_id, received_at, played_at,
        playlist_version, playlist_item_id, campaign_id, asset_id, layout, duration, result,
        event_id, event_type, occurred_at, content_id, playback_id,
        item_type, ad_slot_id, creative_id, qr_link_id, manifest_hash,
        planned_duration_seconds, played_duration_seconds, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      records.deviceId,
      records.tenantId,
      records.storeId,
      records.screenGroupId,
      occurredAt,
      occurredAt,
      `PL-D3-${runId}`,
      `PLI-D3-${runId}`,
      binding.campaign_id,
      `ASSET-D3-${runId}`,
      "triple_screen",
      12,
      "completed",
      `EV-D3-${runId}`,
      "playback",
      occurredAt,
      `CONTENT-D3-${runId}`,
      `PB-D3-${runId}`,
      "sponsor",
      binding.ad_slot_id,
      binding.creative_id,
      qrBinding.qr_link_id,
      `mh-d3-${runId}`,
      12,
      12,
      JSON.stringify({ smoke: "studio-proof-of-play-reporting", qr_link_id: qrBinding.qr_link_id })
    );
  } finally {
    handle.close();
  }
}

function assertProofSummary(summary) {
  if (!summary || summary.no_roi_fabrication !== true) throw new Error(`unsafe proof summary: ${JSON.stringify(summary)}`);
  if (summary.evidence_counts?.measured_play_evidence !== 1) {
    throw new Error(`expected one measured play evidence row: ${JSON.stringify(summary)}`);
  }
  if (summary.evidence_counts?.measured_response_only !== 1) {
    throw new Error(`expected one measured response row: ${JSON.stringify(summary)}`);
  }
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-studio-proof-of-play-reporting-"));
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
      DEVICE_TOKEN_PEPPER: "studio-proof-of-play-smoke-pepper",
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
