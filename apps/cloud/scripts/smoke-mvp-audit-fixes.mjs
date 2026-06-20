import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const adminAuth = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`;
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

let baseUrl = process.env.BASE_URL || "";
let serverProcess = null;
let tmpDir = "";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startServerIfNeeded() {
  if (baseUrl) return;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-cloud-audit-fixes."));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      APP_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      ADMIN_USER: adminUser,
      ADMIN_PASSWORD: adminPassword,
      REQUIRE_ADMIN_AUTH: "1",
      MISELL_CLOUD_DATA_DIR: tmpDir,
      DB_PATH: path.join(tmpDir, "misell-cloud.sqlite"),
      DEVICE_TOKEN_PEPPER: "audit-fix-smoke-pepper"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0 && code !== 143) {
      process.stderr.write(`misell-cloud exited with ${code}\n`);
    }
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await request("GET", "/api/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for smoke server");
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

async function request(method, requestPath, body, headers = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${requestPath} -> ${response.status}: ${text}`);
  }
  return { status: response.status, data, text };
}

async function admin(method, requestPath, body) {
  return request(method, requestPath, body, { authorization: adminAuth });
}

async function expectPublicError(method, requestPath, body, expectedStatus, expectedText) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (response.status !== expectedStatus || !text.includes(expectedText)) {
    throw new Error(`${method} ${requestPath} expected ${expectedStatus}/${expectedText}, got ${response.status}: ${text}`);
  }
}

async function setupBaseRecords() {
  const tenantId = `TEN-AUDIT-${runId}`;
  const storeId = `STO-AUDIT-${runId}`;
  const deviceId = `DEV-AUDIT-${runId}`;
  const itemId = `ITEM-AUDIT-${runId}`;

  const device = await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: "Audit Tenant",
    store_id: storeId,
    store_name: "Audit Store",
    location_id: `LOC-AUDIT-${runId}`,
    location_name: "Main",
    screen_group_id: `SG-AUDIT-${runId}`,
    screen_group_name: "Front",
    device_id: deviceId,
    device_name: "Audit Player",
    release_channel: "stable"
  });
  await admin("PUT", `/api/admin/stores/${storeId}/settings`, {
    timezone: "Asia/Tokyo",
    business_day_start_time: "05:00",
    order_issue_cutoff_time: "02:00",
    currency: "JPY",
    tax_included: true
  });
  await admin("POST", "/api/admin/items", {
    item_id: itemId,
    tenant_id: tenantId,
    item_name: "Audit coffee voucher",
    default_unit_price: 500,
    currency: "JPY",
    tax_included: true
  });
  const offer = await admin("POST", "/api/admin/offers", {
    store_id: storeId,
    status: "active",
    revision: {
      title: "Audit counter set r1",
      status: "active",
      order_issue_cutoff_time: "02:00",
      max_orders_total: 20,
      max_orders_per_day: 20,
      items: [{ item_id: itemId, quantity: 1 }]
    }
  });
  const qr = await admin("POST", "/api/admin/qr-links", {
    label: "Audit dynamic QR",
    destination_type: "counter_order_offer",
    offer_id: offer.data.offer.offer_id,
    screen_group_id: `SG-AUDIT-${runId}`,
    content_id: `CONTENT-AUDIT-${runId}`
  });
  if (qr.data.qr_link.revision_binding !== "current_offer_revision" || qr.data.qr_link.offer_revision_id) {
    throw new Error(`QR link was not created as a dynamic revision link: ${JSON.stringify(qr.data.qr_link)}`);
  }
  return {
    tenantId,
    storeId,
    deviceId,
    deviceToken: device.data.device_token,
    itemId,
    offerId: offer.data.offer.offer_id,
    firstRevisionId: offer.data.offer.current_offer_revision_id,
    qrToken: qr.data.qr_link.qr_token
  };
}

async function testBusinessDayCutoff(records) {
  const evening = await request("POST", `/q/${records.qrToken}/orders`, {
    visit_id: `VISIT-EVENING-${runId}`,
    test_now: "2026-06-19T23:30:00+09:00"
  });
  if (evening.data.counter_order.business_date !== "2026-06-19") {
    throw new Error(`evening business_date mismatch: ${evening.data.counter_order.business_date}`);
  }

  const afterMidnight = await request("POST", `/q/${records.qrToken}/orders`, {
    visit_id: `VISIT-AFTER-MIDNIGHT-${runId}`,
    test_now: "2026-06-20T00:30:00+09:00"
  });
  if (afterMidnight.data.counter_order.business_date !== "2026-06-19") {
    throw new Error(`after-midnight business_date mismatch: ${afterMidnight.data.counter_order.business_date}`);
  }

  await expectPublicError("POST", `/q/${records.qrToken}/orders`, {
    visit_id: `VISIT-CUTOFF-${runId}`,
    test_now: "2026-06-20T02:01:00+09:00"
  }, 409, "cutoff time has passed");
}

async function testLegacyPlaylog(records) {
  const legacyPayload = {
    device_id: records.deviceId,
    timestamp: "2026-06-19T10:00:00+09:00",
    playlist_version: `pl-audit-${runId}`,
    playlist_item_id: "legacy-item",
    campaign_id: "legacy-campaign",
    asset_id: "legacy-asset",
    layout: "wide",
    duration: 10,
    result: "started"
  };
  const first = await request("POST", "/api/device/playlog", legacyPayload, {
    authorization: `Bearer ${records.deviceToken}`
  });
  const duplicate = await request("POST", "/api/device/playlog", legacyPayload, {
    authorization: `Bearer ${records.deviceToken}`
  });
  if (first.status !== 201 || first.data.event_id_generated !== true || !String(first.data.event_id).startsWith("legacy-")) {
    throw new Error(`legacy playlog was not accepted with generated event_id: ${JSON.stringify(first.data)}`);
  }
  if (duplicate.status !== 200 || duplicate.data.duplicate !== true || duplicate.data.event_id !== first.data.event_id) {
    throw new Error(`legacy playlog idempotency failed: ${JSON.stringify(duplicate.data)}`);
  }

  const noTimestamp = await request("POST", "/api/device/playlog", {
    device_id: records.deviceId,
    playlist_item_id: "legacy-no-timestamp",
    result: "started"
  }, {
    authorization: `Bearer ${records.deviceToken}`
  });
  const noTimestampDuplicate = await request("POST", "/api/device/playlog", {
    device_id: records.deviceId,
    playlist_item_id: "legacy-no-timestamp",
    result: "started"
  }, {
    authorization: `Bearer ${records.deviceToken}`
  });
  if (noTimestamp.status !== 201 || noTimestamp.data.event_id_generated !== true) {
    throw new Error(`timestamp-less legacy playlog was not accepted: ${JSON.stringify(noTimestamp.data)}`);
  }
  if (noTimestampDuplicate.status !== 200 || noTimestampDuplicate.data.duplicate !== true || noTimestampDuplicate.data.event_id !== noTimestamp.data.event_id) {
    throw new Error(`timestamp-less legacy playlog idempotency failed: ${JSON.stringify(noTimestampDuplicate.data)}`);
  }
}

async function testDynamicQrRevision(records) {
  const secondRevision = await admin("POST", `/api/admin/offers/${records.offerId}/revisions`, {
    title: "Audit counter set r2",
    status: "active",
    order_issue_cutoff_time: "02:00",
    max_orders_total: 20,
    max_orders_per_day: 20,
    items: [{ item_id: records.itemId, quantity: 2 }]
  });
  const secondRevisionId = secondRevision.data.offer_revision.offer_revision_id;
  if (!secondRevisionId || secondRevisionId === records.firstRevisionId) {
    throw new Error("second offer revision was not created");
  }

  const page = await request("GET", `/q/${records.qrToken}?visit_id=VISIT-R2-${runId}`);
  if (page.data.offer_revision.offer_revision_id !== secondRevisionId) {
    throw new Error(`dynamic QR did not resolve current revision: ${page.data.offer_revision.offer_revision_id}`);
  }

  const order = await request("POST", `/q/${records.qrToken}/orders`, {
    qr_scan_id: page.data.qr_scan.qr_scan_id,
    test_now: "2026-06-20T00:45:00+09:00"
  });
  if (order.data.counter_order.offer_revision_id !== secondRevisionId) {
    throw new Error(`dynamic QR order used wrong revision: ${order.data.counter_order.offer_revision_id}`);
  }
}

try {
  await startServerIfNeeded();
  const records = await setupBaseRecords();
  await testBusinessDayCutoff(records);
  await testLegacyPlaylog(records);
  await testDynamicQrRevision(records);
  console.log(JSON.stringify({
    ok: true,
    base_url: baseUrl,
    business_day_cutoff: true,
    legacy_playlog_compat: true,
    dynamic_qr_revision_switch: true
  }, null, 2));
} finally {
  await stopServer();
}
