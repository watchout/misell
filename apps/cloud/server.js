require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");
const express = require("express");
const basicAuth = require("express-basic-auth");
const multer = require("multer");
const { buildManifestContract } = require("./lib/studio-phase1-contract");

const app = express();
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = runtimePath("MISELL_CLOUD_DATA_DIR", path.join(ROOT_DIR, "data"));
const DB_PATH = runtimePath("DB_PATH", path.join(DATA_DIR, "misell-cloud.sqlite"));
const CLOUD_ASSETS_DIR = runtimePath("MISELL_CLOUD_ASSETS_DIR", path.join(DATA_DIR, "assets"));
const CLOUD_ASSET_UPLOAD_TMP_DIR = path.join(DATA_DIR, "tmp", "asset-uploads");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3200);
const APP_VERSION = "0.1.0";
const ADMIN_USER = process.env.ADMIN_USER || process.env.MISELL_CLOUD_ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.MISELL_CLOUD_ADMIN_PASSWORD || "change-me";
const REQUIRE_ADMIN_AUTH = process.env.REQUIRE_ADMIN_AUTH === "1" || process.env.MISELL_REQUIRE_ADMIN_AUTH === "1";
const DEVICE_TOKEN_PEPPER = process.env.DEVICE_TOKEN_PEPPER || process.env.MISELL_DEVICE_TOKEN_PEPPER || "local-development-pepper";
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.MISELL_ALERT_WEBHOOK_URL || "";
const ALERT_WEBHOOK_MIN_SEVERITY = process.env.ALERT_WEBHOOK_MIN_SEVERITY || process.env.MISELL_ALERT_WEBHOOK_MIN_SEVERITY || "warning";
const ALERT_WEBHOOK_NOTIFY_RESOLVED = process.env.ALERT_WEBHOOK_NOTIFY_RESOLVED !== "0" && process.env.MISELL_ALERT_WEBHOOK_NOTIFY_RESOLVED !== "0";
const ALERT_WEBHOOK_TIMEOUT_MS = Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || process.env.MISELL_ALERT_WEBHOOK_TIMEOUT_MS || 5000);

const STATUS = new Set(["online", "degraded", "offline", "critical", "maintenance", "retired", "lost"]);
const TERMINAL_STATUS = new Set(["maintenance", "retired", "lost"]);
const ADMIN_SET_DEVICE_STATUS = new Set(["offline", "maintenance", "retired", "lost"]);
const RELEASE_CHANNELS = new Set(["dev", "staging", "canary", "stable", "hold"]);
const RELEASE_MANIFEST_STATUS = new Set(["draft", "active", "retired"]);
const CONTENT_MANIFEST_STATUS = new Set(["draft", "active", "retired"]);
const UPDATE_RESULT_STATUS = new Set(["checking", "updating", "success", "failed"]);
const ASSET_SYNC_RESULT_STATUS = new Set(["checking", "downloading", "ready", "failed"]);
const ALERT_EVENTS = new Set(["opened", "updated", "resolved", "test"]);
const WARNING_DISK_MB = 10240;
const CRITICAL_DISK_MB = 2048;
const WARNING_MEMORY_PERCENT = 85;
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
const CRITICAL_AFTER_MS = 10 * 60 * 1000;
const DEVICE_LOG_MAX_ENTRIES = normalizedLimit(process.env.DEVICE_LOG_MAX_ENTRIES || process.env.MISELL_DEVICE_LOG_MAX_ENTRIES, 60, 1, 200);
const DEVICE_LOG_ENTRY_MAX_BYTES = normalizedLimit(process.env.DEVICE_LOG_ENTRY_MAX_BYTES || process.env.MISELL_DEVICE_LOG_ENTRY_MAX_BYTES, 40000, 4096, 100000);
const DEVICE_LOG_TOTAL_MAX_BYTES = normalizedLimit(process.env.DEVICE_LOG_TOTAL_MAX_BYTES || process.env.MISELL_DEVICE_LOG_TOTAL_MAX_BYTES, 500000, 65536, 900000);
const CLOUD_ASSET_MAX_MB = normalizedLimit(process.env.CLOUD_ASSET_MAX_MB || process.env.MISELL_CLOUD_ASSET_MAX_MB, 500, 1, 2048);
const CLOUD_ASSET_MAX_BYTES = CLOUD_ASSET_MAX_MB * 1024 * 1024;
const CLOUD_ASSET_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".mp4", ".webm"]);
const CLOUD_ASSET_TYPE_BY_EXTENSION = new Map([
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".mp4", "video"],
  [".webm", "video"]
]);
const CLOUD_ASSET_MIME_BY_EXTENSION = new Map([
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".mp4", new Set(["video/mp4"])],
  [".webm", new Set(["video/webm", "video/x-matroska"])]
]);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(CLOUD_ASSETS_DIR, { recursive: true });
fs.mkdirSync(CLOUD_ASSET_UPLOAD_TMP_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
initDb();

const cloudAssetUpload = multer({
  storage: multer.diskStorage({
    destination: CLOUD_ASSET_UPLOAD_TMP_DIR,
    filename(req, file, cb) {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${path.extname(file.originalname || "").toLowerCase()}`);
    }
  }),
  limits: {
    fileSize: CLOUD_ASSET_MAX_BYTES,
    files: 1
  }
});

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

  if (device.token_status === "revoked") {
    res.status(403).json({ error: "Device token has been revoked" });
    return;
  }

  if (device.status === "retired" || device.status === "lost") {
    res.status(403).json({ error: "Device is not allowed to send data" });
    return;
  }

  const now = nowIso();
  db.prepare("UPDATE devices SET token_last_used_at = ?, updated_at = ? WHERE device_id = ?")
    .run(now, now, device.device_id);

  req.device = {
    ...device,
    token_last_used_at: now
  };
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
  res.json({
    ok: true,
    counts,
    total: devices.length,
    notifications: alertNotificationConfig()
  });
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

app.get("/api/admin/device-log-bundles", requireAdminAuth, (req, res) => {
  res.json({ ok: true, log_bundles: listDeviceLogBundles() });
});

app.get("/api/admin/device-log-bundles/:id", requireAdminAuth, (req, res) => {
  const bundle = getDeviceLogBundle(asInteger(req.params.id));
  if (!bundle) {
    res.status(404).json({ error: "Device log bundle not found" });
    return;
  }
  res.json({ ok: true, log_bundle: bundle });
});

app.get("/api/admin/assets", requireAdminAuth, (req, res) => {
  res.json({
    ok: true,
    max_upload_mb: CLOUD_ASSET_MAX_MB,
    assets: listCloudAssets()
  });
});

app.post("/api/admin/assets", requireAdminAuth, (req, res, next) => {
  cloudAssetUpload.single("asset")(req, res, (error) => {
    if (error) {
      next(normalizeCloudAssetUploadError(error));
      return;
    }
    try {
      const asset = createCloudAsset(req.file, req.body || {});
      res.status(201).json({ ok: true, asset });
    } catch (createError) {
      cleanupUploadedFile(req.file);
      next(createError);
    }
  });
});

app.get("/api/admin/assets/:asset_id/download", requireAdminAuth, (req, res, next) => {
  try {
    const asset = getCloudAsset(cleanId(req.params.asset_id), { includeStoragePath: true });
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.setHeader("Content-Type", asset.mime_type);
    res.setHeader("Content-Length", String(asset.size));
    res.setHeader("Content-Disposition", `attachment; filename="${asset.filename.replace(/"/g, "")}"`);
    res.sendFile(asset.storage_path);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/assets/:asset_id", requireAdminAuth, (req, res, next) => {
  try {
    const asset = getCloudAsset(cleanId(req.params.asset_id), { includeStoragePath: true });
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    const usage = listCloudAssetManifestUsage(asset.asset_id);
    if (usage.length > 0) {
      res.status(409).json({
        error: "Asset is used by content manifests",
        content_manifests: usage
      });
      return;
    }
    db.prepare("DELETE FROM cloud_assets WHERE asset_id = ?").run(asset.asset_id);
    fs.rmSync(asset.storage_path, { force: true });
    res.json({ ok: true, asset_id: asset.asset_id });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/release-manifests", requireAdminAuth, (req, res) => {
  res.json({ ok: true, release_manifests: listReleaseManifests() });
});

app.post("/api/admin/release-manifests", requireAdminAuth, (req, res, next) => {
  try {
    const input = normalizeReleaseManifestInput(req.body || {});
    const existing = db.prepare("SELECT manifest_id FROM release_manifests WHERE manifest_id = ?").get(input.manifest_id);
    if (existing) {
      res.status(409).json({ error: "Release manifest already exists" });
      return;
    }

    const now = nowIso();
    const createManifest = db.transaction(() => {
      if (input.status === "active") {
        retireActiveReleaseManifests(input.release_channel, now);
      }
      db.prepare(`
        INSERT INTO release_manifests (
          manifest_id, release_id, release_channel, update_ref, app_version,
          status, notes, created_at, updated_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.manifest_id,
        input.release_id,
        input.release_channel,
        input.update_ref,
        input.app_version,
        input.status,
        input.notes,
        now,
        now,
        input.status === "active" ? now : null
      );
    });
    createManifest();

    res.status(201).json({
      ok: true,
      release_manifest: getReleaseManifest(input.manifest_id)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/release-manifests/:manifest_id", requireAdminAuth, (req, res, next) => {
  try {
    const manifestId = cleanId(req.params.manifest_id);
    const existing = db.prepare("SELECT * FROM release_manifests WHERE manifest_id = ?").get(manifestId);
    if (!existing) {
      res.status(404).json({ error: "Release manifest not found" });
      return;
    }

    const input = normalizeReleaseManifestInput(req.body || {}, existing);
    const now = nowIso();
    const publishedAt = input.status === "active"
      ? (existing.status === "active" && existing.published_at ? existing.published_at : now)
      : existing.published_at;
    const updateManifest = db.transaction(() => {
      if (input.status === "active") {
        retireActiveReleaseManifests(input.release_channel, now, manifestId);
      }
      db.prepare(`
        UPDATE release_manifests SET
          release_id = ?,
          release_channel = ?,
          update_ref = ?,
          app_version = ?,
          status = ?,
          notes = ?,
          updated_at = ?,
          published_at = ?
        WHERE manifest_id = ?
      `).run(
        input.release_id,
        input.release_channel,
        input.update_ref,
        input.app_version,
        input.status,
        input.notes,
        now,
        publishedAt,
        manifestId
      );
    });
    updateManifest();

    res.json({
      ok: true,
      release_manifest: getReleaseManifest(manifestId)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/content-manifests", requireAdminAuth, (req, res) => {
  res.json({ ok: true, content_manifests: listContentManifests() });
});

app.post("/api/admin/content-manifests", requireAdminAuth, (req, res, next) => {
  try {
    const input = normalizeContentManifestInput(req.body || {});
    const existing = db.prepare("SELECT content_id FROM content_manifests WHERE content_id = ?").get(input.content_id);
    if (existing) {
      res.status(409).json({ error: "Content manifest already exists" });
      return;
    }

    const now = nowIso();
    const createManifest = db.transaction(() => {
      if (input.status === "active") {
        retireActiveContentManifests(input.release_channel, now);
      }
      db.prepare(`
        INSERT INTO content_manifests (
          content_id, playlist_version, release_channel, status, title, notes,
          tenant_id, site_id, display_wall_id, screen_id,
          manifest_schema_version, manifest_version, content_hash, lifecycle_status,
          playlist_json, created_at, updated_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.content_id,
        input.playlist_version,
        input.release_channel,
        input.status,
        input.title,
        input.notes,
        input.tenant_id,
        input.site_id,
        input.display_wall_id,
        input.screen_id,
        input.manifest_schema_version,
        input.manifest_version,
        input.content_hash,
        input.lifecycle_status,
        JSON.stringify(input.playlist),
        now,
        now,
        input.status === "active" ? now : null
      );
      replaceContentManifestAssets(input.content_id, input.assets, now);
    });
    createManifest();

    res.status(201).json({
      ok: true,
      content_manifest: getContentManifest(input.content_id, true)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/content-manifests/:content_id", requireAdminAuth, (req, res, next) => {
  try {
    const contentId = cleanId(req.params.content_id);
    const existing = db.prepare("SELECT * FROM content_manifests WHERE content_id = ?").get(contentId);
    if (!existing) {
      res.status(404).json({ error: "Content manifest not found" });
      return;
    }

    const input = normalizeContentManifestInput(req.body || {}, existing);
    const now = nowIso();
    const publishedAt = input.status === "active"
      ? (existing.status === "active" && existing.published_at ? existing.published_at : now)
      : existing.published_at;
    const updateManifest = db.transaction(() => {
      if (input.status === "active") {
        retireActiveContentManifests(input.release_channel, now, contentId);
      }
      db.prepare(`
        UPDATE content_manifests SET
          playlist_version = ?,
          release_channel = ?,
          status = ?,
          title = ?,
          notes = ?,
          tenant_id = ?,
          site_id = ?,
          display_wall_id = ?,
          screen_id = ?,
          manifest_schema_version = ?,
          manifest_version = ?,
          content_hash = ?,
          lifecycle_status = ?,
          playlist_json = ?,
          updated_at = ?,
          published_at = ?
        WHERE content_id = ?
      `).run(
        input.playlist_version,
        input.release_channel,
        input.status,
        input.title,
        input.notes,
        input.tenant_id,
        input.site_id,
        input.display_wall_id,
        input.screen_id,
        input.manifest_schema_version,
        input.manifest_version,
        input.content_hash,
        input.lifecycle_status,
        JSON.stringify(input.playlist),
        now,
        publishedAt,
        contentId
      );
      if (input.assets_supplied) {
        replaceContentManifestAssets(contentId, input.assets, now);
      }
    });
    updateManifest();

    res.json({
      ok: true,
      content_manifest: getContentManifest(contentId, true)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/content-rollouts/:content_id", requireAdminAuth, (req, res) => {
  const rollout = getContentRollout(cleanId(req.params.content_id));
  if (!rollout) {
    res.status(404).json({ error: "Content manifest not found" });
    return;
  }
  res.json({ ok: true, rollout });
});

app.post("/api/admin/content-rollouts/:content_id/devices/:device_id/retry", requireAdminAuth, (req, res) => {
  const contentId = cleanId(req.params.content_id);
  const deviceId = cleanId(req.params.device_id);
  const result = retryContentRolloutDevice(contentId, deviceId);
  if (!result) {
    res.status(404).json({ error: "Content manifest or device not found" });
    return;
  }
  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({ ok: true, rollout: result.rollout });
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
    const updateDevice = db.transaction(() => {
      db.prepare("UPDATE devices SET status = ?, notes = ?, updated_at = ? WHERE device_id = ?")
        .run(input.status, input.notes, now, deviceId);

      if (input.status === "retired" || input.status === "lost") {
        const reason = `device marked ${input.status}`;
        db.prepare(`
          UPDATE devices SET
            token_status = 'revoked',
            token_revoked_at = COALESCE(token_revoked_at, ?),
            token_revoked_reason = COALESCE(NULLIF(token_revoked_reason, ''), ?),
            updated_at = ?
          WHERE device_id = ?
        `).run(now, reason, now, deviceId);
        if (existing.token_status !== "revoked") {
          recordDeviceTokenEvent(deviceId, "revoked", reason, now, existing.token_generation || 1);
        }
      }
    });
    updateDevice();

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
        update_manifest_id = '',
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

app.post("/api/admin/devices/:device_id/token/revoke", requireAdminAuth, (req, res, next) => {
  try {
    const deviceId = cleanId(req.params.device_id);
    const existing = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
    if (!existing) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const input = normalizeDeviceTokenAction(req.body || {});
    const now = nowIso();
    const revokeToken = db.transaction(() => {
      db.prepare(`
        UPDATE devices SET
          token_status = 'revoked',
          token_revoked_at = ?,
          token_revoked_reason = ?,
          updated_at = ?
        WHERE device_id = ?
      `).run(now, input.reason, now, deviceId);
      recordDeviceTokenEvent(deviceId, "revoked", input.reason, now, existing.token_generation || 1);
    });
    revokeToken();

    res.json({
      ok: true,
      device: getDeviceDetail(deviceId)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/devices/:device_id/token/rotate", requireAdminAuth, (req, res, next) => {
  try {
    const deviceId = cleanId(req.params.device_id);
    const existing = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
    if (!existing) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const input = normalizeDeviceTokenAction(req.body || {});
    const deviceToken = generateDeviceToken();
    const tokenGeneration = (existing.token_generation || 1) + 1;
    const now = nowIso();
    const rotateToken = db.transaction(() => {
      db.prepare(`
        UPDATE devices SET
          device_token_hash = ?,
          token_status = 'active',
          token_generation = ?,
          token_rotated_at = ?,
          token_revoked_at = NULL,
          token_revoked_reason = '',
          token_last_used_at = NULL,
          updated_at = ?
        WHERE device_id = ?
      `).run(hashDeviceToken(deviceToken), tokenGeneration, now, now, deviceId);
      recordDeviceTokenEvent(deviceId, "rotated", input.reason, now, tokenGeneration);
    });
    rotateToken();

    res.status(201).json({
      ok: true,
      device_id: deviceId,
      device_token: deviceToken,
      device: getDeviceDetail(deviceId)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/alerts", requireAdminAuth, (req, res) => {
  const alerts = db.prepare(`
    SELECT
      a.*,
      n.event AS last_notification_event,
      n.status AS last_notification_status,
      n.attempted_at AS last_notification_attempted_at,
      n.delivered_at AS last_notification_delivered_at,
      n.error AS last_notification_error
    FROM alerts a
    LEFT JOIN alert_notifications n ON n.id = (
      SELECT id FROM alert_notifications
      WHERE alert_id = a.id
      ORDER BY id DESC
      LIMIT 1
    )
    WHERE a.status = 'open'
    ORDER BY
      CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      a.last_seen DESC
    LIMIT 100
  `).all();
  res.json({ ok: true, alerts });
});

app.get("/api/admin/alert-notifications", requireAdminAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT
      n.id,
      n.alert_id,
      n.event,
      n.channel,
      n.status,
      n.attempted_at,
      n.delivered_at,
      n.response_status,
      n.error,
      n.created_at,
      a.device_id,
      a.alert_type,
      a.severity,
      a.status AS alert_status
    FROM alert_notifications n
    LEFT JOIN alerts a ON a.id = n.alert_id
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 100
  `).all();
  res.json({
    ok: true,
    config: alertNotificationConfig(),
    notifications
  });
});

app.post("/api/admin/alert-notifications/test", requireAdminAuth, async (req, res, next) => {
  try {
    if (!ALERT_WEBHOOK_URL) {
      res.status(400).json({ error: "ALERT_WEBHOOK_URL is not configured" });
      return;
    }

    const now = nowIso();
    const payload = buildAlertWebhookPayload({
      id: null,
      device_id: cleanId(req.body?.device_id || "DEV-TEST"),
      tenant_id: cleanId(req.body?.tenant_id || "TEN-TEST"),
      store_id: cleanId(req.body?.store_id || "STO-TEST"),
      severity: cleanString(req.body?.severity || "warning") || "warning",
      alert_type: cleanString(req.body?.alert_type || "notification_test") || "notification_test",
      message: cleanString(req.body?.message || "Misell alert notification test") || "Misell alert notification test",
      status: "open",
      first_seen: now,
      last_seen: now,
      resolved_at: null
    }, "test");
    const notificationId = recordAlertNotification(null, "test", payload, now);
    await sendWebhookNotification(notificationId, payload);
    const notification = getAlertNotification(notificationId);
    res.status(notification.status === "delivered" ? 201 : 502).json({
      ok: notification.status === "delivered",
      notification
    });
  } catch (error) {
    next(error);
  }
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

    const deviceToken = generateDeviceToken();
    const now = nowIso();

    const createDevice = db.transaction(() => {
      upsertTenant(input.tenant_id, input.tenant_name || input.tenant_id, now);
      upsertStore(input.tenant_id, input.store_id, input.store_name || input.store_id, now);
      upsertLocation(input.tenant_id, input.store_id, input.location_id, input.location_name || input.location_id, now);
      upsertScreenGroup(input.tenant_id, input.store_id, input.location_id, input.screen_group_id, input.screen_group_name || input.screen_group_id, now);

      db.prepare(`
        INSERT INTO devices (
          tenant_id, store_id, location_id, screen_group_id, device_id, device_name,
          device_token_hash, token_status, token_generation, status, release_channel, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, 'offline', ?, ?, ?, ?)
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
      recordDeviceTokenEvent(input.device_id, "created", "initial device registration", now, 1);
    });
    createDevice();

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
        update_manifest_id = COALESCE(NULLIF(?, ''), update_manifest_id),
        release_id = COALESCE(NULLIF(?, ''), release_id),
        release_channel = COALESCE(NULLIF(?, ''), release_channel),
        updated_at = ?
      WHERE device_id = ?
    `).run(
      input.status,
      setStartedAt,
      setCompletedAt,
      input.status === "failed" ? input.message : "",
      input.target_manifest_id,
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

app.get("/api/device/content-policy", requireDeviceAuth, (req, res) => {
  const now = nowIso();
  db.prepare("UPDATE devices SET updated_at = ? WHERE device_id = ?")
    .run(now, req.device.device_id);

  const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(req.device.device_id);
  res.json({
    ok: true,
    device_id: req.device.device_id,
    current: {
      playlist_version: cleanString(device.playlist_version),
      release_channel: cleanString(device.release_channel)
    },
    content: buildDeviceContentPolicy(device)
  });
});

app.get("/api/device/assets/:asset_id/download", requireDeviceAuth, (req, res, next) => {
  try {
    const assetId = cleanId(req.params.asset_id);
    const manifestAsset = getDeviceContentManifestAsset(req.device, assetId);
    if (!manifestAsset) {
      res.status(404).json({ error: "Asset is not available for this device" });
      return;
    }
    const asset = getCloudAsset(assetId, { includeStoragePath: true });
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.setHeader("Content-Type", asset.mime_type);
    res.setHeader("Content-Length", String(asset.size));
    res.setHeader("Content-Disposition", `attachment; filename="${asset.filename.replace(/"/g, "")}"`);
    res.sendFile(asset.storage_path);
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/content-result", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const input = normalizeDeviceContentResult(payload);
    const now = nowIso();

    if (input.status === "success") {
      db.prepare(`
        UPDATE devices SET
          playlist_version = COALESCE(NULLIF(?, ''), playlist_version),
          last_error = '',
          updated_at = ?
        WHERE device_id = ?
      `).run(input.playlist_version, now, req.device.device_id);
      resolveAlert(req.device.device_id, "content_sync_failed", now);
    } else if (input.status === "failed") {
      db.prepare("UPDATE devices SET last_error = ?, updated_at = ? WHERE device_id = ?")
        .run(input.message, now, req.device.device_id);
      openAlert(req.device.device_id, req.device.tenant_id, req.device.store_id, "warning", "content_sync_failed", input.message || "Device content sync failed", now, payload);
    }

    res.status(201).json({
      ok: true,
      received_at: now,
      content: buildDeviceContentPolicy(db.prepare("SELECT * FROM devices WHERE device_id = ?").get(req.device.device_id))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/asset-result", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const input = normalizeDeviceAssetResult(payload);
    const manifestAsset = getDeviceContentManifestAsset(req.device, input.asset_id);
    if (!manifestAsset) {
      res.status(404).json({ error: "Asset is not available for this device" });
      return;
    }

    const now = nowIso();
    const contentId = input.content_id || manifestAsset.content_id;
    db.prepare(`
      INSERT INTO device_asset_states (
        device_id, content_id, asset_id, status, target_path, local_path,
        sha256, size, message, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, content_id, asset_id) DO UPDATE SET
        status = excluded.status,
        target_path = excluded.target_path,
        local_path = excluded.local_path,
        sha256 = excluded.sha256,
        size = excluded.size,
        message = excluded.message,
        updated_at = excluded.updated_at
    `).run(
      req.device.device_id,
      contentId,
      input.asset_id,
      input.status,
      input.target_path || manifestAsset.target_path,
      input.local_path,
      input.sha256,
      input.size,
      input.message,
      now
    );

    db.prepare("UPDATE devices SET updated_at = ? WHERE device_id = ?")
      .run(now, req.device.device_id);

    if (input.status === "failed") {
      const message = input.message || `Asset sync failed: ${input.asset_id}`;
      db.prepare("UPDATE devices SET last_error = ?, updated_at = ? WHERE device_id = ?")
        .run(message, now, req.device.device_id);
      openAlert(req.device.device_id, req.device.tenant_id, req.device.store_id, "warning", "asset_sync_failed", message, now, payload);
    } else if (input.status === "ready") {
      resolveAlert(req.device.device_id, "asset_sync_failed", now);
    }

    const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(req.device.device_id);
    res.status(201).json({
      ok: true,
      received_at: now,
      content: buildDeviceContentPolicy(device)
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

app.post("/api/device/logs", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const now = nowIso();
    const input = normalizeDeviceLogBundle(req.device, payload, now);

    const result = db.prepare(`
      INSERT INTO device_log_bundles (
        device_id, tenant_id, store_id, screen_group_id, received_at, captured_at,
        label, reason, source, hostname, app_version, release_id, release_channel,
        entry_count, total_bytes, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.device.device_id,
      req.device.tenant_id,
      req.device.store_id,
      req.device.screen_group_id,
      now,
      input.captured_at,
      input.label,
      input.reason,
      input.source,
      input.hostname,
      input.app_version,
      input.release_id,
      input.release_channel,
      input.entry_count,
      input.total_bytes,
      JSON.stringify(input.raw)
    );

    db.prepare("UPDATE devices SET updated_at = ? WHERE device_id = ?")
      .run(now, req.device.device_id);

    res.status(201).json({
      ok: true,
      received_at: now,
      log_bundle: publicDeviceLogBundle({
        id: result.lastInsertRowid,
        device_id: req.device.device_id,
        tenant_id: req.device.tenant_id,
        store_id: req.device.store_id,
        screen_group_id: req.device.screen_group_id,
        received_at: now,
        captured_at: input.captured_at,
        label: input.label,
        reason: input.reason,
        source: input.source,
        hostname: input.hostname,
        app_version: input.app_version,
        release_id: input.release_id,
        release_channel: input.release_channel,
        entry_count: input.entry_count,
        total_bytes: input.total_bytes
      })
    });
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
      token_status TEXT NOT NULL DEFAULT 'active',
      token_generation INTEGER NOT NULL DEFAULT 1,
      token_rotated_at TEXT,
      token_revoked_at TEXT,
      token_revoked_reason TEXT,
      token_last_used_at TEXT,
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
      update_manifest_id TEXT,
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

    CREATE TABLE IF NOT EXISTS alert_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER,
      event TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'webhook',
      status TEXT NOT NULL DEFAULT 'pending',
      attempted_at TEXT NOT NULL,
      delivered_at TEXT,
      response_status INTEGER,
      error TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      event TEXT NOT NULL,
      token_generation INTEGER,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_log_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      screen_group_id TEXT,
      received_at TEXT NOT NULL,
      captured_at TEXT,
      label TEXT,
      reason TEXT,
      source TEXT,
      hostname TEXT,
      app_version TEXT,
      release_id TEXT,
      release_channel TEXT,
      entry_count INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS release_manifests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifest_id TEXT NOT NULL UNIQUE,
      release_id TEXT NOT NULL,
      release_channel TEXT NOT NULL,
      update_ref TEXT NOT NULL,
      app_version TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS content_manifests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT NOT NULL UNIQUE,
      playlist_version TEXT NOT NULL,
      release_channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      title TEXT,
      notes TEXT,
      playlist_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cloud_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      label TEXT,
      notes TEXT,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      download_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_manifest_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      target_path TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(content_id, asset_id),
      FOREIGN KEY(content_id) REFERENCES content_manifests(content_id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id) REFERENCES cloud_assets(asset_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS device_asset_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      content_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      status TEXT NOT NULL,
      target_path TEXT,
      local_path TEXT,
      sha256 TEXT,
      size INTEGER,
      message TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(device_id, content_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_device_received ON heartbeats(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlogs_device_received ON playlogs(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_errors_device_received ON error_logs(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(status, severity, last_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_notifications_alert ON alert_notifications(alert_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_notifications_status ON alert_notifications(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_token_events_device ON device_token_events(device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_log_bundles_device ON device_log_bundles(device_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_log_bundles_received ON device_log_bundles(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_release_manifests_channel ON release_manifests(release_channel, status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_release_manifests_status ON release_manifests(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_manifests_channel ON content_manifests(release_channel, status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_manifests_status ON content_manifests(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cloud_assets_type ON cloud_assets(type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cloud_assets_sha256 ON cloud_assets(sha256);
    CREATE INDEX IF NOT EXISTS idx_content_manifest_assets_content ON content_manifest_assets(content_id);
    CREATE INDEX IF NOT EXISTS idx_content_manifest_assets_asset ON content_manifest_assets(asset_id);
    CREATE INDEX IF NOT EXISTS idx_device_asset_states_device ON device_asset_states(device_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_asset_states_asset ON device_asset_states(asset_id, updated_at DESC);
  `);
  migrateDevicesTable();
  db.exec("CREATE INDEX IF NOT EXISTS idx_devices_token_status ON devices(token_status)");
  applySchemaMigrations();
}

function schemaMigrations() {
  return [
    {
      version: 1,
      name: "existing_cloud_schema_baseline",
      up() {
        // Existing installs were initialized by the legacy CREATE IF NOT EXISTS block above.
      }
    },
    {
      version: 2,
      name: "advertising_foundation_tables",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS advertisers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            advertiser_id TEXT NOT NULL UNIQUE,
            advertiser_name TEXT NOT NULL,
            agency_name TEXT,
            contact_name TEXT,
            contact_email TEXT,
            contact_phone TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL UNIQUE,
            advertiser_id TEXT,
            campaign_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            start_date TEXT,
            end_date TEXT,
            target_store_ids_json TEXT,
            target_time_slots_json TEXT,
            priority INTEGER NOT NULL DEFAULT 0,
            qr_url TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(advertiser_id) REFERENCES advertisers(advertiser_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id TEXT NOT NULL UNIQUE,
            advertiser_id TEXT,
            campaign_id TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            applicant_name TEXT,
            applicant_email TEXT,
            applicant_phone TEXT,
            company_name TEXT,
            campaign_name TEXT,
            desired_start_date TEXT,
            desired_end_date TEXT,
            target_store_ids_json TEXT,
            target_time_slots_json TEXT,
            budget_amount INTEGER,
            qr_url TEXT,
            notes TEXT,
            submitted_at TEXT,
            reviewed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(advertiser_id) REFERENCES advertisers(advertiser_id) ON DELETE SET NULL,
            FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS application_materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            material_id TEXT NOT NULL UNIQUE,
            application_id TEXT NOT NULL,
            cloud_asset_id TEXT,
            asset_id TEXT,
            original_name TEXT,
            mime_type TEXT,
            size INTEGER,
            sha256 TEXT,
            status TEXT NOT NULL DEFAULT 'submitted',
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE,
            FOREIGN KEY(cloud_asset_id) REFERENCES cloud_assets(asset_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS application_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comment_id TEXT NOT NULL UNIQUE,
            application_id TEXT NOT NULL,
            author_type TEXT NOT NULL DEFAULT 'admin',
            author_id TEXT,
            author_name TEXT,
            visibility TEXT NOT NULL DEFAULT 'internal',
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS application_status_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            application_id TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT NOT NULL,
            actor_type TEXT NOT NULL DEFAULT 'admin',
            actor_id TEXT,
            reason TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS qr_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qr_link_id TEXT NOT NULL UNIQUE,
            campaign_id TEXT,
            advertiser_id TEXT,
            qr_id TEXT,
            label TEXT,
            destination_url TEXT NOT NULL,
            short_path TEXT UNIQUE,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
            FOREIGN KEY(advertiser_id) REFERENCES advertisers(advertiser_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS qr_scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qr_link_id TEXT,
            campaign_id TEXT,
            advertiser_id TEXT,
            store_id TEXT,
            device_id TEXT,
            scanned_at TEXT NOT NULL,
            user_agent TEXT,
            ip_hash TEXT,
            referrer TEXT,
            raw_json TEXT,
            FOREIGN KEY(qr_link_id) REFERENCES qr_links(qr_link_id) ON DELETE SET NULL,
            FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
            FOREIGN KEY(advertiser_id) REFERENCES advertisers(advertiser_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS report_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id TEXT NOT NULL UNIQUE,
            campaign_id TEXT,
            advertiser_id TEXT,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            snapshot_type TEXT NOT NULL DEFAULT 'monthly',
            metrics_json TEXT NOT NULL,
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
            FOREIGN KEY(advertiser_id) REFERENCES advertisers(advertiser_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_type TEXT NOT NULL DEFAULT 'admin',
            actor_id TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            before_json TEXT,
            after_json TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_advertisers_status ON advertisers(status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser ON campaigns(advertiser_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaigns_status_dates ON campaigns(status, start_date, end_date);
          CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_applications_advertiser ON applications(advertiser_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_applications_campaign ON applications(campaign_id);
          CREATE INDEX IF NOT EXISTS idx_application_materials_application ON application_materials(application_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_application_comments_application ON application_comments(application_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_application_status_events_application ON application_status_events(application_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_qr_links_campaign ON qr_links(campaign_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_qr_links_short_path ON qr_links(short_path);
          CREATE INDEX IF NOT EXISTS idx_qr_scans_link_time ON qr_scans(qr_link_id, scanned_at DESC);
          CREATE INDEX IF NOT EXISTS idx_qr_scans_campaign_time ON qr_scans(campaign_id, scanned_at DESC);
          CREATE INDEX IF NOT EXISTS idx_report_snapshots_campaign_period ON report_snapshots(campaign_id, period_start, period_end);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
        `);
      }
    },
    {
      version: 3,
      name: "studio_phase1_domain_publish_and_approval_contracts",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS screens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            screen_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            position TEXT NOT NULL,
            display_order INTEGER NOT NULL,
            name TEXT,
            orientation TEXT NOT NULL DEFAULT 'landscape',
            resolution_width INTEGER NOT NULL DEFAULT 1920,
            resolution_height INTEGER NOT NULL DEFAULT 1080,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
            FOREIGN KEY(screen_group_id) REFERENCES screen_groups(screen_group_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS screen_device_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            binding_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            screen_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            bound_at TEXT NOT NULL,
            unbound_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(screen_id) REFERENCES screens(screen_id) ON DELETE CASCADE,
            FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS content_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            approval_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            site_id TEXT,
            display_wall_id TEXT,
            content_type TEXT NOT NULL,
            subject_type TEXT NOT NULL,
            subject_id TEXT NOT NULL,
            subject_hash TEXT NOT NULL DEFAULT '',
            content_hash TEXT NOT NULL DEFAULT '',
            approval_status TEXT NOT NULL DEFAULT 'draft',
            requested_by TEXT,
            requested_at TEXT,
            decided_by TEXT,
            decided_at TEXT,
            expires_at TEXT,
            rejection_reason TEXT,
            revoked_reason TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS publish_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publish_history_id TEXT NOT NULL UNIQUE,
            content_id TEXT NOT NULL,
            tenant_id TEXT,
            site_id TEXT,
            display_wall_id TEXT,
            screen_id TEXT,
            action TEXT NOT NULL,
            manifest_version INTEGER NOT NULL,
            manifest_schema_version INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            previous_content_id TEXT,
            rollback_from_content_id TEXT,
            actor_role TEXT,
            actor_id TEXT,
            approval_snapshot_json TEXT NOT NULL DEFAULT '{}',
            approval_hash TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(content_id) REFERENCES content_manifests(content_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_screens_group_order ON screens(screen_group_id, display_order);
          CREATE INDEX IF NOT EXISTS idx_screens_tenant_store ON screens(tenant_id, store_id, status);
          CREATE INDEX IF NOT EXISTS idx_screen_device_bindings_screen ON screen_device_bindings(screen_id, status);
          CREATE INDEX IF NOT EXISTS idx_screen_device_bindings_device ON screen_device_bindings(device_id, status);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_screen_device_bindings_active_screen ON screen_device_bindings(screen_id) WHERE status = 'active';
          CREATE UNIQUE INDEX IF NOT EXISTS idx_screen_device_bindings_active_device ON screen_device_bindings(device_id) WHERE status = 'active';
          CREATE INDEX IF NOT EXISTS idx_content_approvals_subject ON content_approvals(subject_type, subject_id, approval_status);
          CREATE INDEX IF NOT EXISTS idx_content_approvals_tenant_type ON content_approvals(tenant_id, content_type, approval_status);
          CREATE INDEX IF NOT EXISTS idx_content_approvals_scope_hash ON content_approvals(tenant_id, site_id, display_wall_id, content_hash, approval_status);
          CREATE INDEX IF NOT EXISTS idx_publish_history_content ON publish_history(content_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_publish_history_scope ON publish_history(tenant_id, site_id, display_wall_id, created_at DESC);
        `);

        addColumnIfMissing("content_manifests", "tenant_id", "TEXT");
        addColumnIfMissing("content_manifests", "site_id", "TEXT");
        addColumnIfMissing("content_manifests", "display_wall_id", "TEXT");
        addColumnIfMissing("content_manifests", "screen_id", "TEXT");
        addColumnIfMissing("content_manifests", "manifest_schema_version", "INTEGER NOT NULL DEFAULT 1");
        addColumnIfMissing("content_manifests", "manifest_version", "INTEGER NOT NULL DEFAULT 1");
        addColumnIfMissing("content_manifests", "content_hash", "TEXT NOT NULL DEFAULT ''");
        addColumnIfMissing("content_manifests", "lifecycle_status", "TEXT NOT NULL DEFAULT 'draft'");

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_content_manifests_scope ON content_manifests(tenant_id, site_id, display_wall_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_content_manifests_hash ON content_manifests(content_hash);
        `);
      }
    }
  ];
}

function applySchemaMigrations() {
  const appliedVersions = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version)
  );

  for (const migration of schemaMigrations()) {
    if (appliedVersions.has(migration.version)) continue;
    const runMigration = db.transaction(() => {
      migration.up();
      db.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, nowIso());
    });
    runMigration();
    appliedVersions.add(migration.version);
  }
}

function migrateDevicesTable() {
  const columns = [
    ["token_status", "TEXT NOT NULL DEFAULT 'active'"],
    ["token_generation", "INTEGER NOT NULL DEFAULT 1"],
    ["token_rotated_at", "TEXT"],
    ["token_revoked_at", "TEXT"],
    ["token_revoked_reason", "TEXT"],
    ["token_last_used_at", "TEXT"],
    ["target_update_ref", "TEXT"],
    ["target_release_id", "TEXT"],
    ["target_release_channel", "TEXT"],
    ["update_manifest_id", "TEXT"],
    ["update_status", "TEXT NOT NULL DEFAULT 'idle'"],
    ["update_requested_at", "TEXT"],
    ["update_started_at", "TEXT"],
    ["update_completed_at", "TEXT"],
    ["update_last_checked_at", "TEXT"],
    ["update_error", "TEXT"]
  ];

  for (const [name, definition] of columns) {
    addColumnIfMissing("devices", name, definition);
  }

  const terminalDevices = db.prepare(`
    SELECT device_id, status, token_generation
    FROM devices
    WHERE status IN ('retired', 'lost')
      AND token_status != 'revoked'
  `).all();
  if (terminalDevices.length > 0) {
    const now = nowIso();
    const migrateTerminalTokens = db.transaction((devices) => {
      for (const device of devices) {
        const reason = `migration: device status ${device.status}`;
        db.prepare(`
          UPDATE devices SET
            token_status = 'revoked',
            token_revoked_at = COALESCE(token_revoked_at, ?),
            token_revoked_reason = COALESCE(NULLIF(token_revoked_reason, ''), ?),
            updated_at = ?
          WHERE device_id = ?
        `).run(now, reason, now, device.device_id);
        recordDeviceTokenEvent(device.device_id, "revoked", reason, now, device.token_generation || 1);
      }
    });
    migrateTerminalTokens(terminalDevices);
  }
}

function addColumnIfMissing(tableName, columnName, definition) {
  const table = cleanSqlIdentifier(tableName);
  const column = cleanSqlIdentifier(columnName);
  const existingColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!existingColumns.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function cleanSqlIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return identifier;
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

function normalizeDeviceTokenAction(input) {
  return {
    reason: cleanString(input.reason || input.notes || input.note).slice(0, 1000)
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

function normalizeReleaseManifestInput(input, existing = {}) {
  const releaseId = cleanString(input.release_id ?? existing.release_id).slice(0, 120);
  if (!releaseId) {
    throw new Error("release_id is required");
  }

  const releaseChannel = cleanString(input.release_channel ?? existing.release_channel ?? "stable");
  if (!RELEASE_CHANNELS.has(releaseChannel)) {
    throw new Error(`release_channel must be one of: ${Array.from(RELEASE_CHANNELS).join(", ")}`);
  }

  const updateRef = cleanGitRef(input.update_ref || input.target_update_ref || input.ref || existing.update_ref);
  if (!updateRef) {
    throw new Error("update_ref is required");
  }

  const status = cleanString(input.status ?? existing.status ?? "draft");
  if (!RELEASE_MANIFEST_STATUS.has(status)) {
    throw new Error(`status must be one of: ${Array.from(RELEASE_MANIFEST_STATUS).join(", ")}`);
  }
  if (status === "active" && releaseChannel === "hold") {
    throw new Error("hold channel cannot have an active release manifest");
  }

  const manifestId = existing.manifest_id
    ? cleanId(existing.manifest_id)
    : cleanId(input.manifest_id || releaseId);
  if (!manifestId) {
    throw new Error("manifest_id is required");
  }

  return {
    manifest_id: manifestId,
    release_id: releaseId,
    release_channel: releaseChannel,
    update_ref: updateRef,
    app_version: cleanString(input.app_version ?? existing.app_version).slice(0, 80),
    status,
    notes: cleanString(input.notes ?? existing.notes).slice(0, 1000)
  };
}

function normalizeContentManifestInput(input, existing = {}) {
  const existingPlaylist = parseJson(existing.playlist_json, null);
  const playlist = normalizeCloudPlaylist(input.playlist || input.playlist_json || existingPlaylist);
  const playlistVersion = cleanString(input.playlist_version ?? playlist.playlist_version ?? existing.playlist_version).slice(0, 120);
  if (!playlistVersion) {
    throw new Error("playlist_version is required");
  }
  playlist.playlist_version = playlistVersion;

  const releaseChannel = cleanString(input.release_channel ?? existing.release_channel ?? "stable");
  if (!RELEASE_CHANNELS.has(releaseChannel)) {
    throw new Error(`release_channel must be one of: ${Array.from(RELEASE_CHANNELS).join(", ")}`);
  }

  const status = cleanString(input.status ?? existing.status ?? "draft");
  if (!CONTENT_MANIFEST_STATUS.has(status)) {
    throw new Error(`status must be one of: ${Array.from(CONTENT_MANIFEST_STATUS).join(", ")}`);
  }
  if (status === "active" && releaseChannel === "hold") {
    throw new Error("hold channel cannot have an active content manifest");
  }

  const contentId = existing.content_id
    ? cleanId(existing.content_id)
    : cleanId(input.content_id || playlistVersion);
  if (!contentId) {
    throw new Error("content_id is required");
  }

  const assetsSupplied = Object.prototype.hasOwnProperty.call(input, "assets") ||
    Object.prototype.hasOwnProperty.call(input, "asset_ids") ||
    Object.prototype.hasOwnProperty.call(input, "assetIds");
  const assets = assetsSupplied ? normalizeContentManifestAssets(input.assets ?? input.asset_ids ?? input.assetIds) : [];
  const hashAssets = assetsSupplied
    ? assets
    : (existing.content_id ? listContentManifestAssets(existing.content_id).map((asset) => ({
      asset_id: asset.asset_id,
      target_path: asset.target_path,
      required: asset.required,
      sha256: asset.sha256
    })) : []);
  const tenantId = cleanId(input.tenant_id ?? input.tenantId ?? existing.tenant_id);
  const siteId = cleanId(input.site_id ?? input.siteId ?? input.store_id ?? input.storeId ?? existing.site_id);
  const displayWallId = cleanId(input.display_wall_id ?? input.displayWallId ?? input.screen_group_id ?? input.screenGroupId ?? existing.display_wall_id);
  const screenId = cleanId(input.screen_id ?? input.screenId ?? existing.screen_id);
  const manifestSchemaVersion = Math.max(1, asInteger(input.manifest_schema_version ?? input.manifestSchemaVersion ?? existing.manifest_schema_version) || 1);
  const manifestVersion = Math.max(1, asInteger(input.manifest_version ?? input.manifestVersion ?? existing.manifest_version) || 1);
  const lifecycleStatus = cleanString(input.lifecycle_status ?? input.lifecycleStatus ?? existing.lifecycle_status ?? status) || status;
  const manifestContract = buildManifestContract({
    tenant_id: tenantId,
    site_id: siteId,
    display_wall_id: displayWallId,
    screen_id: screenId,
    manifest_schema_version: manifestSchemaVersion,
    manifest_version: manifestVersion,
    playlist,
    assets: hashAssets
  });

  return {
    content_id: contentId,
    playlist_version: playlistVersion,
    release_channel: releaseChannel,
    status,
    title: cleanString(input.title ?? existing.title).slice(0, 160),
    notes: cleanString(input.notes ?? existing.notes).slice(0, 1000),
    tenant_id: tenantId,
    site_id: siteId,
    display_wall_id: displayWallId,
    screen_id: screenId,
    manifest_schema_version: manifestSchemaVersion,
    manifest_version: manifestVersion,
    content_hash: cleanString(input.content_hash ?? input.contentHash) || manifestContract.content_hash,
    lifecycle_status: lifecycleStatus,
    playlist,
    assets,
    assets_supplied: assetsSupplied
  };
}

function normalizeContentManifestAssets(value) {
  if (value === undefined || value === null || value === "") return [];
  let source = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    source = trimmed.startsWith("[") ? parseJson(trimmed, null) : trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(source)) {
    throw new Error("assets must be an array");
  }

  const seen = new Set();
  return source.map((item, index) => {
    const raw = typeof item === "string" ? { asset_id: item } : (item || {});
    const assetId = cleanId(raw.asset_id || raw.assetId);
    if (!assetId) {
      throw new Error(`assets[${index}].asset_id is required`);
    }
    if (seen.has(assetId)) {
      throw new Error(`assets[${index}].asset_id is duplicated`);
    }
    seen.add(assetId);

    const asset = getCloudAsset(assetId);
    if (!asset) {
      throw new Error(`assets[${index}].asset_id was not found`);
    }

    return {
      asset_id: assetId,
      target_path: normalizeContentAssetTargetPath(raw.target_path || raw.targetPath, asset, index),
      required: raw.required !== false
    };
  });
}

function normalizeContentAssetTargetPath(value, asset, index) {
  const targetPath = cleanString(value) || defaultContentAssetTargetPath(asset);
  const prefix = asset.type === "video" ? "/assets/videos/" : "/assets/images/";
  if (!targetPath.startsWith(prefix)) {
    throw new Error(`assets[${index}].target_path must start with ${prefix}`);
  }
  if (targetPath.includes("..") || targetPath.includes("\\") || targetPath.includes("?") || targetPath.includes("#")) {
    throw new Error(`assets[${index}].target_path is invalid`);
  }
  const filename = targetPath.slice(prefix.length);
  if (!filename || filename.includes("/") || !/^[a-zA-Z0-9_.:-]+$/.test(filename)) {
    throw new Error(`assets[${index}].target_path must end with a safe filename`);
  }
  return targetPath;
}

function defaultContentAssetTargetPath(asset) {
  const prefix = asset.type === "video" ? "/assets/videos" : "/assets/images";
  return `${prefix}/${asset.filename}`;
}

function normalizeCloudPlaylist(value) {
  const source = typeof value === "string" ? parseJson(value, null) : value;
  if (!source || typeof source !== "object") {
    throw new Error("playlist must be an object");
  }
  if (!Array.isArray(source.items)) {
    throw new Error("playlist.items must be an array");
  }

  const playlist = {
    version: Number(source.version || 1),
    playlist_version: cleanString(source.playlist_version),
    updatedAt: cleanString(source.updatedAt) || nowIso(),
    items: source.items.map((item, index) => normalizeCloudPlaylistItem(item, index))
  };
  if (!playlist.playlist_version) {
    playlist.playlist_version = `pl-${compactTimestamp()}`;
  }
  return playlist;
}

function normalizeCloudPlaylistItem(item, index) {
  const value = item || {};
  const layout = value.layout === "wide" ? "wide" : "three-zone";
  const id = cleanId(value.item_id || value.id || `item-${Date.now()}-${index + 1}`);
  const normalized = {
    id,
    item_id: id,
    name: cleanString(value.name || id).slice(0, 160),
    enabled: value.enabled !== false,
    layout,
    duration: normalizedLimit(value.duration, 10, 1, 300),
    start: cleanString(value.start),
    end: cleanString(value.end),
    days_of_week: normalizeDaysOfWeek(value.days_of_week),
    campaign_id: cleanString(value.campaign_id).slice(0, 120),
    asset_id: cleanString(value.asset_id).slice(0, 120),
    priority: normalizedLimit(value.priority, 0, 0, 100),
    left: cleanString(value.left),
    center: cleanString(value.center),
    right: cleanString(value.right),
    wide: cleanString(value.wide)
  };

  if (normalized.start && !isValidScheduleTime(normalized.start)) {
    throw new Error(`items[${index}].start must be HH:mm or empty`);
  }
  if (normalized.end && !isValidScheduleTime(normalized.end)) {
    throw new Error(`items[${index}].end must be HH:mm or empty`);
  }

  if (layout === "wide") {
    validateCloudSource(`items[${index}].wide`, normalized.wide, normalized.enabled);
  } else {
    validateCloudSource(`items[${index}].left`, normalized.left, normalized.enabled);
    validateCloudSource(`items[${index}].center`, normalized.center, normalized.enabled);
    validateCloudSource(`items[${index}].right`, normalized.right, normalized.enabled);
  }
  return normalized;
}

function validateCloudSource(label, source, required) {
  const value = cleanString(source);
  if (!value) {
    if (required) throw new Error(`${label} is required for enabled playlist items`);
    return;
  }
  if (value.includes("..")) {
    throw new Error(`${label} cannot contain '..'`);
  }
  if (value.startsWith("/assets/images/") || value.startsWith("/assets/videos/") || value.startsWith("/demo/")) {
    return;
  }
  throw new Error(`${label} must be an /assets/images, /assets/videos, or /demo path`);
}

function normalizeDaysOfWeek(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
  return value
    .map((day) => cleanString(day).toLowerCase())
    .filter((day, index, days) => allowed.has(day) && days.indexOf(day) === index);
}

function isValidScheduleTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
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
    target_manifest_id: cleanId(input.target_manifest_id || input.manifest_id),
    target_update_ref: cleanGitRef(input.target_update_ref || input.target_ref || input.ref),
    target_release_id: cleanString(input.target_release_id || input.release_id).slice(0, 120),
    release_id: cleanString(input.release_id).slice(0, 120),
    release_channel: releaseChannel,
    previous_release_id: cleanString(input.previous_release_id).slice(0, 120),
    message: cleanString(input.message || input.error).slice(0, 1000)
  };
}

function normalizeDeviceContentResult(input) {
  const status = cleanString(input.status);
  if (!UPDATE_RESULT_STATUS.has(status)) {
    throw new Error(`status must be one of: ${Array.from(UPDATE_RESULT_STATUS).join(", ")}`);
  }
  return {
    status,
    content_id: cleanId(input.content_id || input.manifest_id),
    playlist_version: cleanString(input.playlist_version).slice(0, 120),
    message: cleanString(input.message || input.error).slice(0, 1000)
  };
}

function normalizeDeviceAssetResult(input) {
  const status = cleanString(input.status);
  if (!ASSET_SYNC_RESULT_STATUS.has(status)) {
    throw new Error(`status must be one of: ${Array.from(ASSET_SYNC_RESULT_STATUS).join(", ")}`);
  }
  const assetId = cleanId(input.asset_id || input.assetId);
  if (!assetId) {
    throw new Error("asset_id is required");
  }
  return {
    status,
    content_id: cleanId(input.content_id || input.manifest_id),
    asset_id: assetId,
    target_path: cleanString(input.target_path || input.targetPath).slice(0, 240),
    local_path: cleanString(input.local_path || input.localPath).slice(0, 500),
    sha256: cleanString(input.sha256).slice(0, 80),
    size: asInteger(input.size),
    message: cleanString(input.message || input.error).slice(0, 1000)
  };
}

function normalizeDeviceLogBundle(device, payload, receivedAt) {
  const entriesInput = Array.isArray(payload.entries) ? payload.entries.slice(0, DEVICE_LOG_MAX_ENTRIES) : [];
  const entries = [];
  let totalBytes = 0;

  for (const entry of entriesInput) {
    if (!entry || typeof entry !== "object") continue;
    if (totalBytes >= DEVICE_LOG_TOTAL_MAX_BYTES) break;

    const name = cleanLogEntryName(entry.name || entry.filename || "log");
    const filename = cleanLogEntryName(entry.filename || name);
    const command = cleanString(entry.command).slice(0, 300);
    const kind = cleanString(entry.kind || "text").slice(0, 40);
    const originalText = cleanText(entry.content || entry.text || entry.output);
    const originalBytes = Buffer.byteLength(originalText, "utf8");
    const remainingBytes = DEVICE_LOG_TOTAL_MAX_BYTES - totalBytes;
    const maxBytes = Math.min(DEVICE_LOG_ENTRY_MAX_BYTES, remainingBytes);
    const truncated = truncateTextByBytes(originalText, maxBytes);
    const contentBytes = Buffer.byteLength(truncated.value, "utf8");

    entries.push({
      name,
      filename,
      kind,
      command,
      content: truncated.value,
      bytes: contentBytes,
      original_bytes: originalBytes,
      truncated: Boolean(entry.truncated) || truncated.truncated || originalBytes > contentBytes
    });
    totalBytes += contentBytes;
  }

  const raw = {
    device_id: device.device_id,
    tenant_id: device.tenant_id,
    store_id: device.store_id,
    location_id: device.location_id,
    screen_group_id: device.screen_group_id,
    captured_at: cleanString(payload.captured_at || payload.timestamp || receivedAt),
    label: cleanString(payload.label || payload.title || "manual").slice(0, 120),
    reason: cleanString(payload.reason || payload.message || "").slice(0, 1000),
    source: cleanString(payload.source || "device").slice(0, 80),
    hostname: cleanString(payload.hostname).slice(0, 120),
    app_version: cleanString(payload.app_version).slice(0, 80),
    release_id: cleanString(payload.release_id).slice(0, 120),
    release_channel: cleanString(payload.release_channel || device.release_channel).slice(0, 40),
    entries
  };

  return {
    captured_at: raw.captured_at,
    label: raw.label,
    reason: raw.reason,
    source: raw.source,
    hostname: raw.hostname,
    app_version: raw.app_version,
    release_id: raw.release_id,
    release_channel: raw.release_channel,
    entry_count: entries.length,
    total_bytes: totalBytes,
    raw
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
    token_events: db.prepare("SELECT * FROM device_token_events WHERE device_id = ? ORDER BY created_at DESC LIMIT 50").all(deviceId),
    log_bundles: listDeviceLogBundles(deviceId, 20),
    asset_states: listDeviceAssetStates(deviceId, 50),
    heartbeats: db.prepare("SELECT * FROM heartbeats WHERE device_id = ? ORDER BY received_at DESC LIMIT 100").all(deviceId),
    playlogs: db.prepare("SELECT * FROM playlogs WHERE device_id = ? ORDER BY received_at DESC LIMIT 50").all(deviceId),
    error_logs: db.prepare("SELECT * FROM error_logs WHERE device_id = ? ORDER BY received_at DESC LIMIT 50").all(deviceId),
    alerts: db.prepare("SELECT * FROM alerts WHERE device_id = ? AND status = 'open' ORDER BY last_seen DESC").all(deviceId)
  };
}

function listDeviceLogBundles(deviceId = "", limit = 50) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 50, 100));
  const rows = deviceId
    ? db.prepare(`
      SELECT * FROM device_log_bundles
      WHERE device_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(deviceId, boundedLimit)
    : db.prepare(`
      SELECT * FROM device_log_bundles
      ORDER BY received_at DESC
      LIMIT ?
    `).all(boundedLimit);
  return rows.map(publicDeviceLogBundle);
}

function getDeviceLogBundle(id) {
  if (!id) return null;
  const row = db.prepare("SELECT * FROM device_log_bundles WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...publicDeviceLogBundle(row),
    payload: parseJson(row.raw_json, {})
  };
}

function publicDeviceLogBundle(row) {
  const { raw_json, ...publicFields } = row;
  return publicFields;
}

function listDeviceAssetStates(deviceId, limit = 50) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 50, 100));
  return db.prepare(`
    SELECT * FROM device_asset_states
    WHERE device_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(cleanId(deviceId), boundedLimit).map(publicDeviceAssetState);
}

function listCloudAssets(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM cloud_assets
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(boundedLimit).map(publicCloudAsset);
}

function getCloudAsset(assetId, options = {}) {
  const row = db.prepare("SELECT * FROM cloud_assets WHERE asset_id = ?").get(cleanId(assetId));
  return row ? publicCloudAsset(row, options) : null;
}

function publicCloudAsset(row, options = {}) {
  const asset = {
    id: row.id,
    asset_id: cleanString(row.asset_id),
    type: cleanString(row.type),
    filename: cleanString(row.filename),
    original_name: cleanString(row.original_name),
    label: cleanString(row.label),
    notes: cleanString(row.notes),
    mime_type: cleanString(row.mime_type),
    size: asInteger(row.size) || 0,
    sha256: cleanString(row.sha256),
    download_path: cleanString(row.download_path),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
  if (options.includeStoragePath) {
    asset.storage_path = normalizedCloudAssetPath(row.storage_path);
  }
  return asset;
}

function createCloudAsset(file, body) {
  if (!file) {
    throw requestError("asset file is required", 400);
  }

  const info = normalizeCloudAssetFile(file);
  const bytes = fs.readFileSync(file.path);
  validateCloudAssetHeader(info.extension, bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const requestedAssetId = cleanId(body.asset_id || body.assetId);
  const assetId = requestedAssetId || nextCloudAssetId(body.label || file.originalname);
  if (!assetId) {
    throw requestError("asset_id is required", 400);
  }
  const existing = db.prepare("SELECT asset_id FROM cloud_assets WHERE asset_id = ?").get(assetId);
  if (existing) {
    throw requestError("Asset already exists", 409);
  }

  const filename = `${assetId}${info.extension}`;
  const storagePath = normalizedCloudAssetPath(path.join(CLOUD_ASSETS_DIR, filename));
  if (fs.existsSync(storagePath)) {
    throw requestError("Asset storage file already exists", 409);
  }

  fs.renameSync(file.path, storagePath);

  const now = nowIso();
  try {
    fs.chmodSync(storagePath, 0o644);
    db.prepare(`
      INSERT INTO cloud_assets (
        asset_id, type, filename, original_name, label, notes, mime_type,
        size, sha256, storage_path, download_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assetId,
      info.type,
      filename,
      cleanString(file.originalname).slice(0, 240) || filename,
      cleanString(body.label || body.name).slice(0, 160),
      cleanString(body.notes).slice(0, 1000),
      info.mimeType,
      file.size,
      sha256,
      storagePath,
      `/api/admin/assets/${encodeURIComponent(assetId)}/download`,
      now,
      now
    );
  } catch (error) {
    fs.rmSync(storagePath, { force: true });
    throw error;
  }

  return getCloudAsset(assetId);
}

function normalizeCloudAssetFile(file) {
  const extension = path.extname(file.originalname || file.filename || "").toLowerCase();
  if (!CLOUD_ASSET_EXTENSIONS.has(extension)) {
    throw requestError("asset must be a jpg, png, mp4, or webm file", 400);
  }
  const allowedMimes = CLOUD_ASSET_MIME_BY_EXTENSION.get(extension);
  const mimeType = cleanString(file.mimetype).toLowerCase();
  if (!allowedMimes?.has(mimeType)) {
    throw requestError(`asset MIME type must match ${extension}`, 400);
  }
  return {
    extension,
    mimeType,
    type: CLOUD_ASSET_TYPE_BY_EXTENSION.get(extension) || "file"
  };
}

function validateCloudAssetHeader(extension, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) {
    throw requestError("asset file is empty or invalid", 400);
  }
  if (extension === ".png") {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw requestError("png asset has an invalid file signature", 400);
    }
    return;
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw requestError("jpeg asset has an invalid file signature", 400);
    }
    return;
  }
  if (extension === ".mp4") {
    if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") {
      throw requestError("mp4 asset has an invalid file signature", 400);
    }
    return;
  }
  if (extension === ".webm") {
    if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
      throw requestError("webm asset has an invalid file signature", 400);
    }
  }
}

function nextCloudAssetId(seed = "") {
  const base = cleanId(seed || "asset").slice(0, 48) || "asset";
  return cleanId(`${base}-${compactTimestamp()}-${crypto.randomBytes(4).toString("hex")}`);
}

function normalizedCloudAssetPath(value) {
  const resolved = path.resolve(value);
  const root = path.resolve(CLOUD_ASSETS_DIR);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw requestError("asset storage path is invalid", 400);
  }
  return resolved;
}

function cleanupUploadedFile(file) {
  if (file?.path) {
    fs.rmSync(file.path, { force: true });
  }
}

function normalizeCloudAssetUploadError(error) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return requestError(`asset must be ${CLOUD_ASSET_MAX_MB} MB or less`, 413);
  }
  return requestError(error.message || "asset upload failed", error.status || 400);
}

function listCloudAssetManifestUsage(assetId) {
  return db.prepare(`
    SELECT
      cma.asset_id,
      cma.target_path,
      cm.content_id,
      cm.playlist_version,
      cm.release_channel,
      cm.status,
      cm.updated_at
    FROM content_manifest_assets cma
    JOIN content_manifests cm ON cm.content_id = cma.content_id
    WHERE cma.asset_id = ?
    ORDER BY
      CASE cm.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      cm.updated_at DESC
  `).all(cleanId(assetId)).map((row) => ({
    asset_id: cleanString(row.asset_id),
    target_path: cleanString(row.target_path),
    content_id: cleanString(row.content_id),
    playlist_version: cleanString(row.playlist_version),
    release_channel: cleanString(row.release_channel),
    status: cleanString(row.status),
    updated_at: cleanString(row.updated_at)
  }));
}

function listReleaseManifests(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM release_manifests
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      updated_at DESC,
      id DESC
    LIMIT ?
  `).all(boundedLimit).map(publicReleaseManifest);
}

function getReleaseManifest(manifestId) {
  const row = db.prepare("SELECT * FROM release_manifests WHERE manifest_id = ?").get(cleanId(manifestId));
  return row ? publicReleaseManifest(row) : null;
}

function getActiveReleaseManifest(releaseChannel) {
  const channel = cleanString(releaseChannel);
  if (!RELEASE_CHANNELS.has(channel) || channel === "hold") return null;
  const row = db.prepare(`
    SELECT * FROM release_manifests
    WHERE release_channel = ?
      AND status = 'active'
    ORDER BY published_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `).get(channel);
  return row ? publicReleaseManifest(row) : null;
}

function retireActiveReleaseManifests(releaseChannel, now, exceptManifestId = "") {
  const channel = cleanString(releaseChannel);
  if (!RELEASE_CHANNELS.has(channel) || channel === "hold") return;
  db.prepare(`
    UPDATE release_manifests
    SET status = 'retired', updated_at = ?
    WHERE release_channel = ?
      AND status = 'active'
      AND manifest_id != ?
  `).run(now, channel, cleanId(exceptManifestId));
}

function publicReleaseManifest(row) {
  return {
    id: row.id,
    manifest_id: cleanString(row.manifest_id),
    release_id: cleanString(row.release_id),
    release_channel: cleanString(row.release_channel),
    update_ref: cleanString(row.update_ref),
    app_version: cleanString(row.app_version),
    status: cleanString(row.status),
    notes: cleanString(row.notes),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    published_at: cleanString(row.published_at)
  };
}

function listContentManifests(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM content_manifests
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      updated_at DESC,
      id DESC
    LIMIT ?
  `).all(boundedLimit).map((row) => publicContentManifest(row, true));
}

function getContentManifest(contentId, includePlaylist = false) {
  const row = db.prepare("SELECT * FROM content_manifests WHERE content_id = ?").get(cleanId(contentId));
  return row ? publicContentManifest(row, includePlaylist) : null;
}

function getActiveContentManifest(releaseChannel) {
  const channel = cleanString(releaseChannel);
  if (!RELEASE_CHANNELS.has(channel) || channel === "hold") return null;
  const row = db.prepare(`
    SELECT * FROM content_manifests
    WHERE release_channel = ?
      AND status = 'active'
    ORDER BY published_at DESC, updated_at DESC, id DESC
    LIMIT 1
  `).get(channel);
  return row ? publicContentManifest(row, true) : null;
}

function retireActiveContentManifests(releaseChannel, now, exceptContentId = "") {
  const channel = cleanString(releaseChannel);
  if (!RELEASE_CHANNELS.has(channel) || channel === "hold") return;
  db.prepare(`
    UPDATE content_manifests
    SET status = 'retired', updated_at = ?
    WHERE release_channel = ?
      AND status = 'active'
      AND content_id != ?
  `).run(now, channel, cleanId(exceptContentId));
}

function replaceContentManifestAssets(contentId, assets, now) {
  const normalizedContentId = cleanId(contentId);
  db.prepare("DELETE FROM content_manifest_assets WHERE content_id = ?").run(normalizedContentId);
  for (const asset of assets || []) {
    db.prepare(`
      INSERT INTO content_manifest_assets (
        content_id, asset_id, target_path, required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      normalizedContentId,
      asset.asset_id,
      asset.target_path,
      asset.required ? 1 : 0,
      now,
      now
    );
  }
}

function listContentManifestAssets(contentId) {
  return db.prepare(`
    SELECT
      cma.id AS manifest_asset_id,
      cma.content_id,
      cma.asset_id,
      cma.target_path,
      cma.required,
      cma.created_at AS linked_at,
      cma.updated_at AS link_updated_at,
      ca.id AS cloud_asset_row_id,
      ca.type,
      ca.filename,
      ca.original_name,
      ca.label,
      ca.notes,
      ca.mime_type,
      ca.size,
      ca.sha256,
      ca.download_path,
      ca.created_at AS asset_created_at,
      ca.updated_at AS asset_updated_at
    FROM content_manifest_assets cma
    JOIN cloud_assets ca ON ca.asset_id = cma.asset_id
    WHERE cma.content_id = ?
    ORDER BY cma.id ASC
  `).all(cleanId(contentId)).map(publicContentManifestAsset);
}

function publicContentManifestAsset(row) {
  return {
    id: row.manifest_asset_id,
    content_id: cleanString(row.content_id),
    asset_id: cleanString(row.asset_id),
    type: cleanString(row.type),
    filename: cleanString(row.filename),
    original_name: cleanString(row.original_name),
    label: cleanString(row.label),
    notes: cleanString(row.notes),
    mime_type: cleanString(row.mime_type),
    size: asInteger(row.size) || 0,
    sha256: cleanString(row.sha256),
    target_path: cleanString(row.target_path),
    required: row.required !== 0,
    download_url: `/api/device/assets/${encodeURIComponent(cleanString(row.asset_id))}/download`,
    admin_download_path: cleanString(row.download_path),
    linked_at: cleanString(row.linked_at),
    updated_at: cleanString(row.link_updated_at || row.asset_updated_at),
    asset_updated_at: cleanString(row.asset_updated_at),
    asset_created_at: cleanString(row.asset_created_at)
  };
}

function getDeviceContentManifestAsset(device, assetId) {
  const manifest = getActiveContentManifest(device.release_channel);
  if (!manifest) return null;
  const normalizedAssetId = cleanId(assetId);
  const asset = (manifest.assets || []).find((item) => item.asset_id === normalizedAssetId);
  return asset ? { ...asset, content_id: manifest.content_id } : null;
}

function getContentRollout(contentId) {
  const manifest = getContentManifest(contentId, true);
  if (!manifest) return null;

  const targetDevices = listDevices().filter((device) => (
    device.release_channel === manifest.release_channel &&
    !TERMINAL_STATUS.has(device.status)
  ));
  const states = listContentRolloutAssetStates(manifest.content_id);
  const stateByDeviceAsset = new Map(states.map((state) => [`${state.device_id}:${state.asset_id}`, state]));
  const devices = targetDevices.map((device) => buildContentRolloutDevice(manifest, device, stateByDeviceAsset));
  const summary = summarizeContentRollout(manifest, devices);

  return {
    content_manifest: {
      content_id: manifest.content_id,
      playlist_version: manifest.playlist_version,
      release_channel: manifest.release_channel,
      status: manifest.status,
      title: manifest.title,
      notes: manifest.notes,
      published_at: manifest.published_at,
      updated_at: manifest.updated_at,
      asset_count: manifest.assets.length,
      item_count: Array.isArray(manifest.playlist?.items) ? manifest.playlist.items.length : 0
    },
    summary,
    assets: manifest.assets,
    devices
  };
}

function retryContentRolloutDevice(contentId, deviceId) {
  const manifest = getContentManifest(contentId, true);
  const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(cleanId(deviceId));
  if (!manifest || !device) return null;
  if (device.release_channel !== manifest.release_channel) {
    return { error: "Device is not in this content manifest release channel" };
  }

  const now = nowIso();
  const retryStates = db.transaction(() => {
    for (const asset of manifest.assets) {
      db.prepare(`
        INSERT INTO device_asset_states (
          device_id, content_id, asset_id, status, target_path, local_path,
          sha256, size, message, updated_at
        ) VALUES (?, ?, ?, 'checking', ?, '', ?, ?, 'retry requested by admin', ?)
        ON CONFLICT(device_id, content_id, asset_id) DO UPDATE SET
          status = 'checking',
          target_path = excluded.target_path,
          local_path = '',
          sha256 = excluded.sha256,
          size = excluded.size,
          message = excluded.message,
          updated_at = excluded.updated_at
      `).run(
        device.device_id,
        manifest.content_id,
        asset.asset_id,
        asset.target_path,
        asset.sha256,
        asset.size,
        now
      );
    }
    db.prepare("UPDATE devices SET updated_at = ? WHERE device_id = ?")
      .run(now, device.device_id);
  });
  retryStates();

  return { rollout: getContentRollout(manifest.content_id) };
}

function listContentRolloutAssetStates(contentId) {
  return db.prepare(`
    SELECT * FROM device_asset_states
    WHERE content_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(cleanId(contentId)).map(publicDeviceAssetState);
}

function publicDeviceAssetState(row) {
  return {
    id: row.id,
    device_id: cleanString(row.device_id),
    content_id: cleanString(row.content_id),
    asset_id: cleanString(row.asset_id),
    status: cleanString(row.status),
    target_path: cleanString(row.target_path),
    local_path: cleanString(row.local_path),
    sha256: cleanString(row.sha256),
    size: asInteger(row.size),
    message: cleanString(row.message),
    updated_at: cleanString(row.updated_at)
  };
}

function buildContentRolloutDevice(manifest, device, stateByDeviceAsset) {
  const playlistReady = cleanString(device.playlist_version) === manifest.playlist_version;
  const assetStates = manifest.assets.map((asset) => {
    const state = stateByDeviceAsset.get(`${device.device_id}:${asset.asset_id}`);
    const status = cleanString(state?.status) || "missing";
    const shaMatches = status === "ready" && cleanString(state?.sha256) === asset.sha256;
    return {
      asset_id: asset.asset_id,
      target_path: asset.target_path,
      expected_sha256: asset.sha256,
      expected_size: asset.size,
      required: asset.required,
      status,
      ready: shaMatches,
      sha256: cleanString(state?.sha256),
      size: asInteger(state?.size),
      local_path: cleanString(state?.local_path),
      message: cleanString(state?.message),
      updated_at: cleanString(state?.updated_at)
    };
  });
  const failed = assetStates.some((state) => state.status === "failed");
  const updating = assetStates.some((state) => state.status === "checking" || state.status === "downloading");
  const requiredAssets = assetStates.filter((state) => state.required !== false);
  const assetsReady = requiredAssets.every((state) => state.ready);
  const rolloutStatus = failed
    ? "failed"
    : (updating ? "updating" : (playlistReady && assetsReady ? "ready" : "pending"));

  return {
    device_id: device.device_id,
    device_name: cleanString(device.device_name),
    tenant_id: cleanString(device.tenant_id),
    store_id: cleanString(device.store_id),
    location_id: cleanString(device.location_id),
    screen_group_id: cleanString(device.screen_group_id),
    effective_status: cleanString(device.effective_status || device.status),
    release_channel: cleanString(device.release_channel),
    current_playlist_version: cleanString(device.playlist_version),
    target_playlist_version: manifest.playlist_version,
    playlist_ready: playlistReady,
    assets_ready: assetsReady,
    rollout_status: rolloutStatus,
    last_seen: cleanString(device.last_seen),
    last_error: cleanString(device.last_error),
    asset_states: assetStates
  };
}

function summarizeContentRollout(manifest, devices) {
  const summary = {
    target_devices: devices.length,
    ready: 0,
    pending: 0,
    updating: 0,
    failed: 0,
    playlist_ready: 0,
    assets_ready: 0,
    asset_count: manifest.assets.length,
    required_asset_count: manifest.assets.filter((asset) => asset.required !== false).length
  };
  for (const device of devices) {
    summary[device.rollout_status] = (summary[device.rollout_status] || 0) + 1;
    if (device.playlist_ready) summary.playlist_ready += 1;
    if (device.assets_ready) summary.assets_ready += 1;
  }
  return summary;
}

function publicContentManifest(row, includePlaylist = false) {
  const publicFields = {
    id: row.id,
    content_id: cleanString(row.content_id),
    playlist_version: cleanString(row.playlist_version),
    release_channel: cleanString(row.release_channel),
    status: cleanString(row.status),
    title: cleanString(row.title),
    notes: cleanString(row.notes),
    tenant_id: cleanString(row.tenant_id),
    site_id: cleanString(row.site_id),
    display_wall_id: cleanString(row.display_wall_id),
    screen_id: cleanString(row.screen_id),
    manifest_schema_version: asInteger(row.manifest_schema_version) || 1,
    manifest_version: asInteger(row.manifest_version) || 1,
    content_hash: cleanString(row.content_hash),
    lifecycle_status: cleanString(row.lifecycle_status || row.status),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    published_at: cleanString(row.published_at)
  };
  publicFields.assets = listContentManifestAssets(row.content_id);
  if (includePlaylist) {
    publicFields.playlist = parseJson(row.playlist_json, null);
  }
  return publicFields;
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
  const explicitTargetRef = cleanString(device.target_update_ref);
  const manifest = explicitTargetRef ? null : getActiveReleaseManifest(device.release_channel);
  const source = explicitTargetRef ? "device" : (manifest ? "release_manifest" : "none");
  const targetRef = explicitTargetRef || cleanString(manifest?.update_ref);
  const targetReleaseId = cleanString(device.target_release_id) || cleanString(manifest?.release_id) || targetRef;
  const targetReleaseChannel = cleanString(device.target_release_channel) || cleanString(manifest?.release_channel);
  const targetManifestId = manifest ? cleanString(manifest.manifest_id) : cleanString(device.update_manifest_id);
  const currentReleaseId = cleanString(device.release_id);
  const required = Boolean(targetRef && targetReleaseId && currentReleaseId !== targetReleaseId);
  let status = cleanString(device.update_status) || "idle";
  if (targetRef && targetReleaseId && currentReleaseId === targetReleaseId) {
    status = "success";
  } else if (required && (status === "idle" || status === "success")) {
    status = "pending";
  }

  return {
    required,
    status,
    source,
    target_manifest_id: targetManifestId,
    target_update_ref: targetRef,
    target_release_id: targetReleaseId,
    target_release_channel: targetReleaseChannel,
    target_app_version: cleanString(manifest?.app_version),
    requested_at: cleanString(device.update_requested_at) || cleanString(manifest?.published_at) || cleanString(manifest?.updated_at),
    started_at: cleanString(device.update_started_at),
    completed_at: cleanString(device.update_completed_at),
    last_checked_at: cleanString(device.update_last_checked_at),
    error: cleanString(device.update_error),
    manifest
  };
}

function buildDeviceContentPolicy(device) {
  const manifest = getActiveContentManifest(device.release_channel);
  const currentPlaylistVersion = cleanString(device.playlist_version);
  const targetPlaylistVersion = cleanString(manifest?.playlist_version);
  const required = Boolean(manifest && targetPlaylistVersion && currentPlaylistVersion !== targetPlaylistVersion);
  return {
    required,
    status: required ? "pending" : "idle",
    source: manifest ? "content_manifest" : "none",
    content_id: cleanString(manifest?.content_id),
    playlist_version: targetPlaylistVersion,
    manifest_schema_version: asInteger(manifest?.manifest_schema_version) || 1,
    manifest_version: asInteger(manifest?.manifest_version) || 1,
    content_hash: cleanString(manifest?.content_hash),
    tenant_id: cleanString(manifest?.tenant_id),
    site_id: cleanString(manifest?.site_id),
    display_wall_id: cleanString(manifest?.display_wall_id),
    screen_id: cleanString(manifest?.screen_id),
    release_channel: cleanString(manifest?.release_channel),
    published_at: cleanString(manifest?.published_at),
    assets: manifest ? manifest.assets || [] : [],
    playlist: required ? manifest.playlist : null
  };
}

function syncUpdateStatusFromHeartbeat(deviceId, heartbeat, now) {
  const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
  if (!device) return;

  let targetReleaseId = cleanString(device.target_release_id) || cleanString(device.target_update_ref);
  let targetManifestId = cleanString(device.update_manifest_id);
  if (!targetReleaseId) {
    const manifest = getActiveReleaseManifest(device.release_channel);
    targetReleaseId = cleanString(manifest?.release_id);
    targetManifestId = cleanString(manifest?.manifest_id);
  }
  if (!targetReleaseId) return;
  if (cleanString(heartbeat.release_id) !== targetReleaseId) return;

  db.prepare(`
    UPDATE devices SET
      update_status = 'success',
      update_completed_at = COALESCE(update_completed_at, ?),
      update_error = '',
      update_manifest_id = COALESCE(NULLIF(?, ''), update_manifest_id),
      updated_at = ?
    WHERE device_id = ?
  `).run(now, targetManifestId, now, deviceId);
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
  const existing = db.prepare("SELECT * FROM alerts WHERE device_id = ? AND alert_type = ? AND status = 'open'").get(deviceId, type);
  if (existing) {
    db.prepare("UPDATE alerts SET severity = ?, message = ?, last_seen = ?, metadata_json = ? WHERE id = ?")
      .run(severity, message, now, JSON.stringify(metadata || {}), existing.id);
    if (existing.severity !== severity) {
      scheduleAlertNotification({
        ...existing,
        severity,
        message,
        last_seen: now,
        metadata_json: JSON.stringify(metadata || {})
      }, "updated");
    }
    return;
  }
  const result = db.prepare(`
    INSERT INTO alerts (device_id, tenant_id, store_id, severity, alert_type, message, first_seen, last_seen, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deviceId, tenantId, storeId, severity, type, message, now, now, JSON.stringify(metadata || {}));
  scheduleAlertNotification(db.prepare("SELECT * FROM alerts WHERE id = ?").get(result.lastInsertRowid), "opened");
}

function resolveAlert(deviceId, type, now) {
  const alerts = db.prepare("SELECT * FROM alerts WHERE device_id = ? AND alert_type = ? AND status = 'open'").all(deviceId, type);
  if (alerts.length === 0) return;
  db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ?, last_seen = ? WHERE device_id = ? AND alert_type = ? AND status = 'open'")
    .run(now, now, deviceId, type);
  for (const alert of alerts) {
    scheduleAlertNotification({
      ...alert,
      status: "resolved",
      resolved_at: now,
      last_seen: now
    }, "resolved");
  }
}

function resolveDeviceAlerts(deviceId, now) {
  const alerts = db.prepare("SELECT * FROM alerts WHERE device_id = ? AND status = 'open'").all(deviceId);
  if (alerts.length === 0) return;
  db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ?, last_seen = ? WHERE device_id = ? AND status = 'open'")
    .run(now, now, deviceId);
  for (const alert of alerts) {
    scheduleAlertNotification({
      ...alert,
      status: "resolved",
      resolved_at: now,
      last_seen: now
    }, "resolved");
  }
}

function alertNotificationConfig() {
  return {
    webhook_enabled: Boolean(ALERT_WEBHOOK_URL),
    min_severity: normalizedAlertWebhookMinSeverity(),
    notify_resolved: ALERT_WEBHOOK_NOTIFY_RESOLVED,
    timeout_ms: normalizedWebhookTimeoutMs()
  };
}

function scheduleAlertNotification(alert, event) {
  if (!alert || !shouldNotifyAlert(alert, event)) return;
  const now = nowIso();
  const payload = buildAlertWebhookPayload(alert, event);
  const notificationId = recordAlertNotification(alert.id || null, event, payload, now);
  setImmediate(() => {
    sendWebhookNotification(notificationId, payload).catch((error) => {
      markAlertNotificationFailed(notificationId, error);
    });
  });
}

function shouldNotifyAlert(alert, event) {
  if (!ALERT_WEBHOOK_URL) return false;
  if (!ALERT_EVENTS.has(event)) return false;
  if (event === "resolved" && !ALERT_WEBHOOK_NOTIFY_RESOLVED) return false;
  return severityRank(alert.severity) >= severityRank(normalizedAlertWebhookMinSeverity());
}

function buildAlertWebhookPayload(alert, event) {
  const title = `[Misell] ${event.toUpperCase()} ${alert.severity || "warning"} ${alert.alert_type || "alert"}`;
  const text = `${title}: ${alert.device_id || "unknown-device"} ${alert.message || ""}`.trim();
  return {
    text,
    content: text,
    event,
    alert: {
      id: alert.id || null,
      device_id: alert.device_id || "",
      tenant_id: alert.tenant_id || "",
      store_id: alert.store_id || "",
      severity: alert.severity || "",
      status: alert.status || "",
      alert_type: alert.alert_type || "",
      message: alert.message || "",
      first_seen: alert.first_seen || "",
      last_seen: alert.last_seen || "",
      resolved_at: alert.resolved_at || ""
    },
    cloud: {
      app: "misell-cloud",
      version: APP_VERSION,
      emitted_at: nowIso()
    }
  };
}

function recordAlertNotification(alertId, event, payload, now) {
  const normalizedEvent = ALERT_EVENTS.has(event) ? event : "updated";
  const result = db.prepare(`
    INSERT INTO alert_notifications (
      alert_id, event, channel, status, attempted_at, payload_json, created_at
    ) VALUES (?, ?, 'webhook', 'pending', ?, ?, ?)
  `).run(alertId, normalizedEvent, now, JSON.stringify(payload), now);
  return result.lastInsertRowid;
}

async function sendWebhookNotification(notificationId, payload) {
  if (!ALERT_WEBHOOK_URL) {
    markAlertNotificationFailed(notificationId, new Error("ALERT_WEBHOOK_URL is not configured"));
    return;
  }
  if (typeof fetch !== "function") {
    markAlertNotificationFailed(notificationId, new Error("fetch is not available in this Node.js runtime"));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalizedWebhookTimeoutMs());
  let responseStatus = null;
  try {
    const response = await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    responseStatus = response.status;
    if (!response.ok) {
      throw new Error(`Webhook returned HTTP ${response.status}`);
    }
    db.prepare(`
      UPDATE alert_notifications
      SET status = 'delivered', delivered_at = ?, response_status = ?, error = ''
      WHERE id = ?
    `).run(nowIso(), responseStatus, notificationId);
  } catch (error) {
    markAlertNotificationFailed(notificationId, error, responseStatus);
  } finally {
    clearTimeout(timeout);
  }
}

function markAlertNotificationFailed(notificationId, error, responseStatus = null) {
  db.prepare(`
    UPDATE alert_notifications
    SET status = 'failed', response_status = ?, error = ?
    WHERE id = ?
  `).run(responseStatus, cleanString(error?.message || String(error)).slice(0, 1000), notificationId);
}

function getAlertNotification(notificationId) {
  return db.prepare(`
    SELECT
      n.id,
      n.alert_id,
      n.event,
      n.channel,
      n.status,
      n.attempted_at,
      n.delivered_at,
      n.response_status,
      n.error,
      n.created_at
    FROM alert_notifications n
    WHERE n.id = ?
  `).get(notificationId);
}

function severityRank(severity) {
  const value = cleanString(severity);
  if (value === "critical") return 2;
  if (value === "warning") return 1;
  return 0;
}

function normalizedAlertWebhookMinSeverity() {
  const severity = cleanString(ALERT_WEBHOOK_MIN_SEVERITY);
  return severity === "critical" ? "critical" : "warning";
}

function normalizedWebhookTimeoutMs() {
  if (!Number.isFinite(ALERT_WEBHOOK_TIMEOUT_MS) || ALERT_WEBHOOK_TIMEOUT_MS < 1000) {
    return 5000;
  }
  return Math.min(ALERT_WEBHOOK_TIMEOUT_MS, 30000);
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

function recordDeviceTokenEvent(deviceId, event, reason, now, tokenGeneration) {
  db.prepare(`
    INSERT INTO device_token_events (device_id, event, token_generation, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(deviceId, event, tokenGeneration || null, cleanString(reason), now);
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

function generateDeviceToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashDeviceToken(token) {
  return crypto
    .createHash("sha256")
    .update(`${DEVICE_TOKEN_PEPPER}:${token}`)
    .digest("hex");
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function runtimePath(envName, fallbackPath) {
  const value = process.env[envName];
  if (!value) return fallbackPath;
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\0/g, "") : "";
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

function cleanLogEntryName(value) {
  const name = cleanString(value).replace(/[^a-zA-Z0-9_.:/-]/g, "-").slice(0, 120);
  return name || "log";
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

function truncateTextByBytes(value, maxBytes) {
  const text = cleanText(value);
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return { value: text, truncated: false };
  }
  if (maxBytes <= 32) {
    return { value: buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8"), truncated: true };
  }
  const headBytes = Math.floor(maxBytes * 0.4);
  const tailBytes = Math.max(0, maxBytes - headBytes - 28);
  return {
    value: `${buffer.subarray(0, headBytes).toString("utf8")}\n... truncated ...\n${buffer.subarray(buffer.length - tailBytes).toString("utf8")}`,
    truncated: true
  };
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

function normalizedLimit(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function nowIso() {
  return new Date().toISOString();
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
            <h2>トークン</h2>
            <pre>${escapeHtml(JSON.stringify({
              token_status: device.token_status,
              token_generation: device.token_generation,
              token_rotated_at: device.token_rotated_at,
              token_revoked_at: device.token_revoked_at,
              token_revoked_reason: device.token_revoked_reason,
              token_last_used_at: device.token_last_used_at
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
              update_manifest_id: device.update_manifest_id,
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
        <section class="section">
          <h2>ログ収集履歴</h2>
          <pre>${escapeHtml(JSON.stringify(device.log_bundles, null, 2))}</pre>
        </section>
        <section class="section">
          <h2>トークン履歴</h2>
          <pre>${escapeHtml(JSON.stringify(device.token_events, null, 2))}</pre>
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
