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

    const providers = await admin("GET", "/api/admin/studio-generation-providers");
    assertProviderCatalog(providers.data.studio_generation_providers);

    const project = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "B1 provider job foundation",
      objective: "生成ジョブの手前で権利と証跡を管理する",
      target_audience: "受付後に案内を見る来店客",
      store_context: "3面サイネージが入口正面にある",
      offer_or_message: "春の施設内キャンペーンを短く伝える",
      cta: "QRから詳細を見る",
      success_metrics: ["play_count", "qr_scan_count"],
      constraints: ["外部AIは呼ばない", "公開はしない"],
      auto_generate_scenes: true
    });
    const projectBody = project.data.campaign_project;
    const sceneId = projectBody.scenes[0].campaign_project_scene_id;

    const mockInput = {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_id: projectBody.campaign_project_id,
      campaign_project_scene_id: sceneId,
      provider_id: "mock_provider",
      capability: "text_to_image",
      requested_asset_role: "background",
      idempotency_key: `idem-mock-${runId}`,
      prompt: "明るい受付背景のfixtureを使う"
    };
    const createdMock = await admin("POST", "/api/admin/ai-generation-jobs", mockInput);
    const mockJob = createdMock.data.ai_generation_job;
    assertJob(mockJob, { records, projectBody, providerId: "mock_provider", status: "queued" });

    const duplicateMock = await admin("POST", "/api/admin/ai-generation-jobs", mockInput);
    if (!duplicateMock.data.idempotency_reused || duplicateMock.data.ai_generation_job.ai_generation_job_id !== mockJob.ai_generation_job_id) {
      throw new Error(`idempotency reuse failed: ${duplicateMock.text}`);
    }
    await expectAdminError("POST", "/api/admin/ai-generation-jobs", {
      ...mockInput,
      prompt: "same key different prompt must conflict"
    }, 409, "idempotency_key");

    await expectAdminError("POST", "/api/admin/ai-generation-jobs", {
      ...mockInput,
      idempotency_key: `real-provider-${runId}`,
      provider_id: "fal"
    }, 400, "out of scope");
    await expectAdminError("POST", "/api/admin/ai-generation-jobs", {
      ...mockInput,
      idempotency_key: `secret-${runId}`,
      api_key: "should-not-be-accepted"
    }, 400, "out of scope");
    await expectAdminError("POST", "/api/admin/ai-generation-jobs", {
      ...mockInput,
      idempotency_key: `scope-${runId}`,
      tenant_id: records.otherTenantId
    }, 403, "tenant scope");

    const startedMock = await admin("POST", `/api/admin/ai-generation-jobs/${mockJob.ai_generation_job_id}/start`, {});
    assertJob(startedMock.data.ai_generation_job, { records, projectBody, providerId: "mock_provider", status: "running" });

    const completedMock = await admin("POST", `/api/admin/ai-generation-jobs/${mockJob.ai_generation_job_id}/complete`, {
      output_asset_id: `asset-mock-${runId}`
    });
    if (completedMock.data.ai_generation_job.status !== "asset_review_required") {
      throw new Error(`mock job should wait for asset review: ${completedMock.text}`);
    }
    const mockProvenance = completedMock.data.asset_provenance;
    assertProvenance(mockProvenance, { records, projectBody, sourceType: "mock_fixture", publishCandidate: false });

    const manualInput = {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      campaign_project_id: projectBody.campaign_project_id,
      provider_id: "manual_upload",
      capability: "manual_upload",
      requested_asset_role: "reference_only",
      idempotency_key: `idem-manual-${runId}`,
      prompt: "operator uploaded approved background candidate"
    };
    const manual = await admin("POST", "/api/admin/ai-generation-jobs", manualInput);
    await admin("POST", `/api/admin/ai-generation-jobs/${manual.data.ai_generation_job.ai_generation_job_id}/start`, {});
    const completedManual = await admin("POST", `/api/admin/ai-generation-jobs/${manual.data.ai_generation_job.ai_generation_job_id}/complete`, {
      output_asset_id: `asset-manual-${runId}`
    });
    const manualProvenanceId = completedManual.data.asset_provenance.asset_provenance_id;
    await expectAdminError("PATCH", `/api/admin/asset-provenance/${manualProvenanceId}`, {
      publish_candidate_allowed: true
    }, 400, "publish_candidate_allowed");
    const approvedManual = await admin("PATCH", `/api/admin/asset-provenance/${manualProvenanceId}`, {
      rights_review_status: "approved",
      license_status: "customer_provided",
      commercial_use_allowed: true,
      publish_candidate_allowed: true,
      review_notes: "smoke-approved manual asset"
    });
    if (!approvedManual.data.asset_provenance.publish_candidate_allowed || approvedManual.data.ai_generation_job.status !== "succeeded") {
      throw new Error(`manual provenance approval did not close linked job: ${approvedManual.text}`);
    }

    const failJob = await admin("POST", "/api/admin/ai-generation-jobs", {
      ...mockInput,
      idempotency_key: `idem-fail-${runId}`,
      prompt: "timeout path"
    });
    await admin("POST", `/api/admin/ai-generation-jobs/${failJob.data.ai_generation_job.ai_generation_job_id}/start`, {});
    const failed = await admin("POST", `/api/admin/ai-generation-jobs/${failJob.data.ai_generation_job.ai_generation_job_id}/fail`, {
      status: "timeout",
      error_class: "timeout",
      error_message: "fixture timeout"
    });
    if (failed.data.ai_generation_job.status !== "timeout" || failed.data.ai_generation_job.retry_count !== 1) {
      throw new Error(`timeout job did not record bounded retry: ${failed.text}`);
    }

    const deletedJob = await admin("DELETE", `/api/admin/ai-generation-jobs/${failJob.data.ai_generation_job.ai_generation_job_id}`);
    if (!deletedJob.data.ai_generation_job.deleted_at) throw new Error(`job soft delete failed: ${deletedJob.text}`);
    const listedJobs = await admin("GET", `/api/admin/ai-generation-jobs?tenant_id=${records.tenantId}`);
    if (listedJobs.data.ai_generation_jobs.some((entry) => entry.ai_generation_job_id === failJob.data.ai_generation_job.ai_generation_job_id)) {
      throw new Error("deleted generation job should be hidden from default list");
    }

    const deletedProvenance = await admin("DELETE", `/api/admin/asset-provenance/${mockProvenance.asset_provenance_id}`);
    if (!deletedProvenance.data.asset_provenance.deleted_at) throw new Error(`provenance soft delete failed: ${deletedProvenance.text}`);
    const listedProvenance = await admin("GET", `/api/admin/asset-provenance?tenant_id=${records.tenantId}`);
    if (listedProvenance.data.asset_provenance.some((entry) => entry.asset_provenance_id === mockProvenance.asset_provenance_id)) {
      throw new Error("deleted asset provenance should be hidden from default list");
    }

    if (tableCount("content_manifests") !== beforeContentManifestCount) throw new Error("content_manifest should not be created by B1");
    if (tableCount("publish_history") !== beforePublishHistoryCount) throw new Error("publish_history should not be created by B1");
    if (optionalTableCount("ai_credit_ledger") !== beforeCreditLedgerCount) throw new Error("credit ledger should not be touched by B1");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      studio_provider_job_foundation: true,
      provider_catalog_manual_and_mock_only: true,
      idempotency_guard: true,
      bounded_retry_error_classification: true,
      provenance_required_before_publish_candidate: true,
      tenant_store_screen_group_isolation: true,
      soft_delete_jobs_and_provenance: true,
      no_external_provider_call: true,
      no_secret_exposure: true,
      no_mcp_runtime_dependency: true,
      no_credit_consumption: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

function assertProviderCatalog(providers) {
  const ids = providers.map((provider) => provider.provider_id).sort();
  if (ids.join(",") !== "manual_upload,mock_provider") {
    throw new Error(`unexpected provider catalog: ${JSON.stringify(providers)}`);
  }
  for (const provider of providers) {
    for (const field of ["external_network_allowed", "secrets_required", "mcp_runtime_dependency"]) {
      if (provider[field] !== false) throw new Error(`provider ${provider.provider_id} should not require ${field}`);
    }
    for (const guard of ["no_external_provider_call", "no_paid_provider_call", "no_mcp_runtime_dependency", "no_secret_material", "no_credit_consumption"]) {
      if (provider[guard] !== true) throw new Error(`provider ${provider.provider_id} missing guard ${guard}`);
    }
  }
}

function assertJob(job, { records, projectBody, providerId, status }) {
  if (job.tenant_id !== records.tenantId || job.store_id !== records.storeId || job.screen_group_id !== records.screenGroupId) {
    throw new Error(`job scope mismatch: ${JSON.stringify(job)}`);
  }
  if (job.campaign_project_id !== projectBody.campaign_project_id) throw new Error(`job project mismatch: ${JSON.stringify(job)}`);
  if (job.provider_id !== providerId || job.status !== status) throw new Error(`job provider/status mismatch: ${JSON.stringify(job)}`);
  if (job.cost_estimate_units !== 0 || job.cost_actual_units !== null && job.cost_actual_units !== 0) {
    throw new Error(`job should be zero-cost in B1: ${JSON.stringify(job)}`);
  }
  for (const guard of ["no_external_provider_call", "no_paid_provider_call", "no_mcp_runtime_dependency", "no_secret_material", "no_credit_consumption", "no_content_manifest_creation", "no_publish"]) {
    if (job[guard] !== true) throw new Error(`job missing guard ${guard}: ${JSON.stringify(job)}`);
  }
}

function assertProvenance(provenance, { records, projectBody, sourceType, publishCandidate }) {
  if (provenance.tenant_id !== records.tenantId || provenance.store_id !== records.storeId || provenance.screen_group_id !== records.screenGroupId) {
    throw new Error(`provenance scope mismatch: ${JSON.stringify(provenance)}`);
  }
  if (provenance.campaign_project_id !== projectBody.campaign_project_id) throw new Error(`provenance project mismatch: ${JSON.stringify(provenance)}`);
  if (provenance.source_type !== sourceType) throw new Error(`provenance source mismatch: ${JSON.stringify(provenance)}`);
  if (provenance.publish_candidate_allowed !== publishCandidate) throw new Error(`publish candidate mismatch: ${JSON.stringify(provenance)}`);
  for (const guard of ["no_external_provider_call", "no_secret_material", "no_credit_consumption", "no_content_manifest_creation", "no_publish"]) {
    if (provenance[guard] !== true) throw new Error(`provenance missing guard ${guard}: ${JSON.stringify(provenance)}`);
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-SPJ-${runId}`,
    otherTenantId: `TEN-SPJ-OTHER-${runId}`,
    storeId: `STO-SPJ-${runId}`,
    otherStoreId: `STO-SPJ-OTHER-${runId}`,
    screenGroupId: `SG-SPJ-${runId}`,
    otherScreenGroupId: `SG-SPJ-OTHER-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-SPJ-${runId}`);
  await seedDevice(records.otherTenantId, records.otherStoreId, records.otherScreenGroupId, `DEV-SPJ-OTHER-${runId}`);
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-studio-provider-job-"));
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
      DEVICE_TOKEN_PEPPER: "studio-provider-job-smoke-pepper"
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
