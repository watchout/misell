const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3200";
const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const adminAuth = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`;
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

async function request(method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
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
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return { status: response.status, data, text };
}

async function admin(method, path, body) {
  return request(method, path, body, { authorization: adminAuth });
}

async function expectHttpError(method, path, body, expectedStatus, expectedText) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: adminAuth,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (response.status !== expectedStatus || !text.includes(expectedText)) {
    throw new Error(`${method} ${path} expected ${expectedStatus}/${expectedText}, got ${response.status}: ${text}`);
  }
}

const tenantId = `TEN-SMOKE-${runId}`;
const storeId = `STO-SMOKE-${runId}`;
const locationId = `LOC-SMOKE-${runId}`;
const screenGroupId = `SG-SMOKE-${runId}`;
const deviceId = `DEV-SMOKE-${runId}`;
const itemId = `ITEM-SMOKE-${runId}`;

const device = await admin("POST", "/api/admin/devices", {
  tenant_id: tenantId,
  tenant_name: "Smoke Tenant",
  store_id: storeId,
  store_name: "Smoke Store",
  location_id: locationId,
  location_name: "Main",
  screen_group_id: screenGroupId,
  screen_group_name: "Front",
  device_id: deviceId,
  device_name: "Smoke Player",
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

const item = await admin("POST", "/api/admin/items", {
  item_id: itemId,
  tenant_id: tenantId,
  item_name: "Coffee voucher",
  default_unit_price: 500,
  currency: "JPY",
  tax_included: true
});

await expectHttpError("POST", "/api/admin/offers", {
  store_id: storeId,
  campaign_id: "NO-SUCH-CAMPAIGN",
  status: "draft",
  revision: {
    title: "Invalid campaign check",
    items: [{ item_id: itemId, quantity: 1 }]
  }
}, 400, "campaign_id must reference an existing campaign");

const offer = await admin("POST", "/api/admin/offers", {
  store_id: storeId,
  status: "active",
  revision: {
    title: "Counter coffee set",
    status: "active",
    pickup_location: "counter",
    order_issue_cutoff_time: "23:30",
    max_orders_total: 10,
    max_orders_per_day: 10,
    max_orders_per_visit: 1,
    items: [{ item_id: itemId, quantity: 2 }]
  }
});
const offerId = offer.data.offer.offer_id;
const offerRevisionId = offer.data.offer.current_offer_revision_id;
if (!offerRevisionId) throw new Error("offer did not publish current_offer_revision_id");

const qr = await admin("POST", "/api/admin/qr-links", {
  label: "Smoke QR",
  destination_type: "counter_order_offer",
  offer_id: offerId,
  screen_group_id: screenGroupId,
  content_id: `CONTENT-SMOKE-${runId}`
});
const qrToken = qr.data.qr_link.qr_token;

const scan = await request("GET", `/q/${qrToken}?visit_id=VISIT-SMOKE-${runId}`);
if (!scan.data.qr_scan?.qr_scan_id) throw new Error("QR scan was not recorded");

const order = await request("POST", `/q/${qrToken}/orders`, {
  qr_scan_id: scan.data.qr_scan.qr_scan_id
});
if (!order.data.counter_order?.counter_order_id || !order.data.order_token) {
  throw new Error("counter order was not issued");
}

const orderLookup = await request("GET", `/order/${order.data.order_token}`);
if (orderLookup.data.counter_order.counter_order_id !== order.data.counter_order.counter_order_id) {
  throw new Error("order token lookup mismatch");
}

const redeemed = await admin("PATCH", `/api/admin/counter-orders/${order.data.counter_order.counter_order_id}/status`, {
  status: "redeemed",
  actor_id: "smoke"
});
if (redeemed.data.counter_order.status !== "redeemed") {
  throw new Error("counter order status update failed");
}

const playlogPayload = {
  device_id: deviceId,
  event_id: `EVT-SMOKE-${runId}`,
  event_type: "playback_started",
  timestamp: new Date().toISOString(),
  content_id: `CONTENT-SMOKE-${runId}`,
  playback_id: `PLAY-SMOKE-${runId}`,
  duration: 15,
  result: "started"
};
const playlog1 = await request("POST", "/api/device/playlog", playlogPayload, {
  authorization: `Bearer ${device.data.device_token}`
});
const playlog2 = await request("POST", "/api/device/playlog", playlogPayload, {
  authorization: `Bearer ${device.data.device_token}`
});
if (playlog1.status !== 201 || playlog2.status !== 200 || playlog2.data.duplicate !== true) {
  throw new Error("playlog idempotency failed");
}

const playlist = {
  playlist_version: `pl-smoke-${runId}`,
  items: [{
    item_id: `slot-smoke-${runId}`,
    name: "Smoke Slot",
    duration: 10,
    layout: "wide",
    wide: "/demo/karaoke/index.html"
  }]
};
const contentId = `CONTENT-ACTIVE-${runId}`;
const manifest = await admin("POST", "/api/admin/content-manifests", {
  content_id: contentId,
  playlist_version: playlist.playlist_version,
  status: "active",
  playlist
});
if (manifest.status !== 201) throw new Error("active content manifest create failed");

await admin("PATCH", `/api/admin/content-manifests/${contentId}`, {
  title: "Smoke title update"
});
await expectHttpError("PATCH", `/api/admin/content-manifests/${contentId}`, {
  playlist: {
    playlist_version: `pl-smoke-next-${runId}`,
    items: [{
      item_id: `slot-smoke-next-${runId}`,
      duration: 10,
      layout: "wide",
      wide: "/demo/retail/index.html"
    }]
  }
}, 409, "ACTIVE_CONTENT_IMMUTABLE");

console.log(JSON.stringify({
  ok: true,
  base_url: baseUrl,
  device_id: deviceId,
  item_id: item.data.item.item_id,
  offer_id: offerId,
  offer_revision_id: offerRevisionId,
  qr_token: qrToken,
  counter_order_id: order.data.counter_order.counter_order_id,
  counter_order_status: redeemed.data.counter_order.status,
  playlog_duplicate: playlog2.data.duplicate === true,
  active_content_guard: true
}, null, 2));
