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
    const primary = await seedCounterOrder("PRIMARY");
    const secondary = await seedCounterOrder("OTHER");

    const jsonLookup = await request("GET", `/order/${primary.order_token}`);
    if (jsonLookup.data.counter_order.counter_order_id !== primary.counter_order.counter_order_id) {
      throw new Error("JSON order lookup broke existing /order/:token contract");
    }

    const htmlResponse = await fetch(`${baseUrl}/order/${primary.order_token}`, {
      headers: { accept: "text/html" }
    });
    const html = await htmlResponse.text();
    if (!htmlResponse.ok || !html.includes("受付番号を発行しました") || !html.includes("order-card.js")) {
      throw new Error(`order card HTML did not render: ${htmlResponse.status} ${html.slice(0, 200)}`);
    }
    for (const requiredText of ["単価", "小計", "引換場所", "引換時間", "有効期限", "500円", "counter", "10:00 - 22:00", "画像プレビュー", "長押し"]) {
      if (!html.includes(requiredText)) {
        throw new Error(`order card HTML missing required snapshot/fallback text: ${requiredText}`);
      }
    }
    const forcedFallback = await fetch(`${baseUrl}/order/${primary.order_token}?force_image_fallback=1`, {
      headers: { accept: "text/html" }
    });
    const forcedFallbackHtml = await forcedFallback.text();
    if (!forcedFallbackHtml.includes("window.MISELL_FORCE_IMAGE_FALLBACK = true")) {
      throw new Error("forced image fallback path was not reachable from order page HTML");
    }

    const publicOrder = await request("GET", `/api/public/orders/${primary.order_token}`);
    if (publicOrder.data.counter_order.store.store_id !== primary.store_id) {
      throw new Error("public order payload did not include scoped store profile");
    }
    const publicCounterOrder = publicOrder.data.counter_order;
    if (publicCounterOrder.items[0]?.unit_price_snapshot !== 500 || publicCounterOrder.items[0]?.subtotal_amount !== 500) {
      throw new Error("public order payload did not include item price/subtotal snapshot");
    }
    if (
      publicCounterOrder.receipt_snapshot?.pickup_location !== "counter" ||
      publicCounterOrder.receipt_snapshot?.pickup_window !== "10:00 - 22:00" ||
      publicCounterOrder.receipt_snapshot?.valid_until !== "2030-01-01T00:00:00.000Z"
    ) {
      throw new Error(`public order payload did not include resolved receipt snapshot: ${JSON.stringify(publicCounterOrder.receipt_snapshot)}`);
    }
    const orderCardJs = await fetch(`${baseUrl}/order-card.js`).then((response) => response.text());
    if (!orderCardJs.includes("showImagePreviewFallback") || !orderCardJs.includes("shouldShowImagePreviewFallback")) {
      throw new Error("order card JS does not expose the image preview fallback path");
    }
    await request("POST", `/api/public/orders/${primary.order_token}/events`, {
      event_name: "preview_image",
      user_action: "smoke"
    });
    if (tableCount("order_page_events", "counter_order_id = ?", [primary.counter_order.counter_order_id]) !== 1) {
      throw new Error("order page event was not recorded");
    }

    const access = await admin("POST", `/api/admin/stores/${primary.store_id}/access-token`, {
      pin: "1234",
      notes: "counter order UX smoke"
    });
    if (!access.data.store_token || !access.data.store_orders_url) {
      throw new Error("store access token was not returned once");
    }
    const staffPage = await fetch(`${baseUrl}${access.data.store_orders_url}`, {
      headers: { accept: "text/html" }
    });
    const staffHtml = await staffPage.text();
    if (!staffPage.ok || !staffHtml.includes("store-orders.js") || !staffHtml.includes("スタッフPIN")) {
      throw new Error(`store orders HTML did not render: ${staffPage.status} ${staffHtml.slice(0, 200)}`);
    }

    await expectError("POST", `${access.data.store_orders_url}/session`, { pin: "9999" }, {}, 401, "PIN");
    const login = await rawRequest("POST", `${access.data.store_orders_url}/session`, { pin: "1234" });
    const cookie = login.headers.get("set-cookie");
    if (!cookie || !login.data.session?.store_staff_session_id) {
      throw new Error(`store staff login did not return a session cookie: ${login.text}`);
    }

    const session = await request("GET", "/api/store/orders/session", null, { cookie });
    if (session.data.store.store_id !== primary.store_id) throw new Error("store staff session scope mismatch");

    const orders = await request("GET", "/api/store/orders?status=issued", null, { cookie });
    if (!orders.data.counter_orders.some((order) => order.counter_order_id === primary.counter_order.counter_order_id)) {
      throw new Error("store order list did not include issued order for its store");
    }
    if (orders.data.counter_orders.some((order) => order.counter_order_id === secondary.counter_order.counter_order_id)) {
      throw new Error("store order list leaked another store order");
    }

    await expectError(
      "PATCH",
      `/api/store/orders/${primary.counter_order.counter_order_id}/status`,
      { status: "redeemed", verify_code: "0000" },
      { cookie },
      403,
      "verify_code"
    );
    const redeemed = await request("PATCH", `/api/store/orders/${primary.counter_order.counter_order_id}/status`, {
      status: "redeemed",
      verify_code: primary.counter_order.verify_code
    }, { cookie });
    if (redeemed.data.counter_order.status !== "redeemed") throw new Error("staff redeem did not update order status");

    const reopened = await request("PATCH", `/api/store/orders/${primary.counter_order.counter_order_id}/status`, {
      status: "issued",
      reason: "smoke reopen"
    }, { cookie });
    if (reopened.data.counter_order.status !== "issued") throw new Error("staff reopen did not update order status");

    await expectError(
      "PATCH",
      `/api/store/orders/${secondary.counter_order.counter_order_id}/status`,
      { status: "cancelled", reason: "wrong store" },
      { cookie },
      403,
      "outside this store"
    );

    const cancelled = await request("PATCH", `/api/store/orders/${primary.counter_order.counter_order_id}/status`, {
      status: "cancelled",
      reason: "customer cancelled in smoke"
    }, { cookie });
    if (cancelled.data.counter_order.status !== "cancelled") throw new Error("staff cancel did not update order status");

    const tokens = await admin("GET", `/api/admin/store-access-tokens?store_id=${encodeURIComponent(primary.store_id)}`);
    if (!tokens.data.store_access_tokens.some((token) => token.store_access_token_id === access.data.store_access_token.store_access_token_id)) {
      throw new Error("admin store access token list did not include created token");
    }

    if (auditActionCount("store_staff.login_failed") < 1) throw new Error("store staff failed login audit missing");
    if (auditActionCount("store_staff.login_success") < 1) throw new Error("store staff successful login audit missing");
    if (auditActionCount("counter_order.staff_status_update") < 3) throw new Error("store staff order update audit missing");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      order_html: true,
      order_snapshot_card: true,
      iphone_image_fallback: true,
      order_json_compatible: true,
      order_page_event: true,
      store_staff_login: true,
      store_scope_guard: true,
      verify_code_guard: true,
      counter_order_id: primary.counter_order.counter_order_id,
      store_access_token_id: access.data.store_access_token.store_access_token_id
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedCounterOrder(suffix) {
  const tenantId = `TEN-COUX-${suffix}-${runId}`;
  const storeId = `STO-COUX-${suffix}-${runId}`;
  const locationId = `LOC-COUX-${suffix}-${runId}`;
  const screenGroupId = `SG-COUX-${suffix}-${runId}`;
  const deviceId = `DEV-COUX-${suffix}-${runId}`;
  const itemId = `ITEM-COUX-${suffix}-${runId}`;

  await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: "Counter UX Tenant",
    store_id: storeId,
    store_name: `Counter UX Store ${suffix}`,
    location_id: locationId,
    location_name: "Main",
    screen_group_id: screenGroupId,
    screen_group_name: "Front",
    device_id: deviceId,
    device_name: "Counter UX Player",
    release_channel: "stable"
  });
  await admin("PUT", `/api/admin/stores/${storeId}/settings`, {
    timezone: "Asia/Tokyo",
    business_day_start_time: "05:00",
    order_issue_cutoff_time: "23:30",
    pickup_available_from: "10:00",
    pickup_available_until: "22:00",
    currency: "JPY",
    tax_included: true
  });
  await admin("POST", "/api/admin/items", {
    item_id: itemId,
    tenant_id: tenantId,
    item_name: `Counter UX voucher ${suffix}`,
    default_unit_price: 500,
    currency: "JPY",
    tax_included: true
  });
  const offer = await admin("POST", "/api/admin/offers", {
    store_id: storeId,
    status: "active",
    revision: {
      title: `Counter UX set ${suffix}`,
      status: "active",
      pickup_location: "counter",
      valid_until: "2030-01-01T00:00:00.000Z",
      order_issue_cutoff_time: "23:30",
      max_orders_total: 10,
      max_orders_per_day: 10,
      max_orders_per_visit: 1,
      items: [{ item_id: itemId, quantity: 1 }]
    }
  });
  const qr = await admin("POST", "/api/admin/qr-links", {
    label: `Counter UX QR ${suffix}`,
    destination_type: "counter_order_offer",
    offer_id: offer.data.offer.offer_id,
    screen_group_id: screenGroupId,
    content_id: `CONTENT-COUX-${suffix}-${runId}`
  });
  const scan = await request("GET", `/q/${qr.data.qr_link.qr_token}?visit_id=VISIT-COUX-${suffix}-${runId}`);
  const order = await request("POST", `/q/${qr.data.qr_link.qr_token}/orders`, {
    qr_scan_id: scan.data.qr_scan.qr_scan_id
  });
  return {
    tenant_id: tenantId,
    store_id: storeId,
    counter_order: order.data.counter_order,
    order_token: order.data.order_token
  };
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-cloud-counter-order-ux."));
  dbPath = path.join(tmpDir, "misell-cloud.sqlite");
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
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
      MISELL_CLOUD_ADMIN_ROLE: "misell_operator",
      MISELL_CLOUD_DATA_DIR: tmpDir,
      DB_PATH: dbPath,
      DEVICE_TOKEN_PEPPER: `counter-order-ux-${runId}-pepper`,
      MISELL_STORE_ACCESS_TOKEN_PEPPER: `counter-order-ux-store-${runId}-pepper`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await request("GET", "/api/health");
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("Timed out waiting for counter order UX smoke server");
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
  dbPath = "";
  baseUrl = "";
}

async function admin(method, requestPath, body) {
  return request(method, requestPath, body, { authorization: adminAuth });
}

async function request(method, requestPath, body, headers = {}) {
  const result = await rawRequest(method, requestPath, body, headers);
  if (!result.response.ok) {
    throw new Error(`${method} ${requestPath} -> ${result.response.status}: ${result.text}`);
  }
  return { status: result.response.status, data: result.data, text: result.text, headers: result.headers };
}

async function rawRequest(method, requestPath, body, headers = {}) {
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
  return { response, status: response.status, data, text, headers: response.headers };
}

async function expectError(method, requestPath, body, headers, expectedStatus, expectedText) {
  const response = await rawRequest(method, requestPath, body, headers);
  if (response.status !== expectedStatus || !response.text.includes(expectedText)) {
    throw new Error(`${method} ${requestPath} expected ${expectedStatus}/${expectedText}, got ${response.status}: ${response.text}`);
  }
}

function tableCount(tableName, whereSql = "1 = 1", params = []) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${safeSqlIdentifier(tableName)} WHERE ${whereSql}`).get(...params).count;
  } finally {
    db.close();
  }
}

function auditActionCount(action) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = ?").get(action).count;
  } finally {
    db.close();
  }
}

function safeSqlIdentifier(value) {
  const text = String(value || "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) throw new Error(`unsafe SQL identifier: ${text}`);
  return text;
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
