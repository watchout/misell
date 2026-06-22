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

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  process.exit(1);
});

async function main() {
  await startServerIfNeeded();
  try {
    const records = await seedReportData();
    const criteria = {
      month: "2026-06",
      tenant_id: records.tenantId,
      store_id: records.storeId,
      content_id: records.contentId
    };

    const live = await admin("GET", `/api/admin/reports/summary?${new URLSearchParams(criteria)}`);
    assertTotals(live.data.report.totals, {
      play_started_count: 1,
      play_completed_count: 1,
      qr_scan_count: 1,
      counter_orders_issued_count: 1,
      counter_orders_redeemed_count: 1,
      error_count: 1,
      heartbeat_count: 1
    }, "live summary");
    if (live.data.report.daily.length !== 30) throw new Error(`expected 30 daily rows, got ${live.data.report.daily.length}`);
    assertBusinessDayBucket(live.data.report, "live summary");
    await assertFilterIsolation(criteria);

    const rebuilt = await admin("POST", "/api/admin/reports/read-model/rebuild", criteria);
    if (rebuilt.data.rebuilt !== 30) throw new Error(`expected 30 rebuilt rows, got ${rebuilt.data.rebuilt}`);
    assertTotals(rebuilt.data.report.totals, {
      play_started_count: 1,
      play_completed_count: 1,
      qr_scan_count: 1,
      counter_orders_issued_count: 1,
      counter_orders_redeemed_count: 1,
      error_count: 1,
      heartbeat_count: 1
    }, "rebuilt summary");
    assertBusinessDayBucket(rebuilt.data.report, "rebuilt summary");

    const rebuiltAgain = await admin("POST", "/api/admin/reports/read-model/rebuild", criteria);
    if (rebuiltAgain.data.rebuilt !== 30) throw new Error(`expected 30 rows after idempotent rebuild, got ${rebuiltAgain.data.rebuilt}`);
    assertTotals(rebuiltAgain.data.report.totals, {
      play_started_count: 1,
      play_completed_count: 1,
      qr_scan_count: 1,
      counter_orders_issued_count: 1,
      counter_orders_redeemed_count: 1,
      error_count: 1,
      heartbeat_count: 1
    }, "second rebuilt summary");

    const persisted = await admin("GET", `/api/admin/reports/daily-metrics?${new URLSearchParams(criteria)}`);
    if (persisted.data.metrics.length !== 30) throw new Error(`expected 30 persisted metrics, got ${persisted.data.metrics.length}`);

    const snapshot = await admin("POST", "/api/admin/reports/monthly-snapshots", {
      ...criteria,
      status: "published",
      title: "Smoke monthly report",
      created_by: "smoke"
    });
    const reportSnapshot = snapshot.data.report_snapshot;
    if (!reportSnapshot.snapshot_id || reportSnapshot.status !== "published") {
      throw new Error(`snapshot create failed: ${JSON.stringify(reportSnapshot)}`);
    }
    assertTotals(reportSnapshot.summary.totals, {
      play_started_count: 1,
      play_completed_count: 1,
      qr_scan_count: 1,
      counter_orders_issued_count: 1,
      counter_orders_redeemed_count: 1,
      error_count: 1,
      heartbeat_count: 1
    }, "snapshot summary");
    assertBusinessDayBucket(reportSnapshot.summary, "snapshot summary");

    await expectAdminError("POST", "/api/admin/reports/monthly-snapshots", criteria, 409, "already exists");
    const replaced = await admin("POST", "/api/admin/reports/monthly-snapshots", {
      ...criteria,
      status: "published",
      title: "Smoke monthly report",
      created_by: "smoke",
      replace: true
    });
    if (replaced.data.report_snapshot.snapshot_id !== reportSnapshot.snapshot_id) {
      throw new Error("snapshot replace changed snapshot_id");
    }
    if (replaced.data.report_snapshot.metrics_sha256 !== reportSnapshot.metrics_sha256) {
      throw new Error("snapshot metrics_sha256 changed for identical data replace");
    }

    const detail = await admin("GET", `/api/admin/reports/monthly-snapshots/${reportSnapshot.snapshot_id}`);
    if (detail.data.report_snapshot.metrics_sha256 !== replaced.data.report_snapshot.metrics_sha256) {
      throw new Error("snapshot detail hash mismatch");
    }

    const list = await admin("GET", `/api/admin/reports/monthly-snapshots?${new URLSearchParams(criteria)}`);
    if (!list.data.report_snapshots.some((item) => item.snapshot_id === reportSnapshot.snapshot_id)) {
      throw new Error("snapshot list did not include created snapshot");
    }

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      read_model_rows: rebuilt.data.rebuilt,
      snapshot_id: reportSnapshot.snapshot_id,
      metrics_sha256: reportSnapshot.metrics_sha256,
      business_day_bucket: "2026-06-09",
      idempotent_rebuild: true,
      stable_snapshot_hash: true,
      totals: reportSnapshot.summary.totals
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedReportData() {
  const tenantId = `TEN-REPORT-${runId}`;
  const storeId = `STO-REPORT-${runId}`;
  const locationId = `LOC-REPORT-${runId}`;
  const screenGroupId = `SG-REPORT-${runId}`;
  const deviceId = `DEV-REPORT-${runId}`;
  const itemId = `ITEM-REPORT-${runId}`;
  const contentId = `CONTENT-REPORT-${runId}`;

  const device = await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: "Report Tenant",
    store_id: storeId,
    store_name: "Report Store",
    location_id: locationId,
    location_name: "Main",
    screen_group_id: screenGroupId,
    screen_group_name: "Front",
    device_id: deviceId,
    device_name: "Report Player",
    release_channel: "stable"
  });
  await admin("PUT", `/api/admin/stores/${storeId}/settings`, {
    timezone: "Asia/Tokyo",
    business_day_start_time: "05:00",
    order_issue_cutoff_time: "04:00",
    currency: "JPY",
    tax_included: true
  });
  await admin("POST", "/api/admin/items", {
    item_id: itemId,
    tenant_id: tenantId,
    item_name: "Report coffee voucher",
    default_unit_price: 500,
    currency: "JPY",
    tax_included: true
  });
  const offer = await admin("POST", "/api/admin/offers", {
    store_id: storeId,
    campaign_id: "",
    status: "active",
    revision: {
      title: "Report counter set",
      status: "active",
      max_orders_total: 20,
      max_orders_per_day: 20,
      max_orders_per_visit: 2,
      items: [{ item_id: itemId, quantity: 1 }]
    }
  });
  const qr = await admin("POST", "/api/admin/qr-links", {
    label: "Report QR",
    destination_type: "counter_order_offer",
    offer_id: offer.data.offer.offer_id,
    screen_group_id: screenGroupId,
    content_id: contentId
  });

  await request("POST", "/api/device/heartbeat", {
    device_id: deviceId,
    test_now: "2026-06-10T03:30:00+09:00",
    timestamp: "2026-06-10T03:30:00+09:00",
    ok: true,
    app_version: "report-smoke",
    playlist_version: "pl-report"
  }, {
    authorization: `Bearer ${device.data.device_token}`
  });

  await request("POST", "/api/device/playlog", {
    device_id: deviceId,
    event_id: `EVT-REPORT-START-${runId}`,
    event_type: "playback_started",
    timestamp: "2026-06-10T03:30:00+09:00",
    playlist_version: "pl-report",
    playlist_item_id: "slot-report",
    content_id: contentId,
    asset_id: "asset-report",
    layout: "wide",
    duration: 15,
    result: "started"
  }, {
    authorization: `Bearer ${device.data.device_token}`
  });
  await request("POST", "/api/device/playlog", {
    device_id: deviceId,
    event_id: `EVT-REPORT-COMPLETE-${runId}`,
    event_type: "playback_completed",
    timestamp: "2026-06-10T03:30:15+09:00",
    playlist_version: "pl-report",
    playlist_item_id: "slot-report",
    content_id: contentId,
    asset_id: "asset-report",
    layout: "wide",
    duration: 15,
    result: "completed"
  }, {
    authorization: `Bearer ${device.data.device_token}`
  });

  const scan = await request("GET", `/q/${qr.data.qr_link.qr_token}?${new URLSearchParams({
    visit_id: `VISIT-REPORT-${runId}`,
    test_now: "2026-06-10T03:31:00+09:00"
  })}`);
  const order = await request("POST", `/q/${qr.data.qr_link.qr_token}/orders`, {
    qr_scan_id: scan.data.qr_scan.qr_scan_id,
    visit_id: `VISIT-REPORT-${runId}`,
    test_now: "2026-06-10T03:32:00+09:00"
  });
  await admin("PATCH", `/api/admin/counter-orders/${order.data.counter_order.counter_order_id}/status`, {
    status: "redeemed",
    actor_id: "smoke"
  });

  const errorPayload = {
    device_id: deviceId,
    event_id: `ERR-REPORT-${runId}`,
    event_type: "device_error",
    timestamp: "2026-06-10T03:33:00+09:00",
    severity: "error",
    message: "Report smoke error"
  };
  const errorFirst = await request("POST", "/api/device/error", errorPayload, {
    authorization: `Bearer ${device.data.device_token}`
  });
  const errorDuplicate = await request("POST", "/api/device/error", errorPayload, {
    authorization: `Bearer ${device.data.device_token}`
  });
  if (errorFirst.status !== 201 || errorDuplicate.status !== 200 || errorDuplicate.data.duplicate !== true) {
    throw new Error(`error log idempotency failed: ${JSON.stringify({ first: errorFirst.data, duplicate: errorDuplicate.data })}`);
  }

  return { tenantId, storeId, contentId };
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

async function startServerIfNeeded() {
  if (baseUrl) return;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-cloud-reporting."));
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
      DEVICE_TOKEN_PEPPER: "reporting-smoke-pepper"
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
  throw new Error("Timed out waiting for reporting smoke server");
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

async function expectAdminError(method, requestPath, body, expectedStatus, expectedText) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      authorization: adminAuth,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (response.status !== expectedStatus || !text.includes(expectedText)) {
    throw new Error(`${method} ${requestPath} expected ${expectedStatus}/${expectedText}, got ${response.status}: ${text}`);
  }
}

function assertTotals(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) {
      throw new Error(`${label} ${key} expected ${value}, got ${actual?.[key]} in ${JSON.stringify(actual)}`);
    }
  }
}

function assertBusinessDayBucket(report, label) {
  const june9 = report.daily.find((row) => row.date === "2026-06-09");
  const june10 = report.daily.find((row) => row.date === "2026-06-10");
  if (!june9 || !june10) throw new Error(`${label} did not include expected daily rows`);
  assertTotals(june9, {
    play_started_count: 1,
    play_completed_count: 1,
    qr_scan_count: 1,
    counter_orders_issued_count: 1,
    counter_orders_redeemed_count: 1,
    error_count: 1,
    heartbeat_count: 1
  }, `${label} 2026-06-09 business-day bucket`);
  assertTotals(june10, {
    play_started_count: 0,
    play_completed_count: 0,
    qr_scan_count: 0,
    counter_orders_issued_count: 0,
    counter_orders_redeemed_count: 0,
    error_count: 0,
    heartbeat_count: 0
  }, `${label} 2026-06-10 zero bucket`);
}

async function assertFilterIsolation(criteria) {
  const wrongStore = await admin("GET", `/api/admin/reports/summary?${new URLSearchParams({
    ...criteria,
    store_id: `STO-NO-MATCH-${runId}`
  })}`);
  assertTotals(wrongStore.data.report.totals, {
    play_started_count: 0,
    qr_scan_count: 0,
    counter_orders_issued_count: 0,
    error_count: 0,
    heartbeat_count: 0
  }, "wrong store filtered summary");

  const wrongTenant = await admin("GET", `/api/admin/reports/summary?${new URLSearchParams({
    ...criteria,
    tenant_id: `TEN-NO-MATCH-${runId}`
  })}`);
  assertTotals(wrongTenant.data.report.totals, {
    play_started_count: 0,
    qr_scan_count: 0,
    counter_orders_issued_count: 0,
    error_count: 0,
    heartbeat_count: 0
  }, "wrong tenant filtered summary");
}
