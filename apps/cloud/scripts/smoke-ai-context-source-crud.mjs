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
    const internal = await admin("POST", "/api/admin/customer-context-items", contextInput(records, {
      customer_context_item_id: `cci-${runId}-internal`,
      context_category: "internal_notes",
      visibility_scope: "operator_internal",
      source_owner: "misell_operator",
      source_type: "operator_input",
      confidence: "operator_confirmed",
      item_type: "operator_note",
      item_key: "margin-note",
      value: { text: "operator only" }
    }));

    const editorCookie = await loginCustomer(records, "customer_editor", "2468");
    const viewerCookie = await loginCustomer(records, "customer_viewer", "1357");

    await expectError("POST", "/api/customer/context-items", {
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      context_category: "market_signal",
      item_key: "viewer-denied",
      value: { text: "viewer should not edit" }
    }, { cookie: viewerCookie }, 403, "edit");

    const created = await request("POST", "/api/customer/context-items", {
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      context_category: "market_signal",
      item_type: "customer_note",
      item_key: `rain-market-${runId}`,
      value: { text: "雨の日は近隣イベント客の滞在訴求を強めたい" }
    }, { cookie: editorCookie });
    const item = created.data.customer_context_item;
    if (item.visibility_scope !== "customer_visible" || item.source_owner !== "customer" || item.source_type !== "customer_input") {
      throw new Error(`customer context defaults are unsafe: ${created.text}`);
    }

    const listed = await request("GET", `/api/customer/context-items?store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`, null, { cookie: editorCookie });
    const listedIds = listed.data.customer_context_items.map((entry) => entry.customer_context_item_id);
    if (!listedIds.includes(item.customer_context_item_id)) throw new Error(`customer context item was not listed: ${listed.text}`);
    if (listedIds.includes(internal.data.customer_context_item.customer_context_item_id)) {
      throw new Error("operator_internal context leaked to customer list");
    }
    await expectError("GET", `/api/customer/context-items?store_id=${records.otherStoreId}&screen_group_id=${records.otherScreenGroupId}`, null, { cookie: editorCookie }, 403, "scope");

    const updated = await request("PATCH", `/api/customer/context-items/${item.customer_context_item_id}`, {
      context_category: "operation_summary",
      value: { text: "雨天時は受付横の導線を優先して案内する" }
    }, { cookie: editorCookie });
    if (updated.data.customer_context_item.context_category !== "operation_summary") {
      throw new Error(`customer context edit did not persist: ${updated.text}`);
    }

    const samplePdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const pdfUpload = await uploadSource(`/api/customer/context-items/${item.customer_context_item_id}/source-assets`, "market.pdf", "application/pdf", samplePdfBytes, editorCookie, {
      usage_notes: "市場資料。要約は顧客入力のみ。"
    });
    const sourceAsset = pdfUpload.data.customer_context_source_asset;
    if (sourceAsset.storage_path || sourceAsset.download_path) throw new Error(`source asset leaked storage/download path: ${pdfUpload.text}`);
    if (!sourceAsset.view_path || sourceAsset.extraction_status !== "manual_no_ai" || sourceAsset.external_ai_used !== false) {
      throw new Error(`source asset contract is wrong: ${pdfUpload.text}`);
    }

    const view = await rawRequest("GET", sourceAsset.view_path, null, { cookie: editorCookie });
    if (!view.response.ok) throw new Error(`source asset view failed: ${view.response.status} ${view.text}`);
    if (!String(view.headers.get("content-type") || "").includes("application/pdf")) throw new Error("source asset view did not preserve PDF content type");
    if (!String(view.headers.get("content-disposition") || "").startsWith("inline")) throw new Error("source asset view must be inline, not attachment");

    const scopeSyncCreated = await request("POST", "/api/customer/context-items", {
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      context_category: "market_signal",
      item_type: "customer_note",
      item_key: `scope-sync-${runId}`,
      value: { text: "公開前提で登録したが、後から社内用へ変更する" }
    }, { cookie: editorCookie });
    const scopeSyncItem = scopeSyncCreated.data.customer_context_item;
    const scopeSyncUpload = await uploadSource(`/api/customer/context-items/${scopeSyncItem.customer_context_item_id}/source-assets`, "scope-sync.pdf", "application/pdf", samplePdfBytes, editorCookie, {
      usage_notes: "親contextのscope変更時に同期されるべき資料。"
    });
    const scopeSyncAsset = scopeSyncUpload.data.customer_context_source_asset;
    const internalized = await admin("PATCH", `/api/admin/customer-context-items/${scopeSyncItem.customer_context_item_id}`, {
      context_category: "internal_notes",
      visibility_scope: "operator_internal",
      source_owner: "misell_operator",
      source_type: "operator_input",
      confidence: "operator_confirmed",
      value: { text: "社内用に切り替えたcontext" }
    });
    const internalizedAsset = internalized.data.customer_context_item.source_assets.find((asset) => {
      return asset.customer_context_source_asset_id === scopeSyncAsset.customer_context_source_asset_id;
    });
    if (!internalizedAsset || internalizedAsset.visibility_scope !== "operator_internal" || internalizedAsset.source_owner !== "misell_operator") {
      throw new Error(`source asset scope did not sync with parent item: ${internalized.text}`);
    }
    const syncedAssetRow = db().prepare(`
      SELECT visibility_scope, source_owner
      FROM customer_context_source_assets
      WHERE customer_context_source_asset_id = ?
    `).get(scopeSyncAsset.customer_context_source_asset_id);
    if (syncedAssetRow.visibility_scope !== "operator_internal" || syncedAssetRow.source_owner !== "misell_operator") {
      throw new Error(`source asset DB row kept stale customer visibility: ${JSON.stringify(syncedAssetRow)}`);
    }
    await expectError("GET", scopeSyncAsset.view_path, null, { cookie: editorCookie }, 403, "visible");
    const afterScopeSyncList = await request("GET", `/api/customer/context-items?store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`, null, { cookie: editorCookie });
    if (afterScopeSyncList.data.customer_context_items.some((entry) => entry.customer_context_item_id === scopeSyncItem.customer_context_item_id)) {
      throw new Error("internalized context item remained in customer list after source asset scope sync");
    }

    const txtReject = await uploadSource(`/api/customer/context-items/${item.customer_context_item_id}/source-assets`, "notes.txt", "text/plain", Buffer.from("plain text"), editorCookie, {
      usage_notes: "should reject"
    }, { expectOk: false });
    if (txtReject.response.status !== 400 || !txtReject.text.includes("extension")) {
      throw new Error(`text upload should be rejected by contract: ${txtReject.response.status} ${txtReject.text}`);
    }

    const extractionReject = await uploadSource(`/api/customer/context-items/${item.customer_context_item_id}/source-assets`, "processed.pdf", "application/pdf", samplePdfBytes, editorCookie, {
      usage_notes: "should reject automatic processing state",
      extraction_status: "completed"
    }, { expectOk: false });
    if (extractionReject.response.status !== 400 || !extractionReject.text.includes("manual_no_ai")) {
      throw new Error(`automatic extraction status should be rejected: ${extractionReject.response.status} ${extractionReject.text}`);
    }

    const proposal = await admin("POST", "/api/admin/campaign-proposals", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      proposal_month: "2026-08",
      title: "雨天導線提案",
      objective: "雨天来店客の滞在導線を強める",
      status: "proposed"
    });
    const snapshot = db().prepare("SELECT * FROM customer_context_snapshots WHERE customer_context_snapshot_id = ?").get(proposal.data.campaign_proposal.context_snapshot_id);
    const snapshotJson = JSON.parse(snapshot.snapshot_json);
    const snapshotItem = snapshotJson.items.find((entry) => entry.customer_context_item_id === item.customer_context_item_id);
    if (!snapshotItem || !Array.isArray(snapshotItem.source_assets) || snapshotItem.source_assets.length !== 1) {
      throw new Error(`snapshot did not include source asset summary: ${snapshot.snapshot_json}`);
    }
    if (JSON.stringify(snapshotItem).includes("storage_path")) throw new Error("snapshot leaked source asset storage path");

    const deletedAsset = await request("DELETE", `/api/customer/context-source-assets/${sourceAsset.customer_context_source_asset_id}`, null, { cookie: editorCookie });
    if (deletedAsset.data.customer_context_source_asset.status !== "deleted" || !deletedAsset.data.customer_context_source_asset.deleted_at) {
      throw new Error(`source asset soft delete did not persist: ${deletedAsset.text}`);
    }
    await expectError("GET", sourceAsset.view_path, null, { cookie: editorCookie }, 404, "not found");

    const deletedItem = await request("DELETE", `/api/customer/context-items/${item.customer_context_item_id}`, null, { cookie: editorCookie });
    if (deletedItem.data.customer_context_item.status !== "deleted" || !deletedItem.data.customer_context_item.deleted_at) {
      throw new Error(`context item soft delete did not persist: ${deletedItem.text}`);
    }
    const afterDelete = await request("GET", `/api/customer/context-items?store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`, null, { cookie: editorCookie });
    if (afterDelete.data.customer_context_items.some((entry) => entry.customer_context_item_id === item.customer_context_item_id)) {
      throw new Error("deleted context item remained in active customer list");
    }

    const dbAssets = db().prepare("SELECT * FROM customer_context_source_assets").all();
    if (dbAssets.some((asset) => asset.external_ai_used !== 0 || asset.extraction_status !== "manual_no_ai")) {
      throw new Error(`source assets must stay manual/no-AI: ${JSON.stringify(dbAssets)}`);
    }
    if (tableCount("content_manifests") !== 0) throw new Error("context CRUD must not create content manifests");
    if (tableCount("campaign_proposals") !== 1) throw new Error("context CRUD smoke should create exactly one proposal for snapshot evidence");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      customer_context_crud: true,
      customer_editor_required: true,
      operator_internal_hidden: true,
      scope_guard: true,
      pdf_upload_view_inline: true,
      forbidden_file_rejected: true,
      no_download_path_exposed: true,
      source_asset_scope_sync: true,
      automatic_extraction_rejected: true,
      soft_delete_context_and_asset: true,
      snapshot_source_asset_summary: true,
      no_external_ai: true,
      no_content_manifest_creation: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-AICR-${runId}`,
    storeId: `STO-AICR-${runId}`,
    otherStoreId: `STO-AICR-OTHER-${runId}`,
    screenGroupId: `SG-AICR-${runId}`,
    otherScreenGroupId: `SG-AICR-OTHER-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-AICR-${runId}`);
  await seedDevice(records.tenantId, records.otherStoreId, records.otherScreenGroupId, `DEV-AICR-OTHER-${runId}`);
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

async function loginCustomer(records, role, pin) {
  const access = await admin("POST", `/api/admin/tenants/${records.tenantId}/customer-access-token`, {
    role,
    store_ids: [records.storeId],
    pin,
    notes: `ai context crud ${role}`
  });
  const login = await rawRequest("POST", access.data.customer_admin_url + "/session", { pin });
  const cookie = login.headers.get("set-cookie");
  if (!cookie) throw new Error(`customer login did not return cookie for ${role}`);
  return cookie;
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-ai-context-crud-"));
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
      MISELL_CUSTOMER_CONTEXT_SOURCE_DIR: path.join(tmpDir, "context-sources"),
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

async function uploadSource(url, filename, mimeType, bytes, cookie, fields = {}, options = {}) {
  const body = new FormData();
  body.append("source", new Blob([bytes], { type: mimeType }), filename);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  const result = await rawRequest("POST", url, body, { cookie });
  if (options.expectOk === false) return result;
  if (!result.response.ok) throw new Error(`POST ${url} returned ${result.response.status}: ${result.text}`);
  return result;
}

async function request(method, url, body = null, headers = {}) {
  const result = await rawRequest(method, url, body, headers);
  if (!result.response.ok) {
    throw new Error(`${method} ${url} returned ${result.response.status}: ${result.text}`);
  }
  return result;
}

async function rawRequest(method, url, body = null, headers = {}) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body && !isForm ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
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
