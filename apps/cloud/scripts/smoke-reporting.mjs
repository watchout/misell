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

let baseUrl = process.env.BASE_URL || "";
let serverProcess = null;
let tmpDir = "";
let dbPath = "";

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
    assertAdMeasurement(live.data.report, records, "live summary");
    await assertFilterIsolation(criteria);
    await assertAdMeasurementFilters(criteria, records);
    await assertAdvertiserReportPreview({ ...criteria, campaign_id: records.campaignId }, records);

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
    assertAdMeasurement(rebuilt.data.report, records, "rebuilt summary");

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
    assertAdMeasurement(reportSnapshot.summary, records, "snapshot summary");

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

    const manifests = await admin("GET", "/api/admin/content-manifests");
    if ((manifests.data.content_manifests || []).length !== 0) {
      throw new Error(`reporting smoke should not create content manifests: ${JSON.stringify(manifests.data.content_manifests)}`);
    }
    await assertContentFreshness(records);
    await assertAdInventoryReadModel(records);

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      read_model_rows: rebuilt.data.rebuilt,
      snapshot_id: reportSnapshot.snapshot_id,
      metrics_sha256: reportSnapshot.metrics_sha256,
      business_day_bucket: "2026-06-09",
      idempotent_rebuild: true,
      stable_snapshot_hash: true,
      ad_measurement: true,
      content_freshness: true,
      advertiser_report_preview: true,
      ad_inventory_read_model: true,
      no_content_manifest_creation: true,
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
  const campaignId = `CAMPAIGN-REPORT-${runId}`;
  const adSlotId = `AD-SLOT-REPORT-${runId}`;
  const creativeId = `CREATIVE-REPORT-${runId}`;
  const manifestHash = `sha256:report-${runId}`;

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
    campaign_id: campaignId,
    content_id: contentId,
    item_type: "ad",
    ad_slot_id: adSlotId,
    creative_id: creativeId,
    qr_link_id: qr.data.qr_link.qr_link_id,
    manifest_hash: manifestHash,
    asset_id: "asset-report",
    layout: "wide",
    duration: 15,
    planned_duration_seconds: 15,
    played_duration_seconds: 15,
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
    campaign_id: campaignId,
    content_id: contentId,
    item_type: "ad",
    ad_slot_id: adSlotId,
    creative_id: creativeId,
    qr_link_id: qr.data.qr_link.qr_link_id,
    manifest_hash: manifestHash,
    asset_id: "asset-report",
    layout: "wide",
    duration: 15,
    planned_duration_seconds: 15,
    played_duration_seconds: 15,
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

  return {
    tenantId,
    storeId,
    screenGroupId,
    campaignId,
    contentId,
    adSlotId,
    creativeId,
    qrLinkId: qr.data.qr_link.qr_link_id,
    manifestHash
  };
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
  dbPath = path.join(tmpDir, "misell-cloud.sqlite");
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
      DB_PATH: dbPath,
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

async function assertAdMeasurementFilters(criteria, records) {
  const filtered = await admin("GET", `/api/admin/reports/summary?${new URLSearchParams({
    ...criteria,
    ad_slot_id: records.adSlotId
  })}`);
  assertAdMeasurement(filtered.data.report, records, "ad-slot filtered summary");

  const missing = await admin("GET", `/api/admin/reports/summary?${new URLSearchParams({
    ...criteria,
    ad_slot_id: `AD-SLOT-NO-MATCH-${runId}`
  })}`);
  assertTotals(missing.data.report.totals, {
    play_started_count: 0,
    play_completed_count: 0,
    qr_scan_count: 0
  }, "missing ad-slot filtered summary");
  if ((missing.data.report.ad_measurement || []).length !== 0) {
    throw new Error(`missing ad-slot filter returned ad_measurement rows: ${JSON.stringify(missing.data.report.ad_measurement)}`);
  }

  await expectAdminError("GET", `/api/admin/reports/daily-metrics?${new URLSearchParams({
    ...criteria,
    ad_slot_id: records.adSlotId
  })}`, null, 400, "ad-granular filters");
}

async function assertContentFreshness(records) {
  const freshContentId = records.contentId;
  const staleContentId = `CONTENT-STALE-${runId}`;
  await admin("POST", "/api/admin/content-manifests", contentManifestPayload({
    content_id: freshContentId,
    playlist_version: `pl-fresh-${runId}`,
    release_channel: "stable",
    status: "active",
    title: "Fresh report campaign",
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    campaign_id: records.campaignId,
    ad_slot_id: records.adSlotId,
    creative_id: records.creativeId,
    qr_link_id: records.qrLinkId,
    content_layer: "campaign_refresh"
  }));
  await admin("POST", "/api/admin/content-manifests", contentManifestPayload({
    content_id: staleContentId,
    playlist_version: `pl-stale-${runId}`,
    release_channel: "canary",
    status: "active",
    title: "Stale static campaign",
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    campaign_id: `CAMPAIGN-STALE-${runId}`,
    ad_slot_id: `AD-SLOT-STALE-${runId}`,
    creative_id: `CREATIVE-STALE-${runId}`,
    qr_link_id: "",
    content_layer: ""
  }));
  const fixtureDb = new Database(dbPath);
  try {
    fixtureDb.prepare("UPDATE content_manifests SET updated_at = ?, published_at = ? WHERE content_id = ?")
      .run("2026-06-18T00:00:00.000Z", "2026-06-18T00:00:00.000Z", freshContentId);
    fixtureDb.prepare("UPDATE content_manifests SET updated_at = ?, published_at = ? WHERE content_id = ?")
      .run("2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z", staleContentId);
    fixtureDb.prepare(`
      INSERT INTO playlogs (
        device_id, tenant_id, store_id, screen_group_id, received_at,
        content_id, event_type, result, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `DEV-ALIEN-${runId}`,
      `TEN-ALIEN-${runId}`,
      `STO-ALIEN-${runId}`,
      records.screenGroupId,
      "2026-06-19T00:00:00.000Z",
      freshContentId,
      "playback_started",
      "started",
      JSON.stringify({ smoke: "content-freshness-scope-guard" })
    );
  } finally {
    fixtureDb.close();
  }

  const freshness = await admin("GET", `/api/admin/reports/content-freshness?${new URLSearchParams({
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    test_now: "2026-06-20T00:00:00.000Z"
  })}`);
  const report = freshness.data.report;
  if (report.thresholds.review_due_days !== 14 || report.thresholds.stale_days !== 30) {
    throw new Error(`unexpected freshness thresholds: ${JSON.stringify(report.thresholds)}`);
  }
  if (report.summary.total !== 2 || report.summary.fresh !== 1 || report.summary.stale !== 1 || report.summary.not_played !== 1) {
    throw new Error(`unexpected freshness summary: ${JSON.stringify(report.summary)}`);
  }
  const fresh = report.content.find((item) => item.content_id === freshContentId);
  const stale = report.content.find((item) => item.content_id === staleContentId);
  if (!fresh || fresh.freshness_status !== "fresh" || fresh.play_signal_status !== "played" || fresh.playlog_count !== 2 || fresh.playlist.ad_item_count !== 1 || fresh.playlist.campaign_refresh_count !== 1) {
    throw new Error(`fresh content row mismatch: ${JSON.stringify(fresh)}`);
  }
  if (!stale || stale.freshness_status !== "stale" || !stale.stale_reasons.includes("unchanged_over_stale_threshold") || !stale.stale_reasons.includes("no_play_signal")) {
    throw new Error(`stale content row mismatch: ${JSON.stringify(stale)}`);
  }
  const wrongTenant = await admin("GET", `/api/admin/reports/content-freshness?${new URLSearchParams({
    tenant_id: `TEN-NO-MATCH-${runId}`,
    test_now: "2026-06-20T00:00:00.000Z"
  })}`);
  if (wrongTenant.data.report.summary.total !== 0) {
    throw new Error(`content freshness tenant isolation failed: ${JSON.stringify(wrongTenant.data.report)}`);
  }
}

function contentManifestPayload(input) {
  return {
    content_id: input.content_id,
    playlist_version: input.playlist_version,
    release_channel: input.release_channel,
    status: input.status,
    title: input.title,
    tenant_id: input.tenant_id,
    store_id: input.store_id,
    screen_group_id: input.screen_group_id,
    playlist: {
      playlist_version: input.playlist_version,
      items: [
        {
          id: `${input.content_id}-ad`,
          item_type: "ad",
          type: "ad",
          content_id: input.content_id,
          campaign_id: input.campaign_id,
          ad_slot_id: input.ad_slot_id,
          creative_id: input.creative_id,
          qr_link_id: input.qr_link_id,
          content_layer: input.content_layer,
          layout: "wide",
          duration: 15,
          wide: "/demo/karaoke-product.mp4"
        },
        {
          id: `${input.content_id}-always-on`,
          item_type: "content",
          type: "content",
          content_id: input.content_id,
          content_layer: "always_on",
          layout: "wide",
          duration: 10,
          wide: "/demo/hotel-guide.mp4"
        }
      ]
    },
    assets: []
  };
}

async function assertAdvertiserReportPreview(criteria, records) {
  const preview = await admin("GET", `/api/admin/reports/advertiser-preview?${new URLSearchParams(criteria)}`);
  const report = preview.data.report;
  if (report.report_type !== "advertiser_campaign_preview" || report.surface !== "admin_internal_preview") {
    throw new Error(`unexpected advertiser preview identity: ${JSON.stringify({ report_type: report.report_type, surface: report.surface })}`);
  }
  if (report.measurement_policy.proof_of_play !== "measured" || report.measurement_policy.roas_guarantee !== "not_reported" || report.measurement_policy.incremental_lift !== "not_reported") {
    throw new Error(`advertiser preview measurement policy mismatch: ${JSON.stringify(report.measurement_policy)}`);
  }
  assertTotals(report.proof_of_play, {
    play_started_count: 1,
    play_completed_count: 1,
    play_failed_count: 0,
    play_duration_seconds: 30
  }, "advertiser preview proof of play");
  assertTotals(report.response, { qr_scan_count: 1 }, "advertiser preview response");
  assertTotals(report.conversion, {
    counter_orders_issued_count: 1,
    counter_orders_redeemed_count: 1,
    counter_order_total_amount: 500,
    counter_order_redeemed_amount: 500
  }, "advertiser preview conversion");
  if (report.proof_of_play.measurement_label !== "measured" || report.response.measurement_label !== "measured" || report.conversion.measurement_label !== "measured") {
    throw new Error("advertiser preview metric labels must be measured");
  }
  if (report.proof_of_play.completion_rate !== 1 || report.response.qr_scans_per_play_started !== 1 || report.conversion.order_to_redeem_rate !== 1) {
    throw new Error(`advertiser preview rates mismatch: ${JSON.stringify({ proof: report.proof_of_play, response: report.response, conversion: report.conversion })}`);
  }
  const adGroup = report.breakdowns.ad_measurement.find((item) =>
    item.campaign_id === records.campaignId &&
    item.ad_slot_id === records.adSlotId &&
    item.creative_id === records.creativeId &&
    item.qr_link_id === records.qrLinkId
  );
  if (!adGroup || adGroup.measurement_label !== "measured" || adGroup.play_started_count !== 1 || adGroup.qr_scan_count !== 1) {
    throw new Error(`advertiser preview ad breakdown mismatch: ${JSON.stringify(report.breakdowns.ad_measurement)}`);
  }
  if (!Array.isArray(report.decision_prompts) || !report.decision_prompts.some((item) => item.decision_key === "continue_with_refresh_hypothesis")) {
    throw new Error(`advertiser preview decision prompts mismatch: ${JSON.stringify(report.decision_prompts)}`);
  }
  if (JSON.stringify(report).includes("incremental_roi") || JSON.stringify(report).includes("guaranteed_outcome")) {
    throw new Error("advertiser preview must not expose incremental ROI or guaranteed outcome claims");
  }

  const filtered = await admin("GET", `/api/admin/reports/advertiser-preview?${new URLSearchParams({
    ...criteria,
    ad_slot_id: records.adSlotId,
    creative_id: records.creativeId,
    qr_link_id: records.qrLinkId
  })}`);
  if (filtered.data.report.breakdowns.ad_measurement.length !== 1 || filtered.data.report.proof_of_play.play_started_count !== 1) {
    throw new Error(`advertiser preview filtered report mismatch: ${JSON.stringify(filtered.data.report)}`);
  }
  const wrongStore = await admin("GET", `/api/admin/reports/advertiser-preview?${new URLSearchParams({
    ...criteria,
    store_id: `STO-NO-MATCH-${runId}`
  })}`);
  if (wrongStore.data.report.proof_of_play.play_started_count !== 0 || wrongStore.data.report.response.qr_scan_count !== 0) {
    throw new Error(`advertiser preview store isolation failed: ${JSON.stringify(wrongStore.data.report)}`);
  }
  await expectAdminError("GET", `/api/admin/reports/advertiser-preview?${new URLSearchParams({
    ...criteria,
    tenant_id: ""
  })}`, null, 400, "tenant_id is required");
  await expectAdminError("GET", `/api/admin/reports/advertiser-preview?${new URLSearchParams({
    ...criteria,
    campaign_id: ""
  })}`, null, 400, "campaign_id is required");
}

async function assertAdInventoryReadModel(records) {
  const before = await admin("GET", "/api/admin/content-manifests");
  const beforeCount = (before.data.content_manifests || []).length;
  const criteria = {
    month: "2026-06",
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId
  };
  const inventory = await admin("GET", `/api/admin/reports/ad-inventory?${new URLSearchParams(criteria)}`);
  const report = inventory.data.report;
  if (report.report_type !== "ad_inventory" || report.surface !== "admin_internal_read_model") {
    throw new Error(`unexpected ad inventory identity: ${JSON.stringify({ report_type: report.report_type, surface: report.surface })}`);
  }
  if (report.measurement_policy.inventory !== "manifest_derived" || report.measurement_policy.proof_of_play !== "measured" || report.measurement_policy.ad_revenue !== "not_reported" || report.measurement_policy.roas_guarantee !== "not_reported") {
    throw new Error(`ad inventory measurement policy mismatch: ${JSON.stringify(report.measurement_policy)}`);
  }
  assertTotals(report.summary, {
    manifest_count: 2,
    slot_position_count: 2,
    sellable_slot_count: 2,
    filled_slot_count: 2,
    empty_slot_count: 0,
    unclassified_position_count: 0,
    active_campaign_count: 2,
    creative_count: 2,
    qr_link_count: 1
  }, "ad inventory summary");
  if (report.summary.fill_rate !== 1 || report.summary.position_fill_rate !== 1) {
    throw new Error(`ad inventory fill rate mismatch: ${JSON.stringify(report.summary)}`);
  }
  assertTotals(report.summary.measured, {
    play_event_count: 2,
    play_started_count: 1,
    play_completed_count: 1,
    play_failed_count: 0,
    played_duration_seconds: 30,
    qr_scan_count: 1
  }, "ad inventory measured summary");
  const slot = report.slots.find((item) => item.ad_slot_id === records.adSlotId);
  if (!slot || slot.inventory_label !== "manifest_derived" || slot.measurement_label !== "measured" || slot.slot_position_count !== 1 || slot.fill_rate !== 1) {
    throw new Error(`ad inventory slot mismatch: ${JSON.stringify(report.slots)}`);
  }
  assertTotals(slot.measured, {
    play_event_count: 2,
    play_started_count: 1,
    play_completed_count: 1,
    play_failed_count: 0,
    played_duration_seconds: 30,
    qr_scan_count: 1
  }, "ad inventory slot measured");
  if (!slot.campaign_ids.includes(records.campaignId) || !slot.creative_ids.includes(records.creativeId) || !slot.qr_link_ids.includes(records.qrLinkId)) {
    throw new Error(`ad inventory slot ids mismatch: ${JSON.stringify(slot)}`);
  }

  const filtered = await admin("GET", `/api/admin/reports/ad-inventory?${new URLSearchParams({
    ...criteria,
    ad_slot_id: records.adSlotId,
    creative_id: records.creativeId,
    qr_link_id: records.qrLinkId
  })}`);
  if (filtered.data.report.summary.sellable_slot_count !== 1 || filtered.data.report.summary.measured.play_started_count !== 1) {
    throw new Error(`ad inventory filtered report mismatch: ${JSON.stringify(filtered.data.report)}`);
  }
  const wrongTenant = await admin("GET", `/api/admin/reports/ad-inventory?${new URLSearchParams({
    ...criteria,
    tenant_id: `TEN-NO-MATCH-${runId}`
  })}`);
  if (wrongTenant.data.report.summary.sellable_slot_count !== 0 || wrongTenant.data.report.summary.measured.play_started_count !== 0) {
    throw new Error(`ad inventory tenant isolation failed: ${JSON.stringify(wrongTenant.data.report)}`);
  }
  await expectAdminError("GET", `/api/admin/reports/ad-inventory?${new URLSearchParams({
    ...criteria,
    tenant_id: ""
  })}`, null, 400, "tenant_id is required");
  const after = await admin("GET", "/api/admin/content-manifests");
  const afterCount = (after.data.content_manifests || []).length;
  if (afterCount !== beforeCount) {
    throw new Error(`ad inventory read created content manifests: before=${beforeCount} after=${afterCount}`);
  }
  if (JSON.stringify(report).includes("incremental_roi") || JSON.stringify(report).includes("guaranteed_outcome")) {
    throw new Error("ad inventory must not expose incremental ROI or guaranteed outcome claims");
  }
}

function assertAdMeasurement(report, records, label) {
  const groups = report.ad_measurement || [];
  const group = groups.find((item) =>
    item.store_id === records.storeId &&
    item.campaign_id === records.campaignId &&
    item.content_id === records.contentId &&
    item.item_type === "ad" &&
    item.ad_slot_id === records.adSlotId &&
    item.creative_id === records.creativeId &&
    item.qr_link_id === records.qrLinkId &&
    item.manifest_hash === records.manifestHash
  );
  if (!group) {
    throw new Error(`${label} missing ad measurement group: ${JSON.stringify(groups)}`);
  }
  assertTotals(group, {
    play_event_count: 2,
    play_started_count: 1,
    play_completed_count: 1,
    play_failed_count: 0,
    planned_duration_seconds: 30,
    played_duration_seconds: 30,
    qr_scan_count: 1
  }, `${label} ad measurement`);
  if (group.measurement_label !== "measured") throw new Error(`${label} ad measurement label mismatch`);
  if (group.qr_response_rate !== 1) throw new Error(`${label} qr_response_rate expected 1, got ${group.qr_response_rate}`);
}
