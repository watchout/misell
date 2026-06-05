require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");
const express = require("express");
const basicAuth = require("express-basic-auth");

const app = express();
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = runtimePath("MISELL_CLOUD_DATA_DIR", path.join(ROOT_DIR, "data"));
const DB_PATH = runtimePath("DB_PATH", path.join(DATA_DIR, "misell-cloud.sqlite"));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3200);
const APP_VERSION = "0.1.0";
const ADMIN_USER = process.env.ADMIN_USER || process.env.MISELL_CLOUD_ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.MISELL_CLOUD_ADMIN_PASSWORD || "change-me";
const REQUIRE_ADMIN_AUTH = process.env.REQUIRE_ADMIN_AUTH === "1" || process.env.MISELL_REQUIRE_ADMIN_AUTH === "1";
const DEVICE_TOKEN_PEPPER = process.env.DEVICE_TOKEN_PEPPER || process.env.MISELL_DEVICE_TOKEN_PEPPER || "local-development-pepper";

const STATUS = new Set(["online", "degraded", "offline", "critical", "maintenance", "retired", "lost"]);
const TERMINAL_STATUS = new Set(["maintenance", "retired", "lost"]);
const ADMIN_SET_DEVICE_STATUS = new Set(["offline", "maintenance", "retired", "lost"]);
const RELEASE_CHANNELS = new Set(["dev", "staging", "canary", "stable", "hold"]);
const UPDATE_RESULT_STATUS = new Set(["checking", "updating", "success", "failed"]);
const WARNING_DISK_MB = 10240;
const CRITICAL_DISK_MB = 2048;
const WARNING_MEMORY_PERCENT = 85;
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
const CRITICAL_AFTER_MS = 10 * 60 * 1000;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
initDb();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const adminAuth = basicAuth({
  challenge: true,
  realm: "misell cloud admin",
  authorizer(username, password) {
    return Boolean(
      basicAuth.safeCompare(username, ADMIN_USER) &
      basicAuth.safeCompare(password, ADMIN_PASSWORD)
    );
  },
  unauthorizedResponse: () => ({ error: "Authentication required" })
});

function requireAdminAuth(req, res, next) {
  adminAuth(req, res, next);
}

function requireDeviceAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Device token is required" });
    return;
  }

  const tokenHash = hashDeviceToken(token);
  const device = db.prepare("SELECT * FROM devices WHERE device_token_hash = ?").get(tokenHash);
  if (!device) {
    res.status(401).json({ error: "Invalid device token" });
    return;
  }

  if (device.status === "retired" || device.status === "lost") {
    res.status(403).json({ error: "Device is not allowed to send data" });
    return;
  }

  req.device = device;
  next();
}

app.get("/", (req, res) => {
  res.redirect("/admin");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "misell-cloud",
    version: APP_VERSION,
    time: nowIso()
  });
});

app.get("/admin", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/admin.html", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/admin/devices/:device_id", requireAdminAuth, (req, res) => {
  const deviceId = cleanId(req.params.device_id);
  const device = getDeviceDetail(deviceId);
  if (!device) {
    res.status(404).send("Device not found");
    return;
  }
  res.send(renderDeviceDetailPage(device));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/api/admin/summary", requireAdminAuth, (req, res) => {
  const devices = listDevices();
  const counts = {
    online: 0,
    degraded: 0,
    offline: 0,
    critical: 0,
    maintenance: 0,
    retired: 0,
    lost: 0
  };
  for (const device of devices) {
    const status = device.effective_status || device.status || "offline";
    counts[status] = (counts[status] || 0) + 1;
  }
  res.json({ ok: true, counts, total: devices.length });
});

app.get("/api/admin/devices", requireAdminAuth, (req, res) => {
  res.json({ ok: true, devices: listDevices() });
});

app.get("/api/admin/devices/:device_id", requireAdminAuth, (req, res) => {
  const device = getDeviceDetail(cleanId(req.params.device_id));
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  res.json({ ok: true, device });
});

app.patch("/api/admin/devices/:device_id", requireAdminAuth, (req, res, next) => {
  try {
    const deviceId = cleanId(req.params.device_id);
    const existing = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
    if (!existing) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const input = normalizeDeviceAdminUpdate(req.body || {});
    const now = nowIso();
    db.prepare("UPDATE devices SET status = ?, notes = ?, updated_at = ? WHERE device_id = ?")
      .run(input.status, input.notes, now, deviceId);

    if (TERMINAL_STATUS.has(input.status)) {
      resolveDeviceAlerts(deviceId, now);
    }

    res.json({
      ok: true,
      device: getDeviceDetail(deviceId)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/devices/:device_id/update", requireAdminAuth, (req, res, next) => {
  try {
    const deviceId = cleanId(req.params.device_id);
    const existing = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
    if (!existing) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const input = normalizeDeviceUpdateTarget(req.body || {});
    const now = nowIso();
    const targetReleaseId = input.target_release_id || input.target_update_ref;
    const targetAlreadyCurrent = Boolean(targetReleaseId && targetReleaseId === cleanString(existing.release_id));
    db.prepare(`
      UPDATE devices SET
        target_update_ref = ?,
        target_release_id = ?,
        target_release_channel = ?,
        update_status = ?,
        update_requested_at = ?,
        update_started_at = NULL,
        update_completed_at = ?,
        update_error = '',
        updated_at = ?
      WHERE device_id = ?
    `).run(
      input.target_update_ref,
      input.target_release_id,
      input.target_release_channel,
      input.target_update_ref ? (targetAlreadyCurrent ? "success" : "pending") : "idle",
      input.target_update_ref ? now : null,
      targetAlreadyCurrent ? now : null,
      now,
      deviceId
    );

    if (!input.target_update_ref || targetAlreadyCurrent) {
      resolveAlert(deviceId, "update_failed", now);
    }

    res.json({
      ok: true,
      device: getDeviceDetail(deviceId)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/alerts", requireAdminAuth, (req, res) => {
  const alerts = db.prepare(`
    SELECT * FROM alerts
    WHERE status = 'open'
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      last_seen DESC
    LIMIT 100
  `).all();
  res.json({ ok: true, alerts });
});

app.post("/api/admin/devices", requireAdminAuth, (req, res, next) => {
  try {
    const body = req.body || {};
    const input = normalizeDeviceInput(body);
    if (!input.device_id) throw new Error("device_id is required");
    if (!input.device_name) throw new Error("device_name is required");

    const existing = db.prepare("SELECT device_id FROM devices WHERE device_id = ?").get(input.device_id);
    if (existing) {
      res.status(409).json({ error: "Device already exists" });
      return;
    }

    const deviceToken = crypto.randomBytes(32).toString("base64url");
    const now = nowIso();

    upsertTenant(input.tenant_id, input.tenant_name || input.tenant_id, now);
    upsertStore(input.tenant_id, input.store_id, input.store_name || input.store_id, now);
    upsertLocation(input.tenant_id, input.store_id, input.location_id, input.location_name || input.location_id, now);
    upsertScreenGroup(input.tenant_id, input.store_id, input.location_id, input.screen_group_id, input.screen_group_name || input.screen_group_id, now);

    db.prepare(`
      INSERT INTO devices (
        tenant_id, store_id, location_id, screen_group_id, device_id, device_name,
        device_token_hash, status, release_channel, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?)
    `).run(
      input.tenant_id,
      input.store_id,
      input.location_id,
      input.screen_group_id,
      input.device_id,
      input.device_name,
      hashDeviceToken(deviceToken),
      input.release_channel,
      input.notes,
      now,
      now
    );

    res.status(201).json({
      ok: true,
      device_id: input.device_id,
      device_token: deviceToken
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/heartbeat", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const receivedAt = nowIso();
    const normalized = normalizeHeartbeatPayload(req.device, payload, receivedAt);

    const result = db.prepare(`
      INSERT INTO heartbeats (
        device_id, tenant_id, store_id, location_id, screen_group_id,
        received_at, device_timestamp, ok, app_version, release_id, release_channel,
        playlist_version, config_version, uptime_seconds, system_uptime_seconds,
        service_state, kiosk_state, current_item_id, disk_free_mb, memory_used_percent,
        cpu_load_1m, temperature_c, network_status, display_status, last_error, raw_json
      ) VALUES (
        @device_id, @tenant_id, @store_id, @location_id, @screen_group_id,
        @received_at, @device_timestamp, @ok, @app_version, @release_id, @release_channel,
        @playlist_version, @config_version, @uptime_seconds, @system_uptime_seconds,
        @service_state, @kiosk_state, @current_item_id, @disk_free_mb, @memory_used_percent,
        @cpu_load_1m, @temperature_c, @network_status, @display_status, @last_error, @raw_json
      )
    `).run(normalized);

    const nextDevice = {
      ...req.device,
      ...normalized,
      last_seen: receivedAt
    };
    const effectiveStatus = evaluateStatus(nextDevice, normalized);

    db.prepare(`
      UPDATE devices SET
        status = ?,
        app_version = ?,
        release_id = ?,
        release_channel = ?,
        playlist_version = ?,
        config_version = ?,
        last_seen = ?,
        last_heartbeat_id = ?,
        last_error = ?,
        updated_at = ?
      WHERE device_id = ?
    `).run(
      effectiveStatus,
      normalized.app_version,
      normalized.release_id,
      normalized.release_channel || req.device.release_channel,
      normalized.playlist_version,
      normalized.config_version,
      receivedAt,
      result.lastInsertRowid,
      normalized.last_error,
      receivedAt,
      req.device.device_id
    );

    updateHeartbeatAlerts(req.device.device_id, req.device.tenant_id, req.device.store_id, effectiveStatus, normalized, receivedAt);
    syncUpdateStatusFromHeartbeat(req.device.device_id, normalized, receivedAt);

    res.json({
      ok: true,
      device_id: req.device.device_id,
      status: effectiveStatus,
      received_at: receivedAt,
      next_interval_seconds: 60
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/device/update-policy", requireDeviceAuth, (req, res) => {
  const now = nowIso();
  db.prepare("UPDATE devices SET update_last_checked_at = ?, updated_at = ? WHERE device_id = ?")
    .run(now, now, req.device.device_id);

  const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(req.device.device_id);
  res.json({
    ok: true,
    device_id: req.device.device_id,
    current: {
      app_version: cleanString(device.app_version),
      release_id: cleanString(device.release_id),
      release_channel: cleanString(device.release_channel)
    },
    update: buildDeviceUpdatePolicy(device)
  });
});

app.post("/api/device/update-result", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const input = normalizeDeviceUpdateResult(payload);
    const now = nowIso();

    const setStartedAt = input.status === "updating" ? now : req.device.update_started_at;
    const setCompletedAt = input.status === "success" || input.status === "failed" ? now : req.device.update_completed_at;
    db.prepare(`
      UPDATE devices SET
        update_status = ?,
        update_started_at = ?,
        update_completed_at = ?,
        update_error = ?,
        release_id = COALESCE(NULLIF(?, ''), release_id),
        release_channel = COALESCE(NULLIF(?, ''), release_channel),
        updated_at = ?
      WHERE device_id = ?
    `).run(
      input.status,
      setStartedAt,
      setCompletedAt,
      input.status === "failed" ? input.message : "",
      input.release_id,
      input.release_channel,
      now,
      req.device.device_id
    );

    if (input.status === "failed") {
      openAlert(req.device.device_id, req.device.tenant_id, req.device.store_id, "warning", "update_failed", input.message || "Device update failed", now, payload);
    }
    if (input.status === "success") {
      resolveAlert(req.device.device_id, "update_failed", now);
    }

    res.status(201).json({
      ok: true,
      received_at: now,
      update: buildDeviceUpdatePolicy(db.prepare("SELECT * FROM devices WHERE device_id = ?").get(req.device.device_id))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/playlog", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const now = nowIso();
    db.prepare(`
      INSERT INTO playlogs (
        device_id, tenant_id, store_id, screen_group_id, received_at, played_at,
        playlist_version, playlist_item_id, campaign_id, asset_id, layout, duration, result, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.device.device_id,
      req.device.tenant_id,
      req.device.store_id,
      req.device.screen_group_id,
      now,
      cleanString(payload.timestamp),
      cleanString(payload.playlist_version),
      cleanString(payload.playlist_item_id || payload.item_id || payload.itemId),
      cleanString(payload.campaign_id),
      cleanString(payload.asset_id),
      cleanString(payload.layout),
      asInteger(payload.duration),
      cleanString(payload.result || "started"),
      JSON.stringify(payload)
    );
    res.status(201).json({ ok: true, received_at: now });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/error", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const now = nowIso();
    const severity = cleanString(payload.severity) || "error";
    const message = cleanString(payload.message || payload.error || payload.last_error) || "Device error";

    db.prepare(`
      INSERT INTO error_logs (
        device_id, tenant_id, store_id, received_at, occurred_at, severity, message, path, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.device.device_id,
      req.device.tenant_id,
      req.device.store_id,
      now,
      cleanString(payload.timestamp),
      severity,
      message,
      cleanString(payload.path),
      JSON.stringify(payload)
    );

    openAlert(req.device.device_id, req.device.tenant_id, req.device.store_id, severity === "critical" ? "critical" : "warning", "device_error", message, now, payload);
    db.prepare("UPDATE devices SET last_error = ?, status = ?, updated_at = ? WHERE device_id = ?")
      .run(message, severity === "critical" ? "critical" : "degraded", now, req.device.device_id);

    res.status(201).json({ ok: true, received_at: now });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  const status = error.status || 400;
  res.status(status).json({
    error: error.message || "Request failed",
    errors: [error.message || "Request failed"]
  });
});

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      location_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screen_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      screen_group_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      display_count INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      screen_group_id TEXT NOT NULL,
      device_id TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL,
      device_token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      release_channel TEXT NOT NULL DEFAULT 'stable',
      app_version TEXT,
      release_id TEXT,
      playlist_version TEXT,
      config_version TEXT,
      last_seen TEXT,
      last_heartbeat_id INTEGER,
      last_error TEXT,
      notes TEXT,
      target_update_ref TEXT,
      target_release_id TEXT,
      target_release_channel TEXT,
      update_status TEXT NOT NULL DEFAULT 'idle',
      update_requested_at TEXT,
      update_started_at TEXT,
      update_completed_at TEXT,
      update_last_checked_at TEXT,
      update_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      screen_group_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      device_timestamp TEXT,
      ok INTEGER NOT NULL,
      app_version TEXT,
      release_id TEXT,
      release_channel TEXT,
      playlist_version TEXT,
      config_version TEXT,
      uptime_seconds INTEGER,
      system_uptime_seconds INTEGER,
      service_state TEXT,
      kiosk_state TEXT,
      current_item_id TEXT,
      disk_free_mb INTEGER,
      memory_used_percent INTEGER,
      cpu_load_1m REAL,
      temperature_c REAL,
      network_status TEXT,
      display_status TEXT,
      last_error TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      screen_group_id TEXT,
      received_at TEXT NOT NULL,
      played_at TEXT,
      playlist_version TEXT,
      playlist_item_id TEXT,
      campaign_id TEXT,
      asset_id TEXT,
      layout TEXT,
      duration INTEGER,
      result TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      occurred_at TEXT,
      severity TEXT NOT NULL DEFAULT 'error',
      message TEXT NOT NULL,
      path TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      resolved_at TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_device_received ON heartbeats(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlogs_device_received ON playlogs(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_errors_device_received ON error_logs(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(status, severity, last_seen DESC);
  `);
  migrateDevicesTable();
}

function migrateDevicesTable() {
  const existingColumns = new Set(db.prepare("PRAGMA table_info(devices)").all().map((column) => column.name));
  const columns = [
    ["target_update_ref", "TEXT"],
    ["target_release_id", "TEXT"],
    ["target_release_channel", "TEXT"],
    ["update_status", "TEXT NOT NULL DEFAULT 'idle'"],
    ["update_requested_at", "TEXT"],
    ["update_started_at", "TEXT"],
    ["update_completed_at", "TEXT"],
    ["update_last_checked_at", "TEXT"],
    ["update_error", "TEXT"]
  ];

  for (const [name, definition] of columns) {
    if (!existingColumns.has(name)) {
      db.exec(`ALTER TABLE devices ADD COLUMN ${name} ${definition}`);
    }
  }
}

function normalizeDeviceInput(input) {
  const releaseChannel = cleanString(input.release_channel || "stable");
  return {
    tenant_id: cleanId(input.tenant_id || "TEN-LOCAL"),
    tenant_name: cleanString(input.tenant_name),
    store_id: cleanId(input.store_id || "STO-LOCAL"),
    store_name: cleanString(input.store_name),
    location_id: cleanId(input.location_id || "LOC-LOCAL"),
    location_name: cleanString(input.location_name),
    screen_group_id: cleanId(input.screen_group_id || "SG-LOCAL"),
    screen_group_name: cleanString(input.screen_group_name),
    device_id: cleanId(input.device_id),
    device_name: cleanString(input.device_name || input.device_id),
    release_channel: RELEASE_CHANNELS.has(releaseChannel) ? releaseChannel : "stable",
    notes: cleanString(input.notes)
  };
}

function normalizeDeviceAdminUpdate(input) {
  const status = cleanString(input.status);
  if (!ADMIN_SET_DEVICE_STATUS.has(status)) {
    throw new Error(`status must be one of: ${Array.from(ADMIN_SET_DEVICE_STATUS).join(", ")}`);
  }
  return {
    status,
    notes: cleanString(input.notes).slice(0, 1000)
  };
}

function normalizeDeviceUpdateTarget(input) {
  const targetRef = cleanGitRef(input.target_update_ref || input.target_ref || input.ref);
  const targetReleaseId = cleanString(input.target_release_id || input.release_id).slice(0, 120);
  const targetReleaseChannel = cleanString(input.target_release_channel || input.release_channel);
  if (!targetRef) {
    return {
      target_update_ref: "",
      target_release_id: "",
      target_release_channel: ""
    };
  }
  if (targetReleaseChannel && !RELEASE_CHANNELS.has(targetReleaseChannel)) {
    throw new Error(`target_release_channel must be one of: ${Array.from(RELEASE_CHANNELS).join(", ")}`);
  }
  return {
    target_update_ref: targetRef,
    target_release_id: targetReleaseId || targetRef,
    target_release_channel: targetReleaseChannel
  };
}

function normalizeDeviceUpdateResult(input) {
  const status = cleanString(input.status);
  if (!UPDATE_RESULT_STATUS.has(status)) {
    throw new Error(`status must be one of: ${Array.from(UPDATE_RESULT_STATUS).join(", ")}`);
  }
  const releaseChannel = cleanString(input.release_channel);
  if (releaseChannel && !RELEASE_CHANNELS.has(releaseChannel)) {
    throw new Error(`release_channel must be one of: ${Array.from(RELEASE_CHANNELS).join(", ")}`);
  }
  return {
    status,
    target_update_ref: cleanGitRef(input.target_update_ref || input.target_ref || input.ref),
    target_release_id: cleanString(input.target_release_id || input.release_id).slice(0, 120),
    release_id: cleanString(input.release_id).slice(0, 120),
    release_channel: releaseChannel,
    previous_release_id: cleanString(input.previous_release_id).slice(0, 120),
    message: cleanString(input.message || input.error).slice(0, 1000)
  };
}

function normalizeHeartbeatPayload(device, payload, receivedAt) {
  return {
    device_id: device.device_id,
    tenant_id: device.tenant_id,
    store_id: device.store_id,
    location_id: device.location_id,
    screen_group_id: device.screen_group_id,
    received_at: receivedAt,
    device_timestamp: cleanString(payload.timestamp || payload.current_time),
    ok: payload.ok === false ? 0 : 1,
    app_version: cleanString(payload.app_version),
    release_id: cleanString(payload.release_id),
    release_channel: cleanString(payload.release_channel || device.release_channel),
    playlist_version: cleanString(payload.playlist_version),
    config_version: cleanString(payload.config_version),
    uptime_seconds: asInteger(payload.uptime_seconds || payload.uptime),
    system_uptime_seconds: asInteger(payload.system_uptime_seconds),
    service_state: cleanString(payload.service_state),
    kiosk_state: cleanString(payload.kiosk_state),
    current_item_id: cleanString(payload.current_item_id),
    disk_free_mb: asInteger(payload.disk_free_mb),
    memory_used_percent: asInteger(payload.memory_used_percent),
    cpu_load_1m: asNumber(payload.cpu_load_1m),
    temperature_c: asNumber(payload.temperature_c),
    network_status: cleanString(payload.network_status),
    display_status: cleanString(payload.display_status),
    last_error: cleanString(payload.last_error),
    raw_json: JSON.stringify(payload)
  };
}

function listDevices() {
  const rows = db.prepare(`
    SELECT
      d.*,
      h.disk_free_mb,
      h.memory_used_percent,
      h.cpu_load_1m,
      h.current_item_id,
      h.service_state,
      h.kiosk_state,
      h.display_status,
      h.network_status
    FROM devices d
    LEFT JOIN heartbeats h ON h.id = d.last_heartbeat_id
    ORDER BY d.store_id, d.device_id
  `).all();

  return rows.map((row) => {
    const effectiveStatus = evaluateStatus(row, row);
    if (effectiveStatus !== row.status && !TERMINAL_STATUS.has(row.status)) {
      db.prepare("UPDATE devices SET status = ?, updated_at = ? WHERE device_id = ?")
        .run(effectiveStatus, nowIso(), row.device_id);
    }
    return {
      ...publicDevice(row),
      effective_status: effectiveStatus
    };
  });
}

function publicDevice(device) {
  const { device_token_hash, ...publicFields } = device;
  return publicFields;
}

function getDeviceDetail(deviceId) {
  const device = listDevices().find((row) => row.device_id === deviceId);
  if (!device) return null;
  return {
    ...device,
    heartbeats: db.prepare("SELECT * FROM heartbeats WHERE device_id = ? ORDER BY received_at DESC LIMIT 100").all(deviceId),
    playlogs: db.prepare("SELECT * FROM playlogs WHERE device_id = ? ORDER BY received_at DESC LIMIT 50").all(deviceId),
    error_logs: db.prepare("SELECT * FROM error_logs WHERE device_id = ? ORDER BY received_at DESC LIMIT 50").all(deviceId),
    alerts: db.prepare("SELECT * FROM alerts WHERE device_id = ? AND status = 'open' ORDER BY last_seen DESC").all(deviceId)
  };
}

function evaluateStatus(device, heartbeat) {
  if (TERMINAL_STATUS.has(device.status)) return device.status;
  if (!device.last_seen) return "offline";

  const ageMs = Date.now() - new Date(device.last_seen).getTime();
  if (Number.isFinite(ageMs) && ageMs >= CRITICAL_AFTER_MS) return "critical";

  if (heartbeat) {
    if (heartbeat.ok === 0) return "critical";
    if (asInteger(heartbeat.disk_free_mb) !== null && asInteger(heartbeat.disk_free_mb) < CRITICAL_DISK_MB) return "critical";
    if (cleanString(heartbeat.service_state) && cleanString(heartbeat.service_state) !== "active") return "critical";
  }

  if (Number.isFinite(ageMs) && ageMs >= OFFLINE_AFTER_MS) return "offline";

  if (heartbeat) {
    if (asInteger(heartbeat.disk_free_mb) !== null && asInteger(heartbeat.disk_free_mb) < WARNING_DISK_MB) return "degraded";
    if (asInteger(heartbeat.memory_used_percent) !== null && asInteger(heartbeat.memory_used_percent) >= WARNING_MEMORY_PERCENT) return "degraded";
    if (cleanString(heartbeat.last_error)) return "degraded";
  }

  return "online";
}

function buildDeviceUpdatePolicy(device) {
  const targetRef = cleanString(device.target_update_ref);
  const targetReleaseId = cleanString(device.target_release_id) || targetRef;
  const currentReleaseId = cleanString(device.release_id);
  const required = Boolean(targetRef && targetReleaseId && currentReleaseId !== targetReleaseId);
  return {
    required,
    status: cleanString(device.update_status) || "idle",
    target_update_ref: targetRef,
    target_release_id: targetReleaseId,
    target_release_channel: cleanString(device.target_release_channel),
    requested_at: cleanString(device.update_requested_at),
    started_at: cleanString(device.update_started_at),
    completed_at: cleanString(device.update_completed_at),
    last_checked_at: cleanString(device.update_last_checked_at),
    error: cleanString(device.update_error)
  };
}

function syncUpdateStatusFromHeartbeat(deviceId, heartbeat, now) {
  const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
  if (!device) return;

  const targetReleaseId = cleanString(device.target_release_id) || cleanString(device.target_update_ref);
  if (!targetReleaseId) return;
  if (cleanString(heartbeat.release_id) !== targetReleaseId) return;

  db.prepare(`
    UPDATE devices SET
      update_status = 'success',
      update_completed_at = COALESCE(update_completed_at, ?),
      update_error = '',
      updated_at = ?
    WHERE device_id = ?
  `).run(now, now, deviceId);
  resolveAlert(deviceId, "update_failed", now);
}

function updateHeartbeatAlerts(deviceId, tenantId, storeId, status, heartbeat, now) {
  const checks = [
    {
      active: status === "critical",
      severity: "critical",
      type: "critical_status",
      message: "Device is critical"
    },
    {
      active: status === "offline",
      severity: "warning",
      type: "offline",
      message: "Device heartbeat is delayed"
    },
    {
      active: asInteger(heartbeat.disk_free_mb) !== null && asInteger(heartbeat.disk_free_mb) < WARNING_DISK_MB,
      severity: asInteger(heartbeat.disk_free_mb) !== null && asInteger(heartbeat.disk_free_mb) < CRITICAL_DISK_MB ? "critical" : "warning",
      type: "disk_low",
      message: `Disk free is ${heartbeat.disk_free_mb} MB`
    },
    {
      active: asInteger(heartbeat.memory_used_percent) !== null && asInteger(heartbeat.memory_used_percent) >= WARNING_MEMORY_PERCENT,
      severity: "warning",
      type: "memory_high",
      message: `Memory usage is ${heartbeat.memory_used_percent}%`
    },
    {
      active: Boolean(cleanString(heartbeat.last_error)),
      severity: "warning",
      type: "last_error",
      message: cleanString(heartbeat.last_error) || "Device reported an error"
    }
  ];

  for (const check of checks) {
    if (check.active) {
      openAlert(deviceId, tenantId, storeId, check.severity, check.type, check.message, now, heartbeat);
    } else {
      resolveAlert(deviceId, check.type, now);
    }
  }
}

function openAlert(deviceId, tenantId, storeId, severity, type, message, now, metadata) {
  const existing = db.prepare("SELECT id FROM alerts WHERE device_id = ? AND alert_type = ? AND status = 'open'").get(deviceId, type);
  if (existing) {
    db.prepare("UPDATE alerts SET severity = ?, message = ?, last_seen = ?, metadata_json = ? WHERE id = ?")
      .run(severity, message, now, JSON.stringify(metadata || {}), existing.id);
    return;
  }
  db.prepare(`
    INSERT INTO alerts (device_id, tenant_id, store_id, severity, alert_type, message, first_seen, last_seen, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deviceId, tenantId, storeId, severity, type, message, now, now, JSON.stringify(metadata || {}));
}

function resolveAlert(deviceId, type, now) {
  db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ?, last_seen = ? WHERE device_id = ? AND alert_type = ? AND status = 'open'")
    .run(now, now, deviceId, type);
}

function resolveDeviceAlerts(deviceId, now) {
  db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ?, last_seen = ? WHERE device_id = ? AND status = 'open'")
    .run(now, now, deviceId);
}

function upsertTenant(tenantId, name, now) {
  db.prepare(`
    INSERT INTO tenants (tenant_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).run(tenantId, name, now, now);
}

function upsertStore(tenantId, storeId, name, now) {
  db.prepare(`
    INSERT INTO stores (tenant_id, store_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(store_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).run(tenantId, storeId, name, now, now);
}

function upsertLocation(tenantId, storeId, locationId, name, now) {
  db.prepare(`
    INSERT INTO locations (tenant_id, store_id, location_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(location_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).run(tenantId, storeId, locationId, name, now, now);
}

function upsertScreenGroup(tenantId, storeId, locationId, screenGroupId, name, now) {
  db.prepare(`
    INSERT INTO screen_groups (tenant_id, store_id, location_id, screen_group_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(screen_group_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).run(tenantId, storeId, locationId, screenGroupId, name, now, now);
}

function assertPayloadDeviceMatches(device, payload) {
  const payloadDeviceId = cleanString(payload.device_id);
  if (payloadDeviceId && payloadDeviceId !== device.device_id) {
    const error = new Error("Payload device_id does not match device token");
    error.status = 403;
    throw error;
  }
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function hashDeviceToken(token) {
  return crypto
    .createHash("sha256")
    .update(`${DEVICE_TOKEN_PEPPER}:${token}`)
    .digest("hex");
}

function runtimePath(envName, fallbackPath) {
  const value = process.env[envName];
  if (!value) return fallbackPath;
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

function cleanGitRef(value) {
  const ref = cleanString(value).slice(0, 160);
  if (!ref) return "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref)) {
    throw new Error("target_update_ref must be a safe git ref, tag, or commit hash");
  }
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{") || ref.endsWith(".lock")) {
    throw new Error("target_update_ref contains an invalid git ref sequence");
  }
  return ref;
}

function asInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function asNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function renderDeviceDetailPage(device) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(device.device_id)} | Misell Cloud</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <h1>${escapeHtml(device.device_id)}</h1>
        <a href="/admin">ダッシュボード</a>
      </header>
      <main>
        <section class="section detail-grid">
          <article class="panel">
            <h2>端末</h2>
            <pre>${escapeHtml(JSON.stringify({
              device_id: device.device_id,
              device_name: device.device_name,
              status: device.effective_status,
              tenant_id: device.tenant_id,
              store_id: device.store_id,
              location_id: device.location_id,
              screen_group_id: device.screen_group_id,
              last_seen: device.last_seen
            }, null, 2))}</pre>
          </article>
          <article class="panel">
            <h2>バージョン</h2>
            <pre>${escapeHtml(JSON.stringify({
              app_version: device.app_version,
              release_id: device.release_id,
              release_channel: device.release_channel,
              playlist_version: device.playlist_version,
              config_version: device.config_version,
              target_update_ref: device.target_update_ref,
              target_release_id: device.target_release_id,
              target_release_channel: device.target_release_channel,
              update_status: device.update_status,
              update_requested_at: device.update_requested_at,
              update_started_at: device.update_started_at,
              update_completed_at: device.update_completed_at,
              update_last_checked_at: device.update_last_checked_at,
              update_error: device.update_error
            }, null, 2))}</pre>
          </article>
        </section>
        <section class="section">
          <h2>最新heartbeat</h2>
          <pre>${escapeHtml(JSON.stringify(device.heartbeats.slice(0, 10), null, 2))}</pre>
        </section>
        <section class="section">
          <h2>未対応アラート</h2>
          <pre>${escapeHtml(JSON.stringify(device.alerts, null, 2))}</pre>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function validateSecurityConfig() {
  if (REQUIRE_ADMIN_AUTH && ADMIN_PASSWORD === "change-me") {
    console.warn("WARNING: cloud admin auth uses the default password. Set ADMIN_PASSWORD before deployment.");
  }
  if (DEVICE_TOKEN_PEPPER === "local-development-pepper") {
    console.warn("WARNING: DEVICE_TOKEN_PEPPER uses the development default. Set a real pepper before deployment.");
  }
}

validateSecurityConfig();
app.listen(PORT, HOST, () => {
  console.log(`misell-cloud listening on http://${HOST}:${PORT}`);
  console.log(`admin: http://localhost:${PORT}/admin`);
});
