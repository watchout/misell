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
    await seedContext(records);
    const beforeContentManifestCount = tableCount("content_manifests");

    const selectedProposalResponse = await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-selected`,
      title: "雨の日の館内回遊プロジェクト",
      objective: "雨の日でも館内回遊のきっかけを増やす",
      status: "selected"
    }));
    const selectedProposal = selectedProposalResponse.data.campaign_proposal;
    if (!selectedProposal.campaign_brief_id) throw new Error("selected proposal did not create a campaign brief");

    const projectFromProposal = await admin("POST", "/api/admin/campaign-projects/from-proposal", {
      campaign_proposal_id: selectedProposal.campaign_proposal_id,
      scenes: validScenes()
    });
    assertProject(projectFromProposal.data.campaign_project, "campaign_proposal", records);
    if (projectFromProposal.data.campaign_project.scenes.length !== 3) {
      throw new Error(`project from proposal should have 3 scenes: ${projectFromProposal.text}`);
    }

    const validateSelected = await admin("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/validate`, {});
    if (!validateSelected.data.valid || validateSelected.data.campaign_project.status !== "validated") {
      throw new Error(`selected proposal project did not validate: ${validateSelected.text}`);
    }
    if (validateSelected.data.campaign_project.scenes.some((scene) => scene.status !== "valid")) {
      throw new Error(`validated project contains non-valid scenes: ${validateSelected.text}`);
    }

    const projectFromBrief = await admin("POST", "/api/admin/campaign-projects/from-brief", {
      campaign_brief_id: selectedProposal.campaign_brief_id,
      scenes: [validScenes()[0]]
    });
    assertProject(projectFromBrief.data.campaign_project, "campaign_brief", records);
    db().prepare(`
      UPDATE campaign_project_scenes
      SET screen_group_id = ?
      WHERE campaign_project_id = ?
    `).run(records.otherStoreScreenGroupId, projectFromBrief.data.campaign_project.campaign_project_id);
    const scopeMismatchValidation = await admin("POST", `/api/admin/campaign-projects/${projectFromBrief.data.campaign_project.campaign_project_id}/validate`, {});
    if (scopeMismatchValidation.data.valid) throw new Error("project with scene scope mismatch should fail validation");
    if (!scopeMismatchValidation.data.validation_errors.some((error) => error.code === "scope_mismatch")) {
      throw new Error(`scope mismatch validation error missing: ${scopeMismatchValidation.text}`);
    }

    const freeInputProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "夏休み前のファミリー訴求",
      objective: "平日昼のファミリー利用に向けた案内を整理する",
      target_audience: "平日昼に来店する家族連れ",
      store_context: "駅前店舗。雨の日は滞在時間が長くなりやすい。",
      offer_or_message: "親子で使いやすい個室と軽食メニューを案内する",
      cta: "QRから当日のおすすめを見る",
      success_metrics: ["play_count", "qr_scan_count"],
      constraints: ["保証表現を避ける", "個人情報を入れない"],
      scenes: validScenes("free")
    });
    assertProject(freeInputProject.data.campaign_project, "free_input", records);
    const validateFree = await admin("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/validate`, {});
    if (!validateFree.data.valid || validateFree.data.campaign_project.status !== "validated") {
      throw new Error(`free input project did not validate: ${validateFree.text}`);
    }

    const invalidProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "validation failure project",
      objective: "validation failure",
      target_audience: "test audience",
      store_context: "test store context",
      offer_or_message: "test message",
      cta: "QRを見る",
      scenes: [
        {
          scene_order: 1,
          scene_type: "hook",
          headline: "売上が必ず上がるキャンペーン",
          body_text: "担当者 test@example.com に連絡してください",
          visual_direction: "店内写真",
          cta_text: "",
          duration_seconds: 0
        }
      ]
    });
    const invalidValidation = await admin("POST", `/api/admin/campaign-projects/${invalidProject.data.campaign_project.campaign_project_id}/validate`, {});
    if (invalidValidation.data.valid) throw new Error(`invalid project unexpectedly validated: ${invalidValidation.text}`);
    const invalidCodes = new Set(invalidValidation.data.validation_errors.map((error) => error.code));
    for (const code of ["invalid", "missing_cta", "guaranteed_outcome_claim", "direct_pii"]) {
      if (!invalidCodes.has(code)) throw new Error(`expected validation error ${code}, got ${JSON.stringify([...invalidCodes])}`);
    }

    const proposedResponse = await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-proposed`,
      title: "未採用提案",
      status: "proposed"
    }));
    await expectAdminError("POST", "/api/admin/campaign-projects/from-proposal", {
      campaign_proposal_id: proposedResponse.data.campaign_proposal.campaign_proposal_id,
      scenes: validScenes()
    }, 400, "must be selected");

    const badProjectId = insertBadProjectFixture(records, proposedResponse.data.campaign_proposal.campaign_proposal_id);
    await admin("POST", `/api/admin/campaign-projects/${badProjectId}/scenes`, validScenes()[0]);
    const badProjectValidation = await admin("POST", `/api/admin/campaign-projects/${badProjectId}/validate`, {});
    if (badProjectValidation.data.valid) throw new Error("project with non-selected source proposal should fail validation");
    if (!badProjectValidation.data.validation_errors.some((error) => error.code === "non_selected_proposal")) {
      throw new Error(`non-selected proposal validation error missing: ${badProjectValidation.text}`);
    }

    await expectAdminError("POST", "/api/admin/campaign-projects/from-proposal", {
      tenant_id: records.tenantId,
      store_id: records.otherStoreId,
      screen_group_id: records.screenGroupId,
      campaign_proposal_id: selectedProposal.campaign_proposal_id,
      scenes: validScenes()
    }, 403, "store scope");

    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "外部AI拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      external_ai_used: true
    }, 400, "external AI");
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "publish拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      publish: true
    }, 400, "out of scope");
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "content manifest拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      content_manifest_id: "content-should-not-exist"
    }, 400, "out of scope");
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "render拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      render: { mode: "video" }
    }, 400, "out of scope");

    const scopedList = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    const scopedIds = scopedList.data.campaign_projects.map((project) => project.campaign_project_id);
    if (!scopedIds.includes(projectFromProposal.data.campaign_project.campaign_project_id) || !scopedIds.includes(freeInputProject.data.campaign_project.campaign_project_id)) {
      throw new Error(`scoped campaign project list missing expected project: ${JSON.stringify(scopedIds)}`);
    }
    const otherProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.otherStoreId,
      screen_group_id: records.otherStoreScreenGroupId,
      title: "other store project",
      objective: "other objective",
      target_audience: "other audience",
      store_context: "other context",
      offer_or_message: "other message",
      cta: "other CTA",
      scenes: validScenes("other")
    });
    const scopedListAfterOther = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    const scopedIdsAfterOther = scopedListAfterOther.data.campaign_projects.map((project) => project.campaign_project_id);
    if (scopedIdsAfterOther.includes(otherProject.data.campaign_project.campaign_project_id)) {
      throw new Error(`scoped list leaked other store project: ${JSON.stringify(scopedIdsAfterOther)}`);
    }
    await expectAdminError("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");

    const sceneToDelete = projectFromProposal.data.campaign_project.scenes[0];
    const deletedScene = await admin("DELETE", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${sceneToDelete.campaign_project_scene_id}`);
    if (deletedScene.data.campaign_project_scene.status !== "deleted") throw new Error(`scene was not soft deleted: ${deletedScene.text}`);
    const afterSceneDelete = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}`);
    if (afterSceneDelete.data.campaign_project.scenes.some((scene) => scene.campaign_project_scene_id === sceneToDelete.campaign_project_scene_id)) {
      throw new Error("deleted scene should be hidden from project detail by default");
    }
    const deletedProject = await admin("DELETE", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}`);
    if (deletedProject.data.campaign_project.status !== "deleted" || !deletedProject.data.campaign_project.deleted_at) {
      throw new Error(`project was not soft deleted: ${deletedProject.text}`);
    }
    const postDeleteList = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    if (postDeleteList.data.campaign_projects.some((project) => project.campaign_project_id === freeInputProject.data.campaign_project.campaign_project_id)) {
      throw new Error("deleted project should be hidden from default list");
    }
    const deletedList = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}&status=deleted&include_deleted=1`);
    if (!deletedList.data.campaign_projects.some((project) => project.campaign_project_id === freeInputProject.data.campaign_project.campaign_project_id)) {
      throw new Error("deleted project should be visible when status=deleted and include_deleted=1");
    }

    const afterContentManifestCount = tableCount("content_manifests");
    if (afterContentManifestCount !== beforeContentManifestCount) {
      throw new Error(`content_manifest was created unexpectedly: before=${beforeContentManifestCount} after=${afterContentManifestCount}`);
    }
    if (tableCount("publish_history") !== 0) throw new Error("publish history should not be created by campaign generator foundation");
    if (tableCount("campaign_projects") < 5) throw new Error("campaign_projects rows were not created");
    if (tableCount("campaign_project_scenes") < 7) throw new Error("campaign_project_scenes rows were not created");
    if (tableCount("campaign_project_events") < 8) throw new Error("campaign_project_events rows were not created");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      selected_proposal_to_brief_to_project: true,
      existing_brief_to_project: true,
      free_input_to_brief_to_project: true,
      scene_validation_pass_fail: true,
      scope_mismatch_validation_fail: true,
      non_selected_proposal_validation_fail: true,
      tenant_store_screen_group_isolation: true,
      soft_delete: true,
      no_external_ai: true,
      no_media_generation: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-CGF-${runId}`,
    otherTenantId: `TEN-CGF-OTHER-${runId}`,
    storeId: `STO-CGF-${runId}`,
    otherStoreId: `STO-CGF-OTHER-${runId}`,
    foreignStoreId: `STO-CGF-FOREIGN-${runId}`,
    screenGroupId: `SG-CGF-${runId}`,
    otherStoreScreenGroupId: `SG-CGF-OTHER-STORE-${runId}`,
    foreignScreenGroupId: `SG-CGF-FOREIGN-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-CGF-${runId}`);
  await seedDevice(records.tenantId, records.otherStoreId, records.otherStoreScreenGroupId, `DEV-CGF-OTHER-${runId}`);
  await seedDevice(records.otherTenantId, records.foreignStoreId, records.foreignScreenGroupId, `DEV-CGF-FOREIGN-${runId}`);
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

async function seedContext(records) {
  await admin("POST", "/api/admin/customer-context-items", contextInput(records, {
    context_category: "customer_profile",
    source_owner: "customer",
    source_type: "customer_input",
    confidence: "customer_confirmed",
    item_type: "store_profile",
    item_key: "rainy_day",
    value: { audience: "families", condition: "rainy weekday" }
  }));
}

function contextInput(records, overrides = {}) {
  return {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    context_category: "customer_profile",
    visibility_scope: "customer_visible",
    source_owner: "misell_operator",
    source_type: "operator_input",
    confidence: "operator_confirmed",
    item_type: "context_note",
    item_key: "default",
    value: {},
    ...overrides
  };
}

function proposalInput(records, overrides = {}) {
  return {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    proposal_month: "2026-07",
    title: "月次販促提案",
    objective: "来店中の回遊を増やす",
    target_audience: "平日昼の来店客",
    three_screen_outline: [
      { order: 1, copy: "雨の日でも楽しめる館内導線" },
      { order: 2, copy: "おすすめメニューと滞在提案" },
      { order: 3, copy: "QRからクーポンを確認" }
    ],
    qr_flow: "QRから当日のおすすめを見る",
    recommended_time_slots: ["11:00-15:00"],
    expected_effect: "QR反応を見るための検証仮説",
    required_assets: ["store-photo", "menu-photo"],
    status: "proposed",
    ...overrides
  };
}

function validScenes(prefix = "selected") {
  return [
    {
      scene_order: 1,
      scene_type: "hook",
      headline: `${prefix} 雨の日の過ごし方`,
      body_text: "店内でゆっくり過ごせるおすすめ導線を案内します",
      visual_direction: "入口と店内の明るい写真",
      cta_text: "QRからおすすめを見る",
      duration_seconds: 8,
      asset_requirements: ["store-photo"]
    },
    {
      scene_order: 2,
      scene_type: "offer",
      headline: `${prefix} 今日のおすすめ`,
      body_text: "軽食と個室利用の組み合わせを案内します",
      visual_direction: "メニュー写真と客席写真",
      cta_text: "詳しく見る",
      duration_seconds: 10,
      asset_requirements: ["menu-photo"]
    },
    {
      scene_order: 3,
      scene_type: "cta",
      headline: `${prefix} QRで確認`,
      body_text: "来店中に使える案内をスマートフォンで確認できます",
      visual_direction: "QRと短い案内文",
      cta_text: "QRを読み取る",
      duration_seconds: 7,
      asset_requirements: []
    }
  ];
}

function assertProject(project, sourceType, records) {
  if (!project || project.source_type !== sourceType) throw new Error(`unexpected project source_type: ${JSON.stringify(project)}`);
  if (project.tenant_id !== records.tenantId || !project.store_id || !project.screen_group_id) {
    throw new Error(`project scope is invalid: ${JSON.stringify(project)}`);
  }
  for (const field of ["objective", "target_audience", "store_context", "offer_or_message", "cta"]) {
    if (!project[field]) throw new Error(`project missing normalized brief field ${field}: ${JSON.stringify(project)}`);
  }
  if (!project.no_external_ai || !project.no_content_manifest_creation || !project.no_media_generation || !project.no_publish) {
    throw new Error(`project response is missing out-of-scope guards: ${JSON.stringify(project)}`);
  }
}

function insertBadProjectFixture(records, sourceProposalId) {
  const now = new Date().toISOString();
  const projectId = `cgp-${runId}-bad-source`;
  db().prepare(`
    INSERT INTO campaign_projects (
      campaign_project_id, tenant_id, store_id, screen_group_id,
      campaign_brief_id, source_type, source_proposal_id, source_context_snapshot_id,
      title, objective, target_audience, store_context, offer_or_message, cta,
      success_metrics_json, constraints_json, campaign_brief_json,
      status, validation_status, validation_errors_json,
      created_by_user_id, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', 'campaign_proposal', ?, '', ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', 'draft', 'draft', '[]', 'smoke', NULL, ?, ?)
  `).run(
    projectId,
    records.tenantId,
    records.storeId,
    records.screenGroupId,
    sourceProposalId,
    "bad source project",
    "bad source validation",
    "test audience",
    "test context",
    "test message",
    "QRを見る",
    now,
    now
  );
  return projectId;
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-campaign-generator-foundation-"));
  dbPath = path.join(tmpDir, "cloud.sqlite");
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_PATH: dbPath,
      MISELL_CLOUD_DATA_DIR: tmpDir,
      ADMIN_USER: adminUser,
      ADMIN_PASSWORD: adminPassword,
      REQUIRE_ADMIN_AUTH: "1",
      DEVICE_TOKEN_PEPPER: "smoke-device-pepper",
      MISELL_CUSTOMER_ACCESS_TOKEN_PEPPER: "smoke-customer-pepper"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer(port);
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess = null;
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("cloud server did not start");
}

async function admin(method, url, body = null) {
  return request(method, url, body, { authorization: adminAuth });
}

async function expectAdminError(method, url, body, status, messagePart) {
  return expectError(method, url, body, { authorization: adminAuth }, status, messagePart);
}

async function request(method, url, body = null, headers = {}) {
  const result = await rawRequest(method, url, body, headers);
  if (!result.response.ok) {
    throw new Error(`${method} ${url} returned ${result.response.status}: ${result.text}`);
  }
  return result;
}

async function rawRequest(method, url, body = null, headers = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { response, headers: response.headers, text, data };
}

async function expectError(method, url, body, headers, status, messagePart) {
  const result = await rawRequest(method, url, body, headers);
  if (result.response.status !== status) {
    throw new Error(`expected ${status} from ${method} ${url}, got ${result.response.status}: ${result.text}`);
  }
  if (messagePart && !result.text.includes(messagePart)) {
    throw new Error(`expected error containing ${messagePart}, got: ${result.text}`);
  }
  return result;
}

function tableCount(tableName, where = "1 = 1") {
  return db().prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`).get().count;
}

function db() {
  if (!db.instance) db.instance = new Database(dbPath);
  return db.instance;
}
