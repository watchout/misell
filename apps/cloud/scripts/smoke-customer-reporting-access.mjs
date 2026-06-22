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
    const records = await seedCustomerData();

    const firstScan = await request("GET", `/q/${records.qrToken}?visit_id=VISIT-CUST-${runId}&test_now=2026-06-10T12:31:00%2B09:00`);
    const orderOne = await request("POST", `/q/${records.qrToken}/orders`, {
      qr_scan_id: firstScan.data.qr_scan.qr_scan_id,
      visit_id: `VISIT-CUST-${runId}`,
      test_now: "2026-06-10T12:32:00+09:00"
    });
    await request("POST", `/q/${records.qrToken}/orders`, {
      qr_scan_id: firstScan.data.qr_scan.qr_scan_id,
      visit_id: `VISIT-CUST-${runId}`,
      test_now: "2026-06-10T12:32:10+09:00"
    });
    await expectError("POST", `/q/${records.qrToken}/orders`, {
      qr_scan_id: firstScan.data.qr_scan.qr_scan_id,
      visit_id: `VISIT-CUST-${runId}`,
      test_now: "2026-06-10T12:32:20+09:00"
    }, {}, 429, "rate limit");

    await request("GET", `/q/${records.qrToken}?visit_id=VISIT-CUST-${runId}&test_now=2026-06-10T12:31:10%2B09:00`);
    await expectError("GET", `/q/${records.qrToken}?visit_id=VISIT-CUST-${runId}&test_now=2026-06-10T12:31:20%2B09:00`, null, {}, 429, "rate limit");

    await request("GET", `/order/${orderOne.data.order_token}`);
    await request("GET", `/api/public/orders/${orderOne.data.order_token}`);
    await expectError("GET", `/order/${orderOne.data.order_token}`, null, {}, 429, "rate limit");

    await admin("PATCH", `/api/admin/counter-orders/${orderOne.data.counter_order.counter_order_id}/status`, {
      status: "redeemed",
      actor_id: "customer-smoke"
    });

    const viewerAccess = await admin("POST", `/api/admin/tenants/${records.tenantId}/customer-access-token`, {
      role: "customer_viewer",
      store_ids: [records.storeId],
      pin: "2468",
      notes: "customer reporting smoke viewer"
    });
    assertNoCustomerSecretExposure(viewerAccess.text, ["2468"]);
    if (viewerAccess.data.customer_token) {
      throw new Error(`raw customer token was exposed: ${viewerAccess.text}`);
    }
    if (!viewerAccess.data.customer_access_token?.customer_access_token_id || !viewerAccess.data.customer_admin_url) {
      throw new Error("customer access URL was not returned");
    }
    if (!viewerAccess.data.customer_admin_url.endsWith(`/${viewerAccess.data.customer_access_token.customer_access_token_id}`)) {
      throw new Error(`customer URL should use public access id, not a raw secret: ${viewerAccess.data.customer_admin_url}`);
    }

    const customerPage = await fetch(`${baseUrl}${viewerAccess.data.customer_admin_url}`, {
      headers: { accept: "text/html" }
    });
    const customerHtml = await customerPage.text();
    if (!customerPage.ok || !customerHtml.includes("customer-admin.js") || !customerHtml.includes("顧客PIN")) {
      throw new Error(`customer admin HTML did not render: ${customerPage.status} ${customerHtml.slice(0, 200)}`);
    }
    assertNoCustomerSecretExposure(customerHtml, ["2468"]);
    if (customerHtml.includes("MISELL_CUSTOMER_TOKEN")) {
      throw new Error("customer HTML still bootstraps the raw token variable");
    }

    await expectError("POST", `${viewerAccess.data.customer_admin_url}/session`, { pin: "0000" }, {}, 401, "PIN");
    const viewerLogin = await rawRequest("POST", `${viewerAccess.data.customer_admin_url}/session`, { pin: "2468" });
    const viewerCookie = viewerLogin.headers.get("set-cookie");
    if (!viewerCookie || viewerLogin.data.session?.role !== "customer_viewer") {
      throw new Error(`customer viewer login failed: ${viewerLogin.text}`);
    }
    assertNoCustomerSecretExposure(viewerLogin.text, ["2468"]);
    if (viewerLogin.data.session?.session_token) {
      throw new Error(`raw customer session token was exposed in JSON: ${viewerLogin.text}`);
    }

    const report = await request("GET", `/api/customer/reports/conversion?month=2026-06&store_id=${encodeURIComponent(records.storeId)}`, null, { cookie: viewerCookie });
    const kpis = report.data.report.kpis;
    if (kpis.qr_scan_count !== 2 || kpis.counter_orders_issued_count !== 2 || kpis.counter_orders_redeemed_count !== 1) {
      throw new Error(`customer KPI mismatch: ${JSON.stringify(kpis)}`);
    }
    if (kpis.scan_to_order_rate !== 1 || kpis.order_to_redeem_rate !== 0.5) {
      throw new Error(`customer funnel rate mismatch: ${JSON.stringify(kpis)}`);
    }
    if (!String(kpis.amount_wording?.potential_sales_amount || "").includes("POS")) {
      throw new Error("customer amount wording did not preserve non-POS language");
    }

    const orders = await request("GET", `/api/customer/counter-orders?store_id=${encodeURIComponent(records.storeId)}`, null, { cookie: viewerCookie });
    if (orders.data.counter_orders.length !== 2) throw new Error(`expected 2 customer orders, got ${orders.data.counter_orders.length}`);
    if (orders.data.counter_orders.some((order) => order.store_id !== records.storeId)) {
      throw new Error("customer order list leaked another store");
    }

    await expectError("GET", `/api/customer/reports/conversion?month=2026-06&store_id=${encodeURIComponent(records.otherStoreId)}`, null, { cookie: viewerCookie }, 403, "scope");
    await expectError("POST", `/api/customer/offers/${records.offerId}/revisions`, {
      title: "Viewer should not edit"
    }, { cookie: viewerCookie }, 403, "edit");

    const editorAccess = await admin("POST", `/api/admin/tenants/${records.tenantId}/customer-access-token`, {
      role: "customer_editor",
      store_ids: [records.storeId],
      pin: "1357",
      notes: "customer reporting smoke editor"
    });
    assertNoCustomerSecretExposure(editorAccess.text, ["1357"]);
    const editorLogin = await rawRequest("POST", `${editorAccess.data.customer_admin_url}/session`, { pin: "1357" });
    const editorCookie = editorLogin.headers.get("set-cookie");
    assertNoCustomerSecretExposure(editorLogin.text, ["1357"]);
    if (editorLogin.data.session?.session_token) {
      throw new Error(`raw editor session token was exposed in JSON: ${editorLogin.text}`);
    }
    const revision = await request("POST", `/api/customer/offers/${records.offerId}/revisions`, {
      status: "active",
      title: "Customer edited offer",
      pickup_location: "front counter",
      pickup_available_from: "11:00",
      pickup_available_until: "21:00",
      max_orders_per_day: 12
    }, { cookie: editorCookie });
    if (revision.data.offer_revision.revision_number < 2 || revision.data.offer_revision.title !== "Customer edited offer") {
      throw new Error(`customer offer revision was not created: ${JSON.stringify(revision.data.offer_revision)}`);
    }

    if (tableCount("public_rate_limit_events", "decision = 'reject'") < 3) throw new Error("public rate limit rejection evidence missing");
    if (auditActionCount("public_rate_limit.reject") < 3) throw new Error("public rate limit audit missing");
    if (auditActionCount("customer.login_failed") < 1) throw new Error("customer failed login audit missing");
    if (auditActionCount("customer.login_success") < 2) throw new Error("customer successful login audit missing");
    if (auditActionCount("offer_revision.customer_create") < 1) throw new Error("customer offer revision audit missing");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      public_rate_limit: true,
      customer_kpi_dashboard: true,
      customer_scope_guard: true,
      customer_offer_revision: true,
      customer_secret_non_exposure: true,
      scan_to_order_rate: kpis.scan_to_order_rate,
      order_to_redeem_rate: kpis.order_to_redeem_rate
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedCustomerData() {
  const tenantId = `TEN-CUST-${runId}`;
  const storeId = `STO-CUST-${runId}`;
  const otherStoreId = `STO-CUST-OTHER-${runId}`;
  const locationId = `LOC-CUST-${runId}`;
  const screenGroupId = `SG-CUST-${runId}`;
  const deviceId = `DEV-CUST-${runId}`;
  const itemId = `ITEM-CUST-${runId}`;
  const contentId = `CONTENT-CUST-${runId}`;

  await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: "Customer Smoke Tenant",
    store_id: storeId,
    store_name: "Customer Smoke Store",
    location_id: locationId,
    location_name: "Main",
    screen_group_id: screenGroupId,
    screen_group_name: "Front",
    device_id: deviceId,
    device_name: "Customer Smoke Player",
    release_channel: "stable"
  });
  await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: "Customer Smoke Tenant",
    store_id: otherStoreId,
    store_name: "Other Customer Store",
    location_id: `LOC-CUST-OTHER-${runId}`,
    location_name: "Other",
    screen_group_id: `SG-CUST-OTHER-${runId}`,
    screen_group_name: "Other Front",
    device_id: `DEV-CUST-OTHER-${runId}`,
    device_name: "Other Player",
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
    item_name: "Customer coffee voucher",
    default_unit_price: 500,
    currency: "JPY",
    tax_included: true
  });
  const offer = await admin("POST", "/api/admin/offers", {
    store_id: storeId,
    status: "active",
    revision: {
      title: "Customer counter set",
      status: "active",
      pickup_location: "counter",
      max_orders_total: 20,
      max_orders_per_day: 20,
      max_orders_per_visit: 10,
      items: [{ item_id: itemId, quantity: 1 }]
    }
  });
  const qr = await admin("POST", "/api/admin/qr-links", {
    label: "Customer QR",
    destination_type: "counter_order_offer",
    offer_id: offer.data.offer.offer_id,
    screen_group_id: screenGroupId,
    content_id: contentId
  });

  return {
    tenantId,
    storeId,
    otherStoreId,
    offerId: offer.data.offer.offer_id,
    qrToken: qr.data.qr_link.qr_token
  };
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-cloud-customer-reporting."));
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
      MISELL_CLOUD_DATA_DIR: tmpDir,
      DB_PATH: dbPath,
      DEVICE_TOKEN_PEPPER: "customer-reporting-smoke-pepper",
      MISELL_PUBLIC_QR_VIEW_LIMIT_PER_MINUTE: "2",
      MISELL_PUBLIC_ORDER_CREATE_LIMIT_PER_MINUTE: "2",
      MISELL_PUBLIC_ORDER_VIEW_LIMIT_PER_MINUTE: "2",
      MISELL_PUBLIC_RATE_LIMIT_WINDOW_SECONDS: "60"
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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for customer reporting smoke server");
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
  return { status: response.status, data, text, headers: response.headers };
}

async function rawRequest(method, requestPath, body, headers = {}) {
  return request(method, requestPath, body, headers);
}

async function admin(method, requestPath, body) {
  return request(method, requestPath, body, { authorization: adminAuth });
}

async function expectError(method, requestPath, body, headers, expectedStatus, expectedText) {
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
  if (response.status !== expectedStatus || !text.toLowerCase().includes(String(expectedText).toLowerCase())) {
    throw new Error(`${method} ${requestPath} expected ${expectedStatus}/${expectedText}, got ${response.status}: ${text}`);
  }
}

function tableCount(table, where = "1 = 1", params = []) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params).count;
  } finally {
    db.close();
  }
}

function auditActionCount(action) {
  return tableCount("audit_logs", "action = ?", [action]);
}

function assertNoCustomerSecretExposure(text, rawSecrets = []) {
  const forbidden = [
    "customer_token",
    "token_hash",
    "pin_hash",
    "session_token",
    "MISELL_CUSTOMER_TOKEN",
    ...rawSecrets
  ];
  const lowerText = String(text || "").toLowerCase();
  for (const value of forbidden) {
    if (!value) continue;
    if (lowerText.includes(String(value).toLowerCase())) {
      throw new Error(`customer secret material was exposed: ${value}`);
    }
  }
}
