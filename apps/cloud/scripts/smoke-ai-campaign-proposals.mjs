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

    const primary = await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-primary`,
      title: "雨の日の館内回遊提案",
      objective: "雨の日でも滞在導線を作る"
    }));
    const primaryProposal = primary.data.campaign_proposal;
    if (!primaryProposal.context_snapshot_sha256 || primaryProposal.status !== "proposed") {
      throw new Error(`primary proposal was not created correctly: ${primary.text}`);
    }

    await admin("POST", "/api/admin/customer-context-items", contextInput(records, {
      context_category: "customer_profile",
      visibility_scope: "customer_visible",
      source_owner: "customer",
      source_type: "customer_input",
      confidence: "customer_confirmed",
      item_type: "brand_tone",
      item_key: "tone",
      value: { tone: "updated after snapshot" }
    }));
    const afterContextUpdate = await admin("GET", `/api/admin/campaign-proposals?campaign_proposal_id=${primaryProposal.campaign_proposal_id}&tenant_id=${records.tenantId}&store_id=${records.storeId}`);
    const sameProposal = afterContextUpdate.data.campaign_proposals.find((proposal) => proposal.campaign_proposal_id === primaryProposal.campaign_proposal_id);
    if (!sameProposal || sameProposal.context_snapshot_sha256 !== primaryProposal.context_snapshot_sha256) {
      throw new Error("proposal context snapshot changed after context item update");
    }

    await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-reject`,
      title: "平日昼の追加訴求",
      objective: "平日昼の空き時間を埋める"
    }));
    await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-reject-empty`,
      title: "夕方前の軽い訴求",
      objective: "却下理由なしでも履歴化できることを確認"
    }));
    await admin("POST", "/api/admin/campaign-proposals", proposalInput({
      ...records,
      screenGroupId: records.otherScreenGroupId
    }, {
      campaign_proposal_id: `cpr-${runId}-other-sg`,
      title: "別画面グループ提案",
      objective: "別画面グループ分離確認"
    }));
    await admin("POST", "/api/admin/campaign-proposals", proposalInput({
      ...records,
      storeId: records.otherStoreId,
      screenGroupId: records.otherStoreScreenGroupId
    }, {
      campaign_proposal_id: `cpr-${runId}-other-store`,
      title: "別店舗提案",
      objective: "店舗分離確認"
    }));
    await admin("POST", "/api/admin/campaign-proposals", proposalInput({
      tenantId: records.otherTenantId,
      storeId: records.foreignStoreId,
      screenGroupId: records.foreignScreenGroupId
    }, {
      campaign_proposal_id: `cpr-${runId}-foreign`,
      title: "別テナント提案",
      objective: "テナント分離確認"
    }));

    await expectAdminError("POST", "/api/admin/proposal-generation-runs", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      month: "2026-07",
      external_ai_used: true
    }, 400, "External AI");
    await expectAdminError("POST", "/api/admin/proposal-generation-runs", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      month: "2026-07"
    }, 400, "screen_group_id");
    await expectAdminError("POST", "/api/admin/customer-context-items", contextInput(records, {
      screen_group_id: "",
      item_key: "missing-screen-group"
    }), 400, "screen_group_id");
    await expectAdminError("POST", "/api/admin/customer-context-items", contextInput(records, {
      context_category: "facility_profile",
      item_key: "legacy-context-category"
    }), 400, "context_category");
    await expectAdminError("POST", "/api/admin/campaign-proposals", {
      ...proposalInput(records, {
        campaign_proposal_id: `cpr-${runId}-missing-sg`
      }),
      screen_group_id: ""
    }, 400, "screen_group_id");
    await expectAdminError("POST", "/api/admin/campaign-proposals", proposalInput({
      ...records,
      screenGroupId: records.otherStoreScreenGroupId
    }, {
      campaign_proposal_id: `cpr-${runId}-scope-mismatch`
    }), 403, "store scope");

    const access = await admin("POST", `/api/admin/tenants/${records.tenantId}/customer-access-token`, {
      role: "customer_editor",
      store_ids: [records.storeId],
      pin: "2468",
      notes: "ai campaign proposal smoke"
    });
    const login = await rawRequest("POST", access.data.customer_admin_url + "/session", { pin: "2468" });
    const cookie = login.headers.get("set-cookie");
    if (!cookie) throw new Error("customer login did not return a session cookie");
    const customerScreenGroups = await request("GET", "/api/customer/screen-groups", null, { cookie });
    const customerScreenGroupIds = customerScreenGroups.data.screen_groups.map((group) => group.screen_group_id);
    if (!customerScreenGroupIds.includes(records.screenGroupId) || customerScreenGroupIds.includes(records.otherStoreScreenGroupId)) {
      throw new Error(`customer screen group list is not store-scoped: ${JSON.stringify(customerScreenGroupIds)}`);
    }

    const scoped = await request("GET", `/api/customer/campaign-proposals?month=2026-07&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`, null, { cookie });
    const scopedIds = scoped.data.campaign_proposals.map((proposal) => proposal.campaign_proposal_id);
    if (!scopedIds.includes(`cpr-${runId}-primary`) || !scopedIds.includes(`cpr-${runId}-reject`) || !scopedIds.includes(`cpr-${runId}-reject-empty`)) {
      throw new Error(`scoped proposals missing expected ids: ${JSON.stringify(scopedIds)}`);
    }
    if (scopedIds.includes(`cpr-${runId}-other-sg`) || scopedIds.includes(`cpr-${runId}-other-store`) || scopedIds.includes(`cpr-${runId}-foreign`)) {
      throw new Error(`scoped proposals leaked another scope: ${JSON.stringify(scopedIds)}`);
    }
    await expectError("GET", `/api/customer/campaign-proposals?month=2026-07&store_id=${records.storeId}`, null, { cookie }, 400, "screen_group_id");
    await expectError("GET", `/api/customer/campaign-proposals?month=2026-07&store_id=${records.otherStoreId}&screen_group_id=${records.otherStoreScreenGroupId}`, null, { cookie }, 403, "scope");

    const selected = await request("PATCH", `/api/customer/campaign-proposals/cpr-${runId}-primary/status`, {
      status: "selected"
    }, { cookie });
    if (selected.data.campaign_proposal.status !== "selected" || !selected.data.campaign_proposal.campaign_brief_id) {
      throw new Error(`selected proposal did not create brief stub: ${selected.text}`);
    }
    const rejected = await request("PATCH", `/api/customer/campaign-proposals/cpr-${runId}-reject/status`, {
      status: "rejected",
      rejected_reason: "夏休み企画と重なる"
    }, { cookie });
    if (rejected.data.campaign_proposal.status !== "rejected" || rejected.data.campaign_proposal.rejected_reason !== "夏休み企画と重なる") {
      throw new Error(`rejected reason was not persisted: ${rejected.text}`);
    }
    const rejectedWithoutReason = await request("PATCH", `/api/customer/campaign-proposals/cpr-${runId}-reject-empty/status`, {
      status: "rejected"
    }, { cookie });
    if (rejectedWithoutReason.data.campaign_proposal.status !== "rejected" || rejectedWithoutReason.data.campaign_proposal.rejected_reason !== "") {
      throw new Error(`rejected without reason should be accepted with empty reason: ${rejectedWithoutReason.text}`);
    }
    await expectError("PATCH", `/api/customer/campaign-proposals/cpr-${runId}-other-store/status`, {
      status: "held"
    }, { cookie }, 403, "scope");

    const afterContentManifestCount = tableCount("content_manifests");
    if (afterContentManifestCount !== beforeContentManifestCount) {
      throw new Error(`content_manifest was created unexpectedly: before=${beforeContentManifestCount} after=${afterContentManifestCount}`);
    }

    const runs = db().prepare("SELECT * FROM proposal_generation_runs").all();
    if (runs.length < 4 || runs.some((run) => run.external_ai_used !== 0 || run.external_ai_provider)) {
      throw new Error(`proposal generation runs should be local stub only: ${JSON.stringify(runs)}`);
    }
    const contextItems = db().prepare("SELECT * FROM customer_context_items").all();
    const allowedContextCategories = new Set(["customer_profile", "internal_notes", "market_signal", "operation_summary", "proposal_feedback", "asset_source", "collaboration_signal"]);
    const allowedVisibilityScopes = new Set(["customer_visible", "operator_internal", "system_internal", "partner_limited"]);
    const allowedSourceOwners = new Set(["customer", "misell_operator", "system", "partner", "external_reference"]);
    const allowedSourceTypes = new Set(["operator_input", "customer_input", "imported"]);
    const allowedConfidence = new Set(["customer_confirmed", "operator_confirmed", "operator_observed", "market_reference", "system_aggregated", "inferred", "stale", "expired"]);
    for (const item of contextItems) {
      if (!item.store_id || !item.screen_group_id) throw new Error(`context item missing required screen scope: ${JSON.stringify(item)}`);
      if (!item.context_category || !item.visibility_scope || !item.source_owner || !item.source_type || !item.confidence) {
        throw new Error(`context item missing classification fields: ${JSON.stringify(item)}`);
      }
      if (!allowedContextCategories.has(item.context_category) || !allowedVisibilityScopes.has(item.visibility_scope) || !allowedSourceOwners.has(item.source_owner) || !allowedSourceTypes.has(item.source_type) || !allowedConfidence.has(item.confidence)) {
        throw new Error(`context item has an unexpected classification enum value: ${JSON.stringify(item)}`);
      }
    }
    if (tableCount("campaign_proposal_events") < 5) throw new Error("campaign proposal event history is missing");
    if (tableCount("campaign_briefs") !== 1) throw new Error("selected proposal should create exactly one campaign brief stub");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      tenant_store_screen_group_isolation: true,
      status_transition: true,
      screen_group_required: true,
      context_classification: true,
      legacy_context_category_rejected: true,
      rejected_reason_optional: true,
      rejected_reason_persisted_when_supplied: true,
      immutable_context_snapshot: true,
      no_external_ai: true,
      no_content_manifest_creation: true,
      campaign_brief_stub: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-AICP-${runId}`,
    otherTenantId: `TEN-AICP-OTHER-${runId}`,
    storeId: `STO-AICP-${runId}`,
    otherStoreId: `STO-AICP-OTHER-${runId}`,
    foreignStoreId: `STO-AICP-FOREIGN-${runId}`,
    screenGroupId: `SG-AICP-${runId}`,
    otherScreenGroupId: `SG-AICP-ALT-${runId}`,
    otherStoreScreenGroupId: `SG-AICP-OTHER-STORE-${runId}`,
    foreignScreenGroupId: `SG-AICP-FOREIGN-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-AICP-${runId}`);
  await seedDevice(records.tenantId, records.storeId, records.otherScreenGroupId, `DEV-AICP-ALT-${runId}`);
  await seedDevice(records.tenantId, records.otherStoreId, records.otherStoreScreenGroupId, `DEV-AICP-OTHER-${runId}`);
  await seedDevice(records.otherTenantId, records.foreignStoreId, records.foreignScreenGroupId, `DEV-AICP-FOREIGN-${runId}`);
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
    confidence: "customer_confirmed",
    item_type: "industry_profile",
    item_key: "industry",
    value: { industry: "karaoke", audience: "weekday families" }
  }));
  await admin("POST", "/api/admin/customer-context-items", contextInput(records, {
    context_category: "market_signal",
    source_owner: "external_reference",
    source_type: "imported",
    confidence: "market_reference",
    item_type: "seasonal_calendar",
    item_key: "2026-07",
    value: { theme: "summer rain", local_event: "station festival" }
  }));
  await admin("POST", "/api/admin/customer-context-items", contextInput(records, {
    context_category: "customer_profile",
    source_owner: "customer",
    source_type: "customer_input",
    confidence: "customer_confirmed",
    item_type: "brand_tone",
    item_key: "tone",
    value: { tone: "friendly", ng_words: ["guaranteed results"] }
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
    qr_flow: "館内クーポンQR",
    recommended_time_slots: ["11:00-15:00"],
    expected_effect: "QR反応の改善仮説",
    required_assets: ["logo", "rainy-day-photo"],
    status: "proposed",
    ...overrides
  };
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-ai-campaign-proposals-"));
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
