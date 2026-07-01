require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");
const express = require("express");
const basicAuth = require("express-basic-auth");
const multer = require("multer");
const { buildManifestContract } = require("./lib/studio-phase1-contract");
const {
  CONTEXT_CATEGORIES,
  VISIBILITY_SCOPES,
  SOURCE_OWNERS,
  SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  CONTEXT_RECORD_STATUSES,
  COST_OWNERS,
  DOCUMENT_PROCESSING_STATUSES,
  CONTEXT_SOURCE_IMAGE_MAX_BYTES,
  CONTEXT_SOURCE_PDF_MAX_BYTES,
  assertContextContract,
  assertCustomerWritableContext,
  assertContextSourceAssetContract,
  assertNoAutomaticExternalAi,
  buildContextSnapshotSourceSummary
} = require("./lib/ai-campaign-context-contract");
const {
  CAMPAIGN_PROJECT_STATUSES,
  CAMPAIGN_PROJECT_SCENE_STATUSES,
  CAMPAIGN_PROJECT_SOURCE_TYPES,
  normalizeCampaignBriefInput,
  normalizeSceneDraftInput,
  validateSceneDraft,
  assertNoOutOfScopeCampaignGeneratorInput
} = require("./lib/campaign-generator-contract");
const {
  CUT_PLAN_STATUSES,
  RENDERER_VERSION,
  QA_SUITE_VERSION,
  defaultLayoutTemplate,
  buildCutPlanContract,
  validateCutPlanContract,
  buildRenderManifestContract,
  runRenderQaContract
} = require("./lib/studio-cut-plan-render-contract");
const {
  PROVIDER_CONTRACT_VERSION,
  PROVIDER_IDS,
  PROVIDER_CAPABILITIES,
  ASSET_ROLES,
  GENERATION_JOB_STATUSES,
  ERROR_CLASSES,
  ASSET_SOURCE_TYPES,
  LICENSE_STATUSES,
  RIGHTS_REVIEW_STATUSES,
  defaultProviderCatalog,
  assertStudioB1InputBoundary,
  buildGenerationJobContract,
  validateGenerationJobContract,
  buildAssetProvenanceContract,
  validateAssetProvenanceContract,
  canAssetEnterPublishCandidate,
  normalizeJobTransition
} = require("./lib/studio-provider-job-contract");
const {
  PUBLISH_PREFLIGHT_VERSION,
  CONTENT_MANIFEST_DRAFT_TRANSFORM_VERSION,
  PUBLISH_PREFLIGHT_STATUSES,
  assertStudioC1InputBoundary,
  buildPublishPreflightContract,
  buildContentManifestDraftTransform,
  validatePublishPreflightContract
} = require("./lib/studio-publish-preflight-contract");
const {
  MEASUREMENT_BINDING_VERSION,
  QR_BINDING_VERSION,
  MEASUREMENT_BINDING_STATUSES,
  QR_BINDING_STATUSES,
  assertStudioD1InputBoundary,
  normalizeMeasurementBindingInput,
  validateMeasurementBindingContract,
  normalizeQrBindingInput,
  validateQrBindingContract
} = require("./lib/studio-measurement-binding-contract");
const {
  PROOF_OF_PLAY_BINDING_VERSION,
  assertStudioD3InputBoundary,
  normalizeProofOfPlayBindingInput,
  validateProofOfPlayBindingContract
} = require("./lib/studio-proof-of-play-contract");

const app = express();
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = runtimePath("MISELL_CLOUD_DATA_DIR", path.join(ROOT_DIR, "data"));
const DB_PATH = runtimePath("DB_PATH", path.join(DATA_DIR, "misell-cloud.sqlite"));
const CLOUD_ASSETS_DIR = runtimePath("MISELL_CLOUD_ASSETS_DIR", path.join(DATA_DIR, "assets"));
const CLOUD_ASSET_UPLOAD_TMP_DIR = path.join(DATA_DIR, "tmp", "asset-uploads");
const CUSTOMER_CONTEXT_SOURCE_DIR = runtimePath("MISELL_CUSTOMER_CONTEXT_SOURCE_DIR", path.join(DATA_DIR, "customer-context-sources"));
const CUSTOMER_CONTEXT_SOURCE_UPLOAD_TMP_DIR = path.join(DATA_DIR, "tmp", "customer-context-source-uploads");

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
const CONTENT_LAYER_TYPES = new Set(["always_on", "campaign_refresh", "realtime_context"]);
const UPDATE_RESULT_STATUS = new Set(["checking", "updating", "success", "failed"]);
const ASSET_SYNC_RESULT_STATUS = new Set(["checking", "downloading", "ready", "failed"]);
const ALERT_EVENTS = new Set(["opened", "updated", "resolved", "test"]);
const ITEM_STATUS = new Set(["active", "archived"]);
const OFFER_STATUS = new Set(["draft", "active", "retired", "archived"]);
const OFFER_REVISION_STATUS = new Set(["draft", "active", "retired"]);
const COUNTER_ORDER_STATUS = new Set(["issued", "redeemed", "expired", "cancelled"]);
const REPORT_SNAPSHOT_STATUS = new Set(["draft", "published", "archived"]);
const DEVICE_COMMAND_TYPES = new Set([
  "reload_player_content",
  "restart_player",
  "restart_kiosk",
  "collect_logs",
  "sync_content_now"
]);
const DEVICE_COMMAND_STATUS = new Set([
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "stale",
  "force_cancelled"
]);
const DEVICE_COMMAND_TERMINAL_STATUS = new Set(["succeeded", "failed", "cancelled", "expired", "stale", "force_cancelled"]);
const DEVICE_COMMAND_ISSUER_ROLES = new Set(["misell_owner", "misell_operator", "device_ops"]);
const DEVICE_COMMAND_DEFAULT_TTL_SECONDS = normalizedLimit(
  process.env.MISELL_DEVICE_COMMAND_DEFAULT_TTL_SECONDS,
  300,
  1,
  3600
);
const DEVICE_COMMAND_MAX_TTL_SECONDS = normalizedLimit(
  process.env.MISELL_DEVICE_COMMAND_MAX_TTL_SECONDS,
  3600,
  60,
  86400
);
const DEVICE_COMMAND_RESULT_MAX_BYTES = normalizedLimit(
  process.env.MISELL_DEVICE_COMMAND_RESULT_MAX_BYTES,
  2000,
  256,
  8000
);
const DEVICE_COMMAND_CLAIM_LEASE_SECONDS = normalizedLimit(
  process.env.MISELL_DEVICE_COMMAND_CLAIM_LEASE_SECONDS,
  300,
  1,
  86400
);
const DEVICE_COMMAND_RETENTION_DAYS = normalizedLimit(
  process.env.MISELL_DEVICE_COMMAND_RETENTION_DAYS,
  90,
  1,
  3650
);
const STORE_ACCESS_TOKEN_PEPPER = process.env.MISELL_STORE_ACCESS_TOKEN_PEPPER || process.env.STORE_ACCESS_TOKEN_PEPPER || DEVICE_TOKEN_PEPPER;
const STORE_STAFF_SESSION_TTL_SECONDS = normalizedLimit(
  process.env.MISELL_STORE_STAFF_SESSION_TTL_SECONDS,
  12 * 60 * 60,
  60,
  7 * 24 * 60 * 60
);
const STORE_STAFF_PIN_MAX_ATTEMPTS = normalizedLimit(
  process.env.MISELL_STORE_STAFF_PIN_MAX_ATTEMPTS,
  5,
  1,
  20
);
const STORE_STAFF_PIN_LOCK_SECONDS = normalizedLimit(
  process.env.MISELL_STORE_STAFF_PIN_LOCK_SECONDS,
  10 * 60,
  60,
  24 * 60 * 60
);
const CUSTOMER_ACCESS_TOKEN_PEPPER = process.env.MISELL_CUSTOMER_ACCESS_TOKEN_PEPPER || process.env.CUSTOMER_ACCESS_TOKEN_PEPPER || DEVICE_TOKEN_PEPPER;
const CUSTOMER_SESSION_TTL_SECONDS = normalizedLimit(
  process.env.MISELL_CUSTOMER_SESSION_TTL_SECONDS,
  12 * 60 * 60,
  60,
  7 * 24 * 60 * 60
);
const CUSTOMER_PIN_MAX_ATTEMPTS = normalizedLimit(
  process.env.MISELL_CUSTOMER_PIN_MAX_ATTEMPTS,
  5,
  1,
  20
);
const CUSTOMER_PIN_LOCK_SECONDS = normalizedLimit(
  process.env.MISELL_CUSTOMER_PIN_LOCK_SECONDS,
  10 * 60,
  60,
  24 * 60 * 60
);
const CUSTOMER_ROLES = new Set(["customer_admin", "customer_editor", "customer_viewer"]);
const CUSTOMER_EDIT_ROLES = new Set(["customer_admin", "customer_editor"]);
const CAMPAIGN_PROPOSAL_STATUS = new Set(["draft", "proposed", "selected", "held", "rejected", "expired"]);
const CUSTOMER_CAMPAIGN_PROPOSAL_STATUS = new Set(["selected", "held", "rejected"]);
const CUSTOMER_VISIBLE_CAMPAIGN_PROPOSAL_STATUS = new Set(["proposed", "selected", "held", "rejected"]);
const CAMPAIGN_PROJECT_STATUS = new Set(CAMPAIGN_PROJECT_STATUSES);
const CAMPAIGN_PROJECT_SCENE_STATUS = new Set(CAMPAIGN_PROJECT_SCENE_STATUSES);
const CAMPAIGN_PROJECT_SOURCE_TYPE = new Set(CAMPAIGN_PROJECT_SOURCE_TYPES);
const STUDIO_CUT_PLAN_STATUS = new Set(CUT_PLAN_STATUSES);
const CAMPAIGN_PROJECT_REGENERATION_REQUEST_TYPES = new Set(["scene_regeneration", "copy_regeneration", "qr_cta_regeneration"]);
const CAMPAIGN_PROJECT_REGENERATION_ACTIONS = Object.freeze({
  scene_regeneration: "scene.regeneration_requested",
  copy_regeneration: "scene.copy_regeneration_requested",
  qr_cta_regeneration: "scene.qr_cta_regeneration_requested"
});
const CUSTOMER_CONTEXT_CATEGORIES = new Set(CONTEXT_CATEGORIES);
const CUSTOMER_CONTEXT_VISIBILITY_SCOPES = new Set(VISIBILITY_SCOPES);
const CUSTOMER_CONTEXT_SOURCE_OWNERS = new Set(SOURCE_OWNERS);
const CUSTOMER_CONTEXT_SOURCE_TYPES = new Set(SOURCE_TYPES);
const CUSTOMER_CONTEXT_CONFIDENCE = new Set(CONFIDENCE_LEVELS);
const CUSTOMER_CONTEXT_RECORD_STATUS = new Set(CONTEXT_RECORD_STATUSES);
const CUSTOMER_CONTEXT_COST_OWNERS = new Set(COST_OWNERS);
const CUSTOMER_CONTEXT_DOCUMENT_PROCESSING_STATUS = new Set(DOCUMENT_PROCESSING_STATUSES);
const CUSTOMER_CONTEXT_SOURCE_MAX_BYTES = Math.max(CONTEXT_SOURCE_IMAGE_MAX_BYTES, CONTEXT_SOURCE_PDF_MAX_BYTES);
const PUBLIC_QR_VIEW_LIMIT = normalizedLimit(
  process.env.MISELL_PUBLIC_QR_VIEW_LIMIT_PER_MINUTE,
  120,
  1,
  10000
);
const PUBLIC_ORDER_CREATE_LIMIT = normalizedLimit(
  process.env.MISELL_PUBLIC_ORDER_CREATE_LIMIT_PER_MINUTE,
  8,
  1,
  10000
);
const PUBLIC_ORDER_VIEW_LIMIT = normalizedLimit(
  process.env.MISELL_PUBLIC_ORDER_VIEW_LIMIT_PER_MINUTE,
  120,
  1,
  10000
);
const PUBLIC_RATE_LIMIT_WINDOW_SECONDS = normalizedLimit(
  process.env.MISELL_PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
  60,
  10,
  3600
);
const QR_DESTINATION_TYPES = new Set([
  "external_url",
  "coupon",
  "product",
  "menu",
  "survey",
  "line",
  "reservation",
  "counter_order_offer"
]);
const ORDER_PAGE_EVENTS = new Set([
  "view",
  "save_image",
  "preview_image",
  "share",
  "copy_order_number",
  "copy_url",
  "open_previous_order"
]);
const DEFAULT_TIMEZONE = "Asia/Tokyo";
const DEFAULT_CURRENCY = "JPY";
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
const REPORT_HEARTBEAT_INTERVAL_MINUTES = normalizedLimit(
  process.env.REPORT_HEARTBEAT_INTERVAL_MINUTES || process.env.MISELL_REPORT_HEARTBEAT_INTERVAL_MINUTES,
  5,
  1,
  60
);
const CONTENT_FRESHNESS_REVIEW_DUE_DAYS = normalizedLimit(
  process.env.MISELL_CONTENT_FRESHNESS_REVIEW_DUE_DAYS,
  14,
  1,
  3650
);
const CONTENT_FRESHNESS_STALE_DAYS = Math.max(
  CONTENT_FRESHNESS_REVIEW_DUE_DAYS,
  normalizedLimit(process.env.MISELL_CONTENT_FRESHNESS_STALE_DAYS, 30, 1, 3650)
);
const CONTENT_FRESHNESS_REPORT_LIMIT = normalizedLimit(
  process.env.MISELL_CONTENT_FRESHNESS_REPORT_LIMIT,
  100,
  1,
  500
);
const AD_INVENTORY_REPORT_LIMIT = normalizedLimit(
  process.env.MISELL_AD_INVENTORY_REPORT_LIMIT,
  100,
  1,
  500
);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(CLOUD_ASSETS_DIR, { recursive: true });
fs.mkdirSync(CLOUD_ASSET_UPLOAD_TMP_DIR, { recursive: true });
fs.mkdirSync(CUSTOMER_CONTEXT_SOURCE_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(CUSTOMER_CONTEXT_SOURCE_UPLOAD_TMP_DIR, { recursive: true, mode: 0o700 });
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

const customerContextSourceUpload = multer({
  storage: multer.diskStorage({
    destination: CUSTOMER_CONTEXT_SOURCE_UPLOAD_TMP_DIR,
    filename(req, file, cb) {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${path.extname(file.originalname || "").toLowerCase()}`);
    }
  }),
  limits: {
    fileSize: CUSTOMER_CONTEXT_SOURCE_MAX_BYTES,
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
  adminAuth(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }
    req.adminActor = adminActorFromRequest(req);
    next();
  });
}

function adminActorFromRequest(req) {
  return {
    actor_id: cleanString(req?.auth?.user || process.env.MISELL_CLOUD_ADMIN_ID || ADMIN_USER || "admin").slice(0, 120) || "admin",
    role: cleanString(process.env.MISELL_CLOUD_ADMIN_ROLE || process.env.ADMIN_ROLE || "").slice(0, 80)
  };
}

function requireDeviceCommandIssuer(req, res, next) {
  const actor = req.adminActor || adminActorFromRequest(req);
  if (!DEVICE_COMMAND_ISSUER_ROLES.has(actor.role)) {
    res.status(403).json({
      error: "Admin role is not allowed to issue device commands",
      required_roles: Array.from(DEVICE_COMMAND_ISSUER_ROLES)
    });
    return;
  }
  req.adminActor = actor;
  next();
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

app.get("/admin/campaign-projects/:campaign_project_id/preview", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "campaign-project-preview.html"));
});

app.get("/campaign-project-preview.html", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "campaign-project-preview.html"));
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

app.get("/api/admin/device-commands", requireAdminAuth, (req, res, next) => {
  try {
    maintainDeviceCommands();
    res.json({
      ok: true,
      device_commands: listDeviceCommands({
        tenant_id: req.query.tenant_id,
        store_id: req.query.store_id,
        screen_group_id: req.query.screen_group_id,
        device_id: req.query.device_id,
        status: req.query.status,
        limit: req.query.limit
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/devices/:device_id/commands", requireAdminAuth, (req, res, next) => {
  try {
    const deviceId = cleanId(req.params.device_id);
    const device = db.prepare("SELECT device_id FROM devices WHERE device_id = ?").get(deviceId);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }
    maintainDeviceCommands();
    res.json({
      ok: true,
      device_commands: listDeviceCommands({
        tenant_id: req.query.tenant_id,
        store_id: req.query.store_id,
        screen_group_id: req.query.screen_group_id,
        device_id: deviceId,
        status: req.query.status,
        limit: req.query.limit
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/devices/:device_id/commands", requireAdminAuth, requireDeviceCommandIssuer, (req, res, next) => {
  try {
    const command = createDeviceCommand(cleanId(req.params.device_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, device_command: command });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/device-commands/:device_command_id/cancel", requireAdminAuth, requireDeviceCommandIssuer, (req, res, next) => {
  try {
    const command = cancelDeviceCommand(cleanId(req.params.device_command_id), req.body || {}, req.adminActor);
    res.json({ ok: true, device_command: command });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/device-commands/:device_command_id/force-cancel", requireAdminAuth, requireDeviceCommandIssuer, (req, res, next) => {
  try {
    const command = forceCancelDeviceCommand(cleanId(req.params.device_command_id), req.body || {}, req.adminActor);
    res.json({ ok: true, device_command: command });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/store-settings", requireAdminAuth, (req, res) => {
  res.json({ ok: true, store_settings: listStoreSettings() });
});

app.get("/api/admin/store-access-tokens", requireAdminAuth, (req, res) => {
  res.json({ ok: true, store_access_tokens: listStoreAccessTokens(req.query || {}) });
});

app.get("/api/admin/customer-access-tokens", requireAdminAuth, (req, res) => {
  res.json({ ok: true, customer_access_tokens: listCustomerAccessTokens(req.query || {}) });
});

app.get("/api/admin/stores/:store_id/settings", requireAdminAuth, (req, res) => {
  const settings = getStoreSettings(cleanId(req.params.store_id), { withDefaults: true });
  if (!settings) {
    res.status(404).json({ error: "Store not found" });
    return;
  }
  res.json({ ok: true, store_settings: settings });
});

app.put("/api/admin/stores/:store_id/settings", requireAdminAuth, (req, res, next) => {
  try {
    const settings = upsertStoreSettings(cleanId(req.params.store_id), req.body || {});
    res.json({ ok: true, store_settings: settings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/stores/:store_id/access-token", requireAdminAuth, (req, res, next) => {
  try {
    const result = createStoreAccessToken(cleanId(req.params.store_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/tenants/:tenant_id/customer-access-token", requireAdminAuth, (req, res, next) => {
  try {
    const result = createCustomerAccessToken(cleanId(req.params.tenant_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/customer-context-items", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, customer_context_items: listCustomerContextItems(req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/customer-context-items", requireAdminAuth, (req, res, next) => {
  try {
    const item = upsertCustomerContextItem(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, customer_context_item: item });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/customer-context-items/:customer_context_item_id", requireAdminAuth, (req, res, next) => {
  try {
    const item = updateCustomerContextItem(cleanId(req.params.customer_context_item_id), req.body || {}, {
      actorType: "admin",
      actorId: req.adminActor?.actor_id || "admin"
    });
    res.json({ ok: true, customer_context_item: item });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/customer-context-items/:customer_context_item_id", requireAdminAuth, (req, res, next) => {
  try {
    const item = softDeleteCustomerContextItem(cleanId(req.params.customer_context_item_id), {
      actorType: "admin",
      actorId: req.adminActor?.actor_id || "admin"
    });
    res.json({ ok: true, customer_context_item: item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/customer-context-items/:customer_context_item_id/source-assets", requireAdminAuth, (req, res, next) => {
  customerContextSourceUpload.single("source")(req, res, (error) => {
    if (error) {
      next(normalizeCustomerContextSourceUploadError(error));
      return;
    }
    try {
      const asset = createCustomerContextSourceAsset(cleanId(req.params.customer_context_item_id), req.file, req.body || {}, {
        actorType: "admin",
        actorId: req.adminActor?.actor_id || "admin"
      });
      res.status(201).json({ ok: true, customer_context_source_asset: asset });
    } catch (createError) {
      cleanupUploadedFile(req.file);
      next(createError);
    }
  });
});

app.get("/api/admin/customer-context-source-assets/:customer_context_source_asset_id/view", requireAdminAuth, (req, res, next) => {
  try {
    sendCustomerContextSourceAsset(req, res, cleanId(req.params.customer_context_source_asset_id), { actorType: "admin" });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/customer-context-source-assets/:customer_context_source_asset_id", requireAdminAuth, (req, res, next) => {
  try {
    const asset = softDeleteCustomerContextSourceAsset(cleanId(req.params.customer_context_source_asset_id), {
      actorType: "admin",
      actorId: req.adminActor?.actor_id || "admin"
    });
    res.json({ ok: true, customer_context_source_asset: asset });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/proposal-generation-runs", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, proposal_generation_runs: listProposalGenerationRuns(req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/proposal-generation-runs", requireAdminAuth, (req, res, next) => {
  try {
    const run = createProposalGenerationRun(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, proposal_generation_run: run });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-proposals", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, campaign_proposals: listCampaignProposals(req.query || {}, { includeEvents: true }) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-proposals", requireAdminAuth, (req, res, next) => {
  try {
    const proposal = createCampaignProposal(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, campaign_proposal: proposal });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-proposals/:campaign_proposal_id/events", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, campaign_proposal_events: listCampaignProposalEvents(cleanId(req.params.campaign_proposal_id)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, campaign_projects: listCampaignProjects(req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/from-proposal", requireAdminAuth, (req, res, next) => {
  try {
    const project = createCampaignProjectFromProposal(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, campaign_project: project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/from-brief", requireAdminAuth, (req, res, next) => {
  try {
    const project = createCampaignProjectFromBrief(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, campaign_project: project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/free-input", requireAdminAuth, (req, res, next) => {
  try {
    const project = createCampaignProjectFromFreeInput(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, campaign_project: project });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id", requireAdminAuth, (req, res, next) => {
  try {
    const project = getCampaignProject(cleanId(req.params.campaign_project_id), normalizeCampaignProjectScopeQuery(req.query || {}), { includeScenes: true, includeEvents: true });
    if (!project) throw requestError("Campaign project not found", 404);
    res.json({ ok: true, campaign_project: project });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id/playlist-handoff-draft", requireAdminAuth, (req, res, next) => {
  try {
    const draft = getCampaignProjectPlaylistHandoffDraft(cleanId(req.params.campaign_project_id), normalizeCampaignProjectScopeQuery(req.query || {}));
    if (!draft) throw requestError("Campaign project not found", 404);
    res.json({ ok: true, playlist_handoff_draft: draft });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id/schedule-handoff-draft", requireAdminAuth, (req, res, next) => {
  try {
    const draft = getCampaignProjectScheduleHandoffDraft(cleanId(req.params.campaign_project_id), normalizeCampaignProjectScopeQuery(req.query || {}));
    if (!draft) throw requestError("Campaign project not found", 404);
    res.json({ ok: true, schedule_handoff_draft: draft });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id/cut-plans", requireAdminAuth, (req, res, next) => {
  try {
    const cutPlans = listStudioCutPlansForProject(cleanId(req.params.campaign_project_id), req.query || {});
    res.json({ ok: true, studio_cut_plans: cutPlans });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/cut-plans", requireAdminAuth, (req, res, next) => {
  try {
    const cutPlan = createStudioCutPlanFromProject(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, studio_cut_plan: cutPlan });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-cut-plans/:cut_plan_id", requireAdminAuth, (req, res, next) => {
  try {
    const cutPlan = getStudioCutPlan(cleanId(req.params.cut_plan_id), normalizeCampaignProjectScopeQuery(req.query || {}), { includeRenderManifests: true });
    if (!cutPlan) throw requestError("Studio cut plan not found", 404);
    res.json({ ok: true, studio_cut_plan: cutPlan });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/studio-cut-plans/:cut_plan_id/validate", requireAdminAuth, (req, res, next) => {
  try {
    const result = validateStudioCutPlan(cleanId(req.params.cut_plan_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/studio-cut-plans/:cut_plan_id", requireAdminAuth, (req, res, next) => {
  try {
    const cutPlan = softDeleteStudioCutPlan(cleanId(req.params.cut_plan_id), req.adminActor);
    res.json({ ok: true, studio_cut_plan: cutPlan });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-cut-plans/:cut_plan_id/render-manifests", requireAdminAuth, (req, res, next) => {
  try {
    const manifests = listStudioRenderManifestsForCutPlan(cleanId(req.params.cut_plan_id), req.query || {});
    res.json({ ok: true, studio_render_manifests: manifests });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/studio-cut-plans/:cut_plan_id/render-manifests", requireAdminAuth, (req, res, next) => {
  try {
    const manifest = createStudioRenderManifest(cleanId(req.params.cut_plan_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, studio_render_manifest: manifest });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-render-manifests/:render_manifest_id", requireAdminAuth, (req, res, next) => {
  try {
    const manifest = getStudioRenderManifest(cleanId(req.params.render_manifest_id), normalizeCampaignProjectScopeQuery(req.query || {}), { includeQaResults: true });
    if (!manifest) throw requestError("Studio render manifest not found", 404);
    res.json({ ok: true, studio_render_manifest: manifest });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/studio-render-manifests/:render_manifest_id/qa", requireAdminAuth, (req, res, next) => {
  try {
    const result = rerunStudioRenderQa(cleanId(req.params.render_manifest_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/studio-render-manifests/:render_manifest_id", requireAdminAuth, (req, res, next) => {
  try {
    const manifest = softDeleteStudioRenderManifest(cleanId(req.params.render_manifest_id), req.adminActor);
    res.json({ ok: true, studio_render_manifest: manifest });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id/publish-preflights", requireAdminAuth, (req, res, next) => {
  try {
    const preflights = listStudioPublishPreflightsForProject(cleanId(req.params.campaign_project_id), req.query || {});
    res.json({ ok: true, studio_publish_preflights: preflights });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/publish-preflights", requireAdminAuth, (req, res, next) => {
  try {
    const result = createStudioPublishPreflight(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-publish-preflights/:publish_preflight_id", requireAdminAuth, (req, res, next) => {
  try {
    const preflight = getStudioPublishPreflight(cleanId(req.params.publish_preflight_id), normalizeCampaignProjectScopeQuery(req.query || {}), { includeDraftTransform: true });
    if (!preflight) throw requestError("Studio publish preflight not found", 404);
    res.json({ ok: true, studio_publish_preflight: preflight });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id/measurement-bindings", requireAdminAuth, (req, res, next) => {
  try {
    const bindings = listStudioMeasurementBindingsForProject(cleanId(req.params.campaign_project_id), req.query || {});
    res.json({ ok: true, studio_measurement_bindings: bindings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/measurement-bindings", requireAdminAuth, (req, res, next) => {
  try {
    const binding = createStudioMeasurementBinding(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, studio_measurement_binding: binding });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-measurement-bindings/:measurement_binding_id", requireAdminAuth, (req, res, next) => {
  try {
    const binding = getStudioMeasurementBinding(cleanId(req.params.measurement_binding_id), normalizeCampaignProjectScopeQuery(req.query || {}), { includeQrBindings: true });
    if (!binding) throw requestError("Studio measurement binding not found", 404);
    res.json({ ok: true, studio_measurement_binding: binding });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/studio-measurement-bindings/:measurement_binding_id/validate", requireAdminAuth, (req, res, next) => {
  try {
    const result = validateStudioMeasurementBinding(cleanId(req.params.measurement_binding_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/studio-measurement-bindings/:measurement_binding_id", requireAdminAuth, (req, res, next) => {
  try {
    const binding = softDeleteStudioMeasurementBinding(cleanId(req.params.measurement_binding_id), req.adminActor);
    res.json({ ok: true, studio_measurement_binding: binding });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-measurement-bindings/:measurement_binding_id/qr-bindings", requireAdminAuth, (req, res, next) => {
  try {
    const bindings = listStudioQrBindingsForMeasurement(cleanId(req.params.measurement_binding_id), req.query || {});
    res.json({ ok: true, studio_qr_bindings: bindings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/studio-measurement-bindings/:measurement_binding_id/qr-bindings", requireAdminAuth, (req, res, next) => {
  try {
    const result = createStudioQrBinding(cleanId(req.params.measurement_binding_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/campaign-projects/:campaign_project_id/proof-of-play-bindings", requireAdminAuth, (req, res, next) => {
  try {
    const bindings = listStudioProofOfPlayForProject(cleanId(req.params.campaign_project_id), req.query || {});
    res.json({ ok: true, studio_proof_of_play_bindings: bindings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/proof-of-play-bindings/rebuild", requireAdminAuth, (req, res, next) => {
  try {
    const result = rebuildStudioProofOfPlayForProject(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-proof-of-play-bindings/:proof_binding_id", requireAdminAuth, (req, res, next) => {
  try {
    const binding = getStudioProofOfPlayBinding(cleanId(req.params.proof_binding_id), normalizeCampaignProjectScopeQuery(req.query || {}));
    if (!binding) throw requestError("Studio proof-of-play binding not found", 404);
    res.json({ ok: true, studio_proof_of_play_binding: binding });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/studio-generation-providers", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, studio_generation_providers: listStudioGenerationProviders() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/ai-generation-jobs", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, ai_generation_jobs: listAiGenerationJobs(req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/ai-generation-jobs", requireAdminAuth, (req, res, next) => {
  try {
    const result = createAiGenerationJob(req.body || {}, req.adminActor);
    res.status(result.idempotency_reused ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/ai-generation-jobs/:ai_generation_job_id", requireAdminAuth, (req, res, next) => {
  try {
    const job = getAiGenerationJob(cleanId(req.params.ai_generation_job_id), normalizeCampaignProjectScopeQuery(req.query || {}), { includeProvenance: true });
    if (!job) throw requestError("AI generation job not found", 404);
    res.json({ ok: true, ai_generation_job: job });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/ai-generation-jobs/:ai_generation_job_id/start", requireAdminAuth, (req, res, next) => {
  try {
    const job = startAiGenerationJob(cleanId(req.params.ai_generation_job_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ai_generation_job: job });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/ai-generation-jobs/:ai_generation_job_id/complete", requireAdminAuth, (req, res, next) => {
  try {
    const result = completeAiGenerationJob(cleanId(req.params.ai_generation_job_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/ai-generation-jobs/:ai_generation_job_id/fail", requireAdminAuth, (req, res, next) => {
  try {
    const job = failAiGenerationJob(cleanId(req.params.ai_generation_job_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ai_generation_job: job });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/ai-generation-jobs/:ai_generation_job_id", requireAdminAuth, (req, res, next) => {
  try {
    const job = softDeleteAiGenerationJob(cleanId(req.params.ai_generation_job_id), req.adminActor);
    res.json({ ok: true, ai_generation_job: job });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/asset-provenance", requireAdminAuth, (req, res, next) => {
  try {
    res.json({ ok: true, asset_provenance: listAssetProvenance(req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/asset-provenance", requireAdminAuth, (req, res, next) => {
  try {
    const provenance = createAssetProvenance(req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, asset_provenance: provenance });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/asset-provenance/:asset_provenance_id", requireAdminAuth, (req, res, next) => {
  try {
    const provenance = getAssetProvenance(cleanId(req.params.asset_provenance_id), normalizeCampaignProjectScopeQuery(req.query || {}));
    if (!provenance) throw requestError("Asset provenance not found", 404);
    res.json({ ok: true, asset_provenance: provenance });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/asset-provenance/:asset_provenance_id", requireAdminAuth, (req, res, next) => {
  try {
    const result = updateAssetProvenance(cleanId(req.params.asset_provenance_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/asset-provenance/:asset_provenance_id", requireAdminAuth, (req, res, next) => {
  try {
    const provenance = softDeleteAssetProvenance(cleanId(req.params.asset_provenance_id), req.adminActor);
    res.json({ ok: true, asset_provenance: provenance });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/scenes", requireAdminAuth, (req, res, next) => {
  try {
    const scene = createCampaignProjectScene(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, campaign_project_scene: scene });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/campaign-projects/:campaign_project_id/scenes/:campaign_project_scene_id", requireAdminAuth, (req, res, next) => {
  try {
    const scene = updateCampaignProjectScene(cleanId(req.params.campaign_project_id), cleanId(req.params.campaign_project_scene_id), req.body || {}, req.adminActor);
    res.json({ ok: true, campaign_project_scene: scene });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/scenes/:campaign_project_scene_id/reorder", requireAdminAuth, (req, res, next) => {
  try {
    const result = reorderCampaignProjectScene(cleanId(req.params.campaign_project_id), cleanId(req.params.campaign_project_scene_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/scenes/:campaign_project_scene_id/duplicate", requireAdminAuth, (req, res, next) => {
  try {
    const scene = duplicateCampaignProjectScene(cleanId(req.params.campaign_project_id), cleanId(req.params.campaign_project_scene_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, campaign_project_scene: scene });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/generate-scenes", requireAdminAuth, (req, res, next) => {
  try {
    const result = generateCampaignProjectScenes(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/scenes/:campaign_project_scene_id/regeneration-requests", requireAdminAuth, (req, res, next) => {
  try {
    const request = createCampaignProjectRegenerationRequest(cleanId(req.params.campaign_project_id), cleanId(req.params.campaign_project_scene_id), req.body || {}, req.adminActor);
    res.status(201).json({ ok: true, regeneration_request: request });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaign-projects/:campaign_project_id/validate", requireAdminAuth, (req, res, next) => {
  try {
    const result = validateCampaignProject(cleanId(req.params.campaign_project_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/campaign-projects/:campaign_project_id/scenes/:campaign_project_scene_id", requireAdminAuth, (req, res, next) => {
  try {
    const scene = softDeleteCampaignProjectScene(cleanId(req.params.campaign_project_id), cleanId(req.params.campaign_project_scene_id), req.adminActor);
    res.json({ ok: true, campaign_project_scene: scene });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/campaign-projects/:campaign_project_id", requireAdminAuth, (req, res, next) => {
  try {
    const project = softDeleteCampaignProject(cleanId(req.params.campaign_project_id), req.adminActor);
    res.json({ ok: true, campaign_project: project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/store-access-tokens/:store_access_token_id/rotate", requireAdminAuth, (req, res, next) => {
  try {
    const result = rotateStoreAccessToken(cleanId(req.params.store_access_token_id), req.body || {}, req.adminActor);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/store-access-tokens/:store_access_token_id/pin", requireAdminAuth, (req, res, next) => {
  try {
    const token = resetStoreAccessTokenPin(cleanId(req.params.store_access_token_id), req.body || {}, req.adminActor);
    res.json({ ok: true, store_access_token: token });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/stores/:store_id/settings", requireAdminAuth, (req, res, next) => {
  try {
    const settings = upsertStoreSettings(cleanId(req.params.store_id), req.body || {});
    res.json({ ok: true, store_settings: settings });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/items", requireAdminAuth, (req, res) => {
  res.json({ ok: true, items: listItems() });
});

app.post("/api/admin/items", requireAdminAuth, (req, res, next) => {
  try {
    const item = createItem(req.body || {});
    res.status(201).json({ ok: true, item });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/items/:item_id", requireAdminAuth, (req, res, next) => {
  try {
    const item = updateItem(cleanId(req.params.item_id), req.body || {});
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json({ ok: true, item });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/offers", requireAdminAuth, (req, res) => {
  res.json({ ok: true, offers: listOffers() });
});

app.post("/api/admin/offers", requireAdminAuth, (req, res, next) => {
  try {
    const offer = createOffer(req.body || {});
    res.status(201).json({ ok: true, offer });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/offers/:offer_id", requireAdminAuth, (req, res) => {
  const offer = getOffer(cleanId(req.params.offer_id), { includeRevisions: true });
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  res.json({ ok: true, offer });
});

app.post("/api/admin/offers/:offer_id/revisions", requireAdminAuth, (req, res, next) => {
  try {
    const revision = createOfferRevision(cleanId(req.params.offer_id), req.body || {});
    res.status(201).json({ ok: true, offer_revision: revision, offer: getOffer(cleanId(req.params.offer_id), { includeRevisions: true }) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/qr-links", requireAdminAuth, (req, res) => {
  res.json({ ok: true, qr_links: listQrLinks() });
});

app.post("/api/admin/qr-links", requireAdminAuth, (req, res, next) => {
  try {
    const qrLink = createQrLink(req.body || {});
    res.status(201).json({ ok: true, qr_link: qrLink });
  } catch (error) {
    next(error);
  }
});

app.get("/q/:qr_token", (req, res, next) => {
  try {
    const qrLink = getQrLinkByToken(cleanId(req.params.qr_token));
    if (!qrLink) {
      res.status(404).json({ error: "QR link not found" });
      return;
    }
    assertQrLinkUsable(qrLink);
    enforcePublicRateLimit(req, "qr_view", qrLink.qr_token || req.params.qr_token, {
      limit: PUBLIC_QR_VIEW_LIMIT,
      windowSeconds: PUBLIC_RATE_LIMIT_WINDOW_SECONDS
    });
    const offerRevision = resolveQrLinkOfferRevision(qrLink);
    if (qrLink.destination_type === "counter_order_offer" && !offerRevision) {
      throw requestError("QR link has no active offer revision", 409);
    }
    const qrScan = recordQrScan(qrLink, req);
    if (qrLink.destination_type === "external_url") {
      res.redirect(qrLink.destination_url);
      return;
    }
    res.json({
      ok: true,
      qr_link: qrLink,
      qr_scan: qrScan,
      offer_revision: offerRevision
    });
  } catch (error) {
    next(error);
  }
});

app.post("/q/:qr_token/orders", (req, res, next) => {
  try {
    const qrLink = getQrLinkByToken(cleanId(req.params.qr_token));
    if (!qrLink) {
      res.status(404).json({ error: "QR link not found" });
      return;
    }
    assertQrLinkUsable(qrLink);
    if (qrLink.destination_type !== "counter_order_offer") {
      throw requestError("QR link does not issue counter orders", 400);
    }
    enforcePublicRateLimit(req, "counter_order_create", qrLink.qr_token || req.params.qr_token, {
      limit: PUBLIC_ORDER_CREATE_LIMIT,
      windowSeconds: PUBLIC_RATE_LIMIT_WINDOW_SECONDS
    });
    const qrScan = resolveQrScanForOrder(qrLink, req);
    const offerRevision = resolveQrLinkOfferRevision(qrLink);
    if (!offerRevision) {
      throw requestError("QR link has no active offer revision", 409);
    }
    const result = createCounterOrder({
      ...(req.body || {}),
      qr_link_id: qrLink.qr_link_id,
      qr_scan_id: qrScan.qr_scan_id,
      visit_id: cleanId(req.body?.visit_id || req.body?.visitId || qrScan.visit_id),
      offer_id: offerRevision.offer_id,
      offer_revision_id: qrLink.offer_revision_id || undefined,
      tenant_id: qrLink.tenant_id || offerRevision.tenant_id,
      store_id: qrLink.store_id || offerRevision.store_id,
      screen_group_id: qrLink.screen_group_id,
      content_id: qrLink.content_id,
      campaign_id: qrLink.campaign_id || offerRevision.campaign_id
    });
    res.status(201).json({ ok: true, qr_scan: qrScan, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/order/:order_token", (req, res, next) => {
  try {
    enforcePublicRateLimit(req, "order_view", cleanString(req.params.order_token), {
      limit: PUBLIC_ORDER_VIEW_LIMIT,
      windowSeconds: PUBLIC_RATE_LIMIT_WINDOW_SECONDS
    });
    const order = getCounterOrderByToken(cleanString(req.params.order_token));
    if (!order) {
      if (requestAcceptsHtml(req)) {
        res.status(404).type("html").send(renderOrderNotFoundPage());
        return;
      }
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (requestAcceptsHtml(req)) {
      res.type("html").send(renderCounterOrderPage(order, cleanString(req.params.order_token), req));
      return;
    }
    res.json({ ok: true, counter_order: order });
  } catch (error) {
    next(error);
  }
});

app.get("/api/public/orders/:order_token", (req, res, next) => {
  try {
    enforcePublicRateLimit(req, "order_view", cleanString(req.params.order_token), {
      limit: PUBLIC_ORDER_VIEW_LIMIT,
      windowSeconds: PUBLIC_RATE_LIMIT_WINDOW_SECONDS
    });
    const order = getCounterOrderByToken(cleanString(req.params.order_token));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json({ ok: true, counter_order: withCounterOrderStoreProfile(order) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/orders/:order_token/events", (req, res, next) => {
  try {
    const event = recordOrderPageEvent(cleanString(req.params.order_token), req.body || {}, req);
    res.status(201).json({ ok: true, event });
  } catch (error) {
    next(error);
  }
});

app.get("/store/orders/:store_token", (req, res) => {
  const storeAccess = getStoreAccessTokenByRawToken(cleanString(req.params.store_token));
  if (!storeAccess || storeAccess.status !== "active") {
    res.status(404).type("html").send(renderStoreOrdersNotFoundPage());
    return;
  }
  res.type("html").send(renderStoreOrdersPage(storeAccess, req));
});

app.post("/store/orders/:store_token/session", (req, res, next) => {
  try {
    const session = createStoreStaffSession(cleanString(req.params.store_token), req.body || {}, req);
    setStoreStaffSessionCookie(req, res, session.session_token, session.expires_at);
    res.status(201).json({ ok: true, session: publicStoreStaffSession(session), store: session.store });
  } catch (error) {
    next(error);
  }
});

app.get("/api/store/orders/session", requireStoreStaffSession, (req, res) => {
  res.json({ ok: true, session: publicStoreStaffSession(req.storeStaffSession), store: req.storeStaffSession.store });
});

app.post("/api/store/orders/logout", requireStoreStaffSession, (req, res) => {
  revokeStoreStaffSession(req.storeStaffSession);
  clearStoreStaffSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/store/orders", requireStoreStaffSession, (req, res) => {
  res.json({
    ok: true,
    counter_orders: listCounterOrders({
      ...req.query,
      store_id: req.storeStaffSession.store_id
    })
  });
});

app.patch("/api/store/orders/:counter_order_id/status", requireStoreStaffSession, (req, res, next) => {
  try {
    const order = updateStoreCounterOrderStatus(req.storeStaffSession, cleanId(req.params.counter_order_id), req.body || {});
    res.json({ ok: true, counter_order: order });
  } catch (error) {
    next(error);
  }
});

app.get("/customer/admin", (req, res) => {
  res.type("html").send(renderCustomerAdminNotFoundPage());
});

app.get("/customer/admin/:customer_access_token_id", (req, res) => {
  const customerAccess = getCustomerAccessToken(cleanId(req.params.customer_access_token_id));
  if (!customerAccess || customerAccess.status !== "active") {
    res.status(404).type("html").send(renderCustomerAdminNotFoundPage());
    return;
  }
  res.type("html").send(renderCustomerAdminPage(customerAccess, req));
});

app.post("/customer/admin/:customer_access_token_id/session", (req, res, next) => {
  try {
    const session = createCustomerSession(cleanId(req.params.customer_access_token_id), req.body || {}, req);
    setCustomerSessionCookie(req, res, session.session_token, session.expires_at);
    res.status(201).json({ ok: true, session: publicCustomerSession(session) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/customer/session", requireCustomerSession, (req, res) => {
  res.json({ ok: true, session: publicCustomerSession(req.customerSession) });
});

app.post("/api/customer/logout", requireCustomerSession, (req, res) => {
  revokeCustomerSession(req.customerSession);
  clearCustomerSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/customer/reports/conversion", requireCustomerSession, (req, res, next) => {
  try {
    const criteria = normalizeCustomerReportCriteria(req.query || {}, req.customerSession);
    res.json({ ok: true, report: buildCustomerConversionReport(criteria, req.customerSession) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/customer/counter-orders", requireCustomerSession, (req, res, next) => {
  try {
    const query = normalizeCustomerCounterOrderQuery(req.query || {}, req.customerSession);
    res.json({ ok: true, counter_orders: listCounterOrders(query) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/customer/store-settings", requireCustomerSession, (req, res) => {
  res.json({ ok: true, store_settings: listCustomerStoreSettings(req.customerSession) });
});

app.get("/api/customer/screen-groups", requireCustomerSession, (req, res) => {
  res.json({ ok: true, screen_groups: listCustomerScreenGroups(req.customerSession) });
});

app.get("/api/customer/offers", requireCustomerSession, (req, res) => {
  res.json({ ok: true, offers: listCustomerOffers(req.customerSession) });
});

app.get("/api/customer/context-items", requireCustomerSession, (req, res, next) => {
  try {
    res.json({ ok: true, customer_context_items: listCustomerVisibleContextItems(req.customerSession, req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/customer/context-items", requireCustomerSession, requireCustomerEditor, (req, res, next) => {
  try {
    const item = createCustomerOwnedContextItem(req.customerSession, req.body || {});
    res.status(201).json({ ok: true, customer_context_item: item });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/customer/context-items/:customer_context_item_id", requireCustomerSession, requireCustomerEditor, (req, res, next) => {
  try {
    const item = updateCustomerOwnedContextItem(req.customerSession, cleanId(req.params.customer_context_item_id), req.body || {});
    res.json({ ok: true, customer_context_item: item });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/customer/context-items/:customer_context_item_id", requireCustomerSession, requireCustomerEditor, (req, res, next) => {
  try {
    const item = softDeleteCustomerOwnedContextItem(req.customerSession, cleanId(req.params.customer_context_item_id));
    res.json({ ok: true, customer_context_item: item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/customer/context-items/:customer_context_item_id/source-assets", requireCustomerSession, requireCustomerEditor, (req, res, next) => {
  customerContextSourceUpload.single("source")(req, res, (error) => {
    if (error) {
      next(normalizeCustomerContextSourceUploadError(error));
      return;
    }
    try {
      const item = getCustomerOwnedContextItemForWrite(req.customerSession, cleanId(req.params.customer_context_item_id));
      const asset = createCustomerContextSourceAsset(item.customer_context_item_id, req.file, {
        ...(req.body || {}),
        source_owner: "customer",
        visibility_scope: "customer_visible"
      }, {
        actorType: "customer",
        actorId: req.customerSession.customer_session_id
      });
      res.status(201).json({ ok: true, customer_context_source_asset: asset });
    } catch (createError) {
      cleanupUploadedFile(req.file);
      next(createError);
    }
  });
});

app.get("/api/customer/context-source-assets/:customer_context_source_asset_id/view", requireCustomerSession, (req, res, next) => {
  try {
    sendCustomerContextSourceAsset(req, res, cleanId(req.params.customer_context_source_asset_id), {
      actorType: "customer",
      session: req.customerSession
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/customer/context-source-assets/:customer_context_source_asset_id", requireCustomerSession, requireCustomerEditor, (req, res, next) => {
  try {
    const asset = softDeleteCustomerOwnedContextSourceAsset(req.customerSession, cleanId(req.params.customer_context_source_asset_id));
    res.json({ ok: true, customer_context_source_asset: asset });
  } catch (error) {
    next(error);
  }
});

app.get("/api/customer/campaign-proposals", requireCustomerSession, (req, res, next) => {
  try {
    res.json({ ok: true, campaign_proposals: listCustomerCampaignProposals(req.customerSession, req.query || {}) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/customer/campaign-proposals/:campaign_proposal_id/status", requireCustomerSession, (req, res, next) => {
  try {
    const proposal = updateCustomerCampaignProposalStatus(
      req.customerSession,
      cleanId(req.params.campaign_proposal_id),
      req.body || {}
    );
    res.json({ ok: true, campaign_proposal: proposal });
  } catch (error) {
    next(error);
  }
});

app.post("/api/customer/offers/:offer_id/revisions", requireCustomerSession, requireCustomerEditor, (req, res, next) => {
  try {
    const revision = createCustomerOfferRevision(req.customerSession, cleanId(req.params.offer_id), req.body || {});
    res.status(201).json({ ok: true, offer_revision: revision, offer: getOffer(cleanId(req.params.offer_id), { includeRevisions: true }) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/counter-orders", requireAdminAuth, (req, res) => {
  res.json({ ok: true, counter_orders: listCounterOrders(req.query || {}) });
});

app.post("/api/admin/counter-orders", requireAdminAuth, (req, res, next) => {
  try {
    const result = createCounterOrder(req.body || {});
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/counter-orders/:counter_order_id/status", requireAdminAuth, (req, res, next) => {
  try {
    const order = updateCounterOrderStatus(cleanId(req.params.counter_order_id), req.body || {});
    if (!order) {
      res.status(404).json({ error: "Counter order not found" });
      return;
    }
    res.json({ ok: true, counter_order: order });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/summary", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeReportCriteria(req.query || {});
    res.json({ ok: true, report: buildReportSummary(criteria) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/content-freshness", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeContentFreshnessCriteria(req.query || {});
    res.json({ ok: true, report: buildContentFreshnessReport(criteria) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/advertiser-preview", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeAdvertiserReportPreviewCriteria(req.query || {});
    res.json({ ok: true, report: buildAdvertiserReportPreview(criteria) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/ad-inventory", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeAdInventoryReportCriteria(req.query || {});
    res.json({ ok: true, report: buildAdInventoryReport(criteria) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/host-roi-preview", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeHostRoiPreviewCriteria(req.query || {});
    res.json({ ok: true, report: buildHostRoiPreview(criteria) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/daily-metrics", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeReportCriteria(req.query || {});
    assertReportReadModelScope(criteria);
    res.json({ ok: true, metrics: listReportDailyStoreMetrics(criteria) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/reports/read-model/rebuild", requireAdminAuth, (req, res, next) => {
  try {
    const criteria = normalizeReportCriteria(req.body || {});
    assertReportReadModelScope(criteria);
    const result = rebuildReportDailyStoreMetrics(criteria);
    res.status(201).json({
      ok: true,
      rebuilt: result.rows.length,
      report: buildReportSummary(criteria, { dailyRows: result.rows, generatedAt: result.generated_at })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/monthly-snapshots", requireAdminAuth, (req, res, next) => {
  try {
    const filters = normalizeReportSnapshotListFilters(req.query || {});
    res.json({ ok: true, report_snapshots: listReportSnapshots(filters) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/reports/monthly-snapshots", requireAdminAuth, (req, res, next) => {
  try {
    const snapshot = createMonthlyReportSnapshot(req.body || {});
    res.status(201).json({ ok: true, report_snapshot: snapshot });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reports/monthly-snapshots/:snapshot_id", requireAdminAuth, (req, res) => {
  const snapshot = getReportSnapshot(cleanId(req.params.snapshot_id));
  if (!snapshot) {
    res.status(404).json({ error: "Report snapshot not found" });
    return;
  }
  res.json({ ok: true, report_snapshot: snapshot });
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
          tenant_id, store_id, screen_group_id, screen_slot_id,
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
        input.store_id,
        input.screen_group_id,
        input.screen_slot_id,
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
    assertActiveContentPatchAllowed(existing, req.body || {});

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
          store_id = ?,
          screen_group_id = ?,
          screen_slot_id = ?,
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
        input.store_id,
        input.screen_group_id,
        input.screen_slot_id,
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

app.get("/api/device/commands", requireDeviceAuth, (req, res, next) => {
  try {
    maintainDeviceCommands();
    const limit = normalizedLimit(req.query.limit, 5, 1, 20);
    res.json({
      ok: true,
      commands: listPendingDeviceCommands(req.device, limit)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/commands/:device_command_id/claim", requireDeviceAuth, (req, res, next) => {
  try {
    const command = claimDeviceCommand(req.device, cleanId(req.params.device_command_id), req.body || {});
    res.json({ ok: true, device_command: command });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/commands/:device_command_id/result", requireDeviceAuth, (req, res, next) => {
  try {
    const command = completeDeviceCommand(req.device, cleanId(req.params.device_command_id), req.body || {});
    res.json({ ok: true, device_command: command });
  } catch (error) {
    next(error);
  }
});

app.post("/api/device/heartbeat", requireDeviceAuth, (req, res, next) => {
  try {
    const payload = req.body || {};
    assertPayloadDeviceMatches(req.device, payload);
    const receivedAt = requestNowIso(payload);
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
    const suppliedOccurredAt = cleanString(payload.occurred_at || payload.timestamp || payload.played_at);
    const occurredAt = suppliedOccurredAt || now;
    const resolvedEvent = resolvePlaylogEventId(payload, req.device, suppliedOccurredAt);
    const eventId = resolvedEvent.event_id;
    const existing = db.prepare(`
      SELECT id, received_at FROM playlogs
      WHERE tenant_id = ? AND device_id = ? AND event_id = ?
    `).get(req.device.tenant_id, req.device.device_id, eventId);
    if (existing) {
      res.status(200).json({
        ok: true,
        duplicate: true,
        event_id: eventId,
        event_id_generated: resolvedEvent.generated,
        received_at: existing.received_at
      });
      return;
    }
    db.prepare(`
      INSERT INTO playlogs (
        device_id, tenant_id, store_id, screen_group_id, received_at, played_at,
        playlist_version, playlist_item_id, campaign_id, asset_id, layout, duration, result,
        event_id, event_type, occurred_at, content_id, playback_id,
        item_type, ad_slot_id, creative_id, qr_link_id, manifest_hash,
        planned_duration_seconds, played_duration_seconds, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.device.device_id,
      req.device.tenant_id,
      req.device.store_id,
      req.device.screen_group_id,
      now,
      occurredAt,
      cleanString(payload.playlist_version),
      cleanString(payload.playlist_item_id || payload.item_id || payload.itemId),
      cleanString(payload.campaign_id),
      cleanString(payload.asset_id),
      cleanString(payload.layout),
      asInteger(payload.duration),
      cleanString(payload.result || "started"),
      eventId,
      cleanString(payload.event_type || "playback"),
      occurredAt,
      cleanId(payload.content_id || payload.contentId),
      cleanId(payload.playback_id || payload.playbackId),
      normalizePlaylogItemType(payload.item_type || payload.type),
      cleanId(payload.ad_slot_id || payload.adSlotId),
      cleanId(payload.creative_id || payload.creativeId),
      cleanId(payload.qr_link_id || payload.qrLinkId),
      cleanString(payload.manifest_hash || payload.content_manifest_hash || payload.contentManifestHash).slice(0, 160),
      boundedReportDurationSeconds(payload.planned_duration_seconds || payload.plannedDurationSeconds || payload.duration),
      boundedReportDurationSeconds(payload.played_duration_seconds || payload.playedDurationSeconds || payload.duration),
      JSON.stringify(payload)
    );
    res.status(201).json({ ok: true, event_id: eventId, event_id_generated: resolvedEvent.generated, received_at: now });
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
    const occurredAt = cleanString(payload.occurred_at || payload.timestamp) || now;
    const resolvedEvent = resolveDeviceErrorEventId(payload, req.device, occurredAt, severity, message);
    const eventId = resolvedEvent.event_id;
    const existing = db.prepare(`
      SELECT id, received_at FROM error_logs
      WHERE tenant_id = ? AND device_id = ? AND event_id = ?
    `).get(req.device.tenant_id, req.device.device_id, eventId);
    if (existing) {
      res.status(200).json({
        ok: true,
        duplicate: true,
        event_id: eventId,
        event_id_generated: resolvedEvent.generated,
        received_at: existing.received_at
      });
      return;
    }

    db.prepare(`
      INSERT INTO error_logs (
        device_id, tenant_id, store_id, screen_group_id, received_at, occurred_at,
        severity, message, path, event_id, event_type, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.device.device_id,
      req.device.tenant_id,
      req.device.store_id,
      req.device.screen_group_id,
      now,
      occurredAt,
      severity,
      message,
      cleanString(payload.path),
      eventId,
      cleanString(payload.event_type || payload.eventType || "device_error"),
      JSON.stringify(payload)
    );

    openAlert(req.device.device_id, req.device.tenant_id, req.device.store_id, severity === "critical" ? "critical" : "warning", "device_error", message, now, payload);
    db.prepare("UPDATE devices SET last_error = ?, status = ?, updated_at = ? WHERE device_id = ?")
      .run(message, severity === "critical" ? "critical" : "degraded", now, req.device.device_id);

    res.status(201).json({ ok: true, event_id: eventId, event_id_generated: resolvedEvent.generated, received_at: now });
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
      content_id TEXT,
      asset_id TEXT,
      item_type TEXT,
      ad_slot_id TEXT,
      creative_id TEXT,
      qr_link_id TEXT,
      manifest_hash TEXT,
      layout TEXT,
      duration INTEGER,
      planned_duration_seconds INTEGER,
      played_duration_seconds INTEGER,
      result TEXT,
      event_id TEXT,
      event_type TEXT,
      occurred_at TEXT,
      playback_id TEXT,
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
      name: "mvp_offer_order_event_foundation",
      up() {
        addColumnIfMissing("playlogs", "event_id", "TEXT");
        addColumnIfMissing("playlogs", "event_type", "TEXT");
        addColumnIfMissing("playlogs", "occurred_at", "TEXT");
        addColumnIfMissing("playlogs", "content_id", "TEXT");
        addColumnIfMissing("playlogs", "playback_id", "TEXT");
        addColumnIfMissing("error_logs", "event_id", "TEXT");
        addColumnIfMissing("error_logs", "event_type", "TEXT");
        addColumnIfMissing("error_logs", "screen_group_id", "TEXT");
        addColumnIfMissing("device_log_bundles", "event_id", "TEXT");

        addColumnIfMissing("campaigns", "tenant_id", "TEXT");
        addColumnIfMissing("campaigns", "store_id", "TEXT");
        addColumnIfMissing("qr_links", "tenant_id", "TEXT");
        addColumnIfMissing("qr_links", "store_id", "TEXT");
        addColumnIfMissing("qr_links", "screen_group_id", "TEXT");
        addColumnIfMissing("qr_links", "content_id", "TEXT");
        addColumnIfMissing("qr_links", "offer_id", "TEXT");
        addColumnIfMissing("qr_links", "offer_revision_id", "TEXT");
        addColumnIfMissing("qr_links", "qr_token", "TEXT");
        addColumnIfMissing("qr_links", "destination_type", "TEXT NOT NULL DEFAULT 'external_url'");
        addColumnIfMissing("qr_links", "valid_from", "TEXT");
        addColumnIfMissing("qr_links", "valid_until", "TEXT");
        addColumnIfMissing("qr_scans", "qr_scan_id", "TEXT");
        addColumnIfMissing("qr_scans", "tenant_id", "TEXT");
        addColumnIfMissing("qr_scans", "screen_group_id", "TEXT");
        addColumnIfMissing("qr_scans", "content_id", "TEXT");
        addColumnIfMissing("qr_scans", "offer_id", "TEXT");
        addColumnIfMissing("qr_scans", "offer_revision_id", "TEXT");
        addColumnIfMissing("qr_scans", "visit_id", "TEXT");
        addColumnIfMissing("qr_scans", "near_store_status", "TEXT");

        db.exec(`
          CREATE TABLE IF NOT EXISTS store_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL UNIQUE,
            timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
            business_day_start_time TEXT NOT NULL DEFAULT '00:00',
            order_issue_cutoff_time TEXT,
            pickup_available_from TEXT,
            pickup_available_until TEXT,
            currency TEXT NOT NULL DEFAULT 'JPY',
            tax_included INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            item_name TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            default_unit_price INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'JPY',
            tax_included INTEGER NOT NULL DEFAULT 1,
            tax_amount INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            campaign_id TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            current_offer_revision_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
            FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS offer_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_revision_id TEXT NOT NULL UNIQUE,
            offer_id TEXT NOT NULL,
            revision_number INTEGER NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            campaign_id TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            title TEXT NOT NULL,
            description TEXT,
            pickup_location TEXT,
            pickup_available_from TEXT,
            pickup_available_until TEXT,
            order_issue_cutoff_time TEXT,
            valid_from TEXT,
            valid_until TEXT,
            max_orders_total INTEGER,
            max_orders_per_day INTEGER,
            max_orders_per_visit INTEGER,
            currency TEXT NOT NULL DEFAULT 'JPY',
            tax_included INTEGER NOT NULL DEFAULT 1,
            tax_amount INTEGER,
            total_amount INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            published_at TEXT,
            UNIQUE(offer_id, revision_number),
            FOREIGN KEY(offer_id) REFERENCES offers(offer_id) ON DELETE CASCADE,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
            FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS offer_revision_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_revision_item_id TEXT NOT NULL UNIQUE,
            offer_revision_id TEXT NOT NULL,
            item_id TEXT,
            item_name_snapshot TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_price_snapshot INTEGER NOT NULL DEFAULT 0,
            subtotal_amount INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'JPY',
            tax_included INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(offer_revision_id) REFERENCES offer_revisions(offer_revision_id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(item_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS counter_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            counter_order_id TEXT NOT NULL UNIQUE,
            order_number TEXT NOT NULL,
            verify_code TEXT NOT NULL,
            order_token_hash TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT,
            content_id TEXT,
            campaign_id TEXT,
            offer_id TEXT NOT NULL,
            offer_revision_id TEXT NOT NULL,
            qr_link_id TEXT,
            qr_scan_id TEXT,
            visit_id TEXT,
            business_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'issued',
            currency TEXT NOT NULL DEFAULT 'JPY',
            tax_included INTEGER NOT NULL DEFAULT 1,
            tax_amount INTEGER,
            total_amount INTEGER NOT NULL DEFAULT 0,
            issued_at TEXT NOT NULL,
            expires_at TEXT,
            redeemed_at TEXT,
            redeemed_by_user_id TEXT,
            cancelled_at TEXT,
            cancelled_by_user_id TEXT,
            cancellation_reason TEXT,
            raw_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(store_id, business_date, order_number),
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
            FOREIGN KEY(offer_id) REFERENCES offers(offer_id) ON DELETE RESTRICT,
            FOREIGN KEY(offer_revision_id) REFERENCES offer_revisions(offer_revision_id) ON DELETE RESTRICT,
            FOREIGN KEY(qr_link_id) REFERENCES qr_links(qr_link_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS counter_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            counter_order_item_id TEXT NOT NULL UNIQUE,
            counter_order_id TEXT NOT NULL,
            item_id TEXT,
            item_name_snapshot TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_price_snapshot INTEGER NOT NULL DEFAULT 0,
            subtotal_amount INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'JPY',
            tax_included INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(counter_order_id) REFERENCES counter_orders(counter_order_id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(item_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS store_access_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_access_token_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            pin_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT,
            rotated_at TEXT,
            pin_rotated_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS device_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_command_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT,
            device_id TEXT NOT NULL,
            command_type TEXT NOT NULL,
            params_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'queued',
            requested_by_user_id TEXT,
            requested_at TEXT NOT NULL,
            ttl_expires_at TEXT NOT NULL,
            claimed_at TEXT,
            completed_at TEXT,
            result_json TEXT,
            error TEXT,
            audit_log_id INTEGER,
            FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_playlogs_event_idempotency
            ON playlogs(tenant_id, device_id, event_id)
            WHERE event_id IS NOT NULL AND event_id != '';
          CREATE UNIQUE INDEX IF NOT EXISTS idx_error_logs_event_idempotency
            ON error_logs(tenant_id, device_id, event_id)
            WHERE event_id IS NOT NULL AND event_id != '';
          CREATE INDEX IF NOT EXISTS idx_store_settings_store ON store_settings(store_id);
          CREATE INDEX IF NOT EXISTS idx_items_tenant_status ON items(tenant_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_offers_store_status ON offers(store_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_offer_revisions_offer ON offer_revisions(offer_id, revision_number DESC);
          CREATE INDEX IF NOT EXISTS idx_offer_revisions_status ON offer_revisions(status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_offer_revision_items_revision ON offer_revision_items(offer_revision_id);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_links_token ON qr_links(qr_token)
            WHERE qr_token IS NOT NULL AND qr_token != '';
          CREATE INDEX IF NOT EXISTS idx_qr_links_offer ON qr_links(offer_id, offer_revision_id);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_scans_scan_id ON qr_scans(qr_scan_id)
            WHERE qr_scan_id IS NOT NULL AND qr_scan_id != '';
          CREATE INDEX IF NOT EXISTS idx_counter_orders_store_date ON counter_orders(store_id, business_date, status);
          CREATE INDEX IF NOT EXISTS idx_counter_orders_offer ON counter_orders(offer_revision_id, status, issued_at DESC);
          CREATE INDEX IF NOT EXISTS idx_counter_orders_visit ON counter_orders(offer_revision_id, visit_id, issued_at DESC);
          CREATE INDEX IF NOT EXISTS idx_counter_order_items_order ON counter_order_items(counter_order_id);
          CREATE INDEX IF NOT EXISTS idx_store_access_tokens_store ON store_access_tokens(store_id, status);
          CREATE INDEX IF NOT EXISTS idx_device_commands_device ON device_commands(device_id, status, requested_at DESC);
          CREATE INDEX IF NOT EXISTS idx_device_commands_status ON device_commands(status, ttl_expires_at);
        `);
      }
    },
    {
      version: 4,
      name: "reporting_read_model_monthly_snapshots",
      up() {
        addColumnIfMissing("report_snapshots", "tenant_id", "TEXT");
        addColumnIfMissing("report_snapshots", "store_id", "TEXT");
        addColumnIfMissing("report_snapshots", "screen_group_id", "TEXT");
        addColumnIfMissing("report_snapshots", "content_id", "TEXT");
        addColumnIfMissing("report_snapshots", "report_type", "TEXT");
        addColumnIfMissing("report_snapshots", "status", "TEXT NOT NULL DEFAULT 'draft'");
        addColumnIfMissing("report_snapshots", "title", "TEXT");
        addColumnIfMissing("report_snapshots", "summary_json", "TEXT");
        addColumnIfMissing("report_snapshots", "generated_at", "TEXT");
        addColumnIfMissing("report_snapshots", "published_at", "TEXT");
        addColumnIfMissing("report_snapshots", "snapshot_key", "TEXT");
        addColumnIfMissing("report_snapshots", "metrics_sha256", "TEXT");

        db.exec(`
          CREATE TABLE IF NOT EXISTS report_daily_store_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_key TEXT NOT NULL UNIQUE,
            metric_date TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            campaign_id TEXT,
            content_id TEXT,
            device_count INTEGER NOT NULL DEFAULT 0,
            active_device_count INTEGER NOT NULL DEFAULT 0,
            heartbeat_count INTEGER NOT NULL DEFAULT 0,
            expected_heartbeat_count INTEGER NOT NULL DEFAULT 0,
            uptime_sample_rate REAL NOT NULL DEFAULT 0,
            play_event_count INTEGER NOT NULL DEFAULT 0,
            play_started_count INTEGER NOT NULL DEFAULT 0,
            play_completed_count INTEGER NOT NULL DEFAULT 0,
            play_failed_count INTEGER NOT NULL DEFAULT 0,
            play_duration_seconds INTEGER NOT NULL DEFAULT 0,
            qr_scan_count INTEGER NOT NULL DEFAULT 0,
            counter_orders_issued_count INTEGER NOT NULL DEFAULT 0,
            counter_orders_redeemed_count INTEGER NOT NULL DEFAULT 0,
            counter_orders_cancelled_count INTEGER NOT NULL DEFAULT 0,
            counter_orders_expired_count INTEGER NOT NULL DEFAULT 0,
            counter_order_total_amount INTEGER NOT NULL DEFAULT 0,
            counter_order_redeemed_amount INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            generated_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            source_from TEXT NOT NULL,
            source_to TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_report_daily_metrics_period
            ON report_daily_store_metrics(period_start, period_end, metric_date, tenant_id, store_id);
          CREATE INDEX IF NOT EXISTS idx_report_daily_metrics_scope
            ON report_daily_store_metrics(tenant_id, store_id, campaign_id, content_id, metric_date);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_report_snapshots_snapshot_key
            ON report_snapshots(snapshot_key)
            WHERE snapshot_key IS NOT NULL AND snapshot_key != '';
          CREATE INDEX IF NOT EXISTS idx_report_snapshots_scope
            ON report_snapshots(report_type, period_start, period_end, tenant_id, store_id, campaign_id, content_id, status);
        `);

        db.prepare(`
          UPDATE report_snapshots
          SET
            report_type = COALESCE(NULLIF(report_type, ''), snapshot_type, 'monthly_summary'),
            status = COALESCE(NULLIF(status, ''), 'draft'),
            summary_json = COALESCE(NULLIF(summary_json, ''), metrics_json),
            generated_at = COALESCE(NULLIF(generated_at, ''), created_at)
        `).run();
      }
    },
    {
      version: 5,
      name: "studio_phase1_domain_publish_and_approval_contracts",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS screen_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            screen_slot_id TEXT NOT NULL UNIQUE,
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
            UNIQUE(screen_group_id, position),
            FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
            FOREIGN KEY(screen_group_id) REFERENCES screen_groups(screen_group_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS screen_device_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            binding_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            screen_slot_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            bound_at TEXT NOT NULL,
            unbound_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(screen_slot_id) REFERENCES screen_slots(screen_slot_id) ON DELETE CASCADE,
            FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS content_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            approval_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT,
            screen_group_id TEXT,
            screen_slot_id TEXT,
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
            store_id TEXT,
            screen_group_id TEXT,
            screen_slot_id TEXT,
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

          CREATE INDEX IF NOT EXISTS idx_screen_slots_group_order ON screen_slots(screen_group_id, display_order);
          CREATE INDEX IF NOT EXISTS idx_screen_slots_tenant_store ON screen_slots(tenant_id, store_id, status);
          CREATE INDEX IF NOT EXISTS idx_screen_device_bindings_slot ON screen_device_bindings(screen_slot_id, status);
          CREATE INDEX IF NOT EXISTS idx_screen_device_bindings_device ON screen_device_bindings(device_id, status);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_screen_device_bindings_active_slot ON screen_device_bindings(screen_slot_id) WHERE status = 'active';
          CREATE UNIQUE INDEX IF NOT EXISTS idx_screen_device_bindings_active_device ON screen_device_bindings(device_id) WHERE status = 'active';
          CREATE INDEX IF NOT EXISTS idx_content_approvals_subject ON content_approvals(subject_type, subject_id, approval_status);
          CREATE INDEX IF NOT EXISTS idx_content_approvals_tenant_type ON content_approvals(tenant_id, content_type, approval_status);
          CREATE INDEX IF NOT EXISTS idx_content_approvals_scope_hash ON content_approvals(tenant_id, store_id, screen_group_id, content_hash, approval_status);
          CREATE INDEX IF NOT EXISTS idx_publish_history_content ON publish_history(content_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_publish_history_scope ON publish_history(tenant_id, store_id, screen_group_id, created_at DESC);
        `);

        addColumnIfMissing("content_manifests", "tenant_id", "TEXT");
        addColumnIfMissing("content_manifests", "store_id", "TEXT");
        addColumnIfMissing("content_manifests", "screen_group_id", "TEXT");
        addColumnIfMissing("content_manifests", "screen_slot_id", "TEXT");
        addColumnIfMissing("content_manifests", "manifest_schema_version", "INTEGER NOT NULL DEFAULT 1");
        addColumnIfMissing("content_manifests", "manifest_version", "INTEGER NOT NULL DEFAULT 1");
        addColumnIfMissing("content_manifests", "content_hash", "TEXT NOT NULL DEFAULT ''");
        addColumnIfMissing("content_manifests", "lifecycle_status", "TEXT NOT NULL DEFAULT 'draft'");

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_content_manifests_scope ON content_manifests(tenant_id, store_id, screen_group_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_content_manifests_hash ON content_manifests(content_hash);
        `);
      }
    },
    {
      version: 6,
      name: "device_command_queue_runtime",
      up() {
        addColumnIfMissing("device_commands", "claim_token", "TEXT");
        addColumnIfMissing("device_commands", "claimed_by_runner_id", "TEXT");
        addColumnIfMissing("device_commands", "started_at", "TEXT");
        addColumnIfMissing("device_commands", "cancelled_at", "TEXT");
        addColumnIfMissing("device_commands", "cancelled_by_user_id", "TEXT");
        addColumnIfMissing("device_commands", "expired_at", "TEXT");
        addColumnIfMissing("device_commands", "updated_at", "TEXT");

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_device_commands_claim
            ON device_commands(device_id, status, ttl_expires_at, requested_at);
          CREATE INDEX IF NOT EXISTS idx_device_commands_audit
            ON device_commands(requested_at DESC, device_id, command_type);
        `);
      }
    },
    {
      version: 7,
      name: "counter_order_customer_and_store_staff_ux",
      up() {
        addColumnIfMissing("store_access_tokens", "last_used_at", "TEXT");

        db.exec(`
          CREATE TABLE IF NOT EXISTS store_staff_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_staff_session_id TEXT NOT NULL UNIQUE,
            store_access_token_id TEXT NOT NULL,
            session_token_hash TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT,
            FOREIGN KEY(store_access_token_id) REFERENCES store_access_tokens(store_access_token_id) ON DELETE CASCADE,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS order_page_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_page_event_id TEXT NOT NULL UNIQUE,
            counter_order_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            event_name TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            user_agent TEXT,
            ip_hash TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY(counter_order_id) REFERENCES counter_orders(counter_order_id) ON DELETE CASCADE,
            FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_store_staff_sessions_token
            ON store_staff_sessions(session_token_hash, status, expires_at);
          CREATE INDEX IF NOT EXISTS idx_store_staff_sessions_store
            ON store_staff_sessions(store_id, status, expires_at);
          CREATE INDEX IF NOT EXISTS idx_order_page_events_order
            ON order_page_events(counter_order_id, occurred_at DESC);
          CREATE INDEX IF NOT EXISTS idx_order_page_events_store
            ON order_page_events(store_id, event_name, occurred_at DESC);
        `);
      }
    },
    {
      version: 8,
      name: "public_abuse_guard_customer_reporting_access",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS public_rate_limit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_rate_limit_event_id TEXT NOT NULL UNIQUE,
            route_type TEXT NOT NULL,
            scope_hash TEXT NOT NULL,
            window_started_at TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            decision TEXT NOT NULL,
            limit_count INTEGER NOT NULL,
            window_seconds INTEGER NOT NULL,
            reason TEXT,
            ip_hash TEXT,
            user_agent_hash TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
          );

          CREATE TABLE IF NOT EXISTS customer_access_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_access_token_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            pin_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer_viewer',
            store_ids_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'active',
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT,
            rotated_at TEXT,
            pin_rotated_at TEXT,
            last_used_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS customer_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_session_id TEXT NOT NULL UNIQUE,
            customer_access_token_id TEXT NOT NULL,
            session_token_hash TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            role TEXT NOT NULL,
            store_ids_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT,
            FOREIGN KEY(customer_access_token_id) REFERENCES customer_access_tokens(customer_access_token_id) ON DELETE CASCADE,
            FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_public_rate_limit_scope
            ON public_rate_limit_events(route_type, scope_hash, window_started_at, decision);
          CREATE INDEX IF NOT EXISTS idx_public_rate_limit_time
            ON public_rate_limit_events(occurred_at DESC, decision, route_type);
          CREATE INDEX IF NOT EXISTS idx_customer_access_tokens_tenant
            ON customer_access_tokens(tenant_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_customer_sessions_token
            ON customer_sessions(session_token_hash, status, expires_at);
          CREATE INDEX IF NOT EXISTS idx_customer_sessions_tenant
            ON customer_sessions(tenant_id, status, expires_at);
        `);
      }
    },
    {
      version: 9,
      name: "ai_campaign_proposal_foundation",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS customer_context_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_context_item_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            context_category TEXT NOT NULL,
            visibility_scope TEXT NOT NULL,
            source_owner TEXT NOT NULL,
            source_type TEXT NOT NULL,
            confidence TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_key TEXT NOT NULL,
            value_json TEXT NOT NULL DEFAULT '{}',
            source TEXT NOT NULL DEFAULT 'operator',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(tenant_id, store_id, screen_group_id, item_type, item_key)
          );

          CREATE TABLE IF NOT EXISTS customer_context_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_context_snapshot_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            proposal_month TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            snapshot_sha256 TEXT NOT NULL,
            item_count INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'operator_seed',
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS proposal_generation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proposal_generation_run_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            proposal_month TEXT NOT NULL,
            context_snapshot_id TEXT NOT NULL,
            generator_type TEXT NOT NULL DEFAULT 'operator_seed',
            status TEXT NOT NULL DEFAULT 'completed',
            external_ai_used INTEGER NOT NULL DEFAULT 0,
            external_ai_provider TEXT NOT NULL DEFAULT '',
            external_ai_request_id TEXT NOT NULL DEFAULT '',
            requested_by_user_id TEXT,
            proposal_count INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            started_at TEXT NOT NULL,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(context_snapshot_id) REFERENCES customer_context_snapshots(customer_context_snapshot_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS campaign_proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_proposal_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            proposal_month TEXT NOT NULL,
            context_snapshot_id TEXT NOT NULL,
            proposal_generation_run_id TEXT,
            title TEXT NOT NULL,
            objective TEXT NOT NULL DEFAULT '',
            target_audience TEXT NOT NULL DEFAULT '',
            three_screen_outline_json TEXT NOT NULL DEFAULT '[]',
            qr_flow TEXT NOT NULL DEFAULT '',
            recommended_time_slots_json TEXT NOT NULL DEFAULT '[]',
            expected_effect TEXT NOT NULL DEFAULT '',
            required_assets_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'proposed',
            rejected_reason TEXT NOT NULL DEFAULT '',
            selected_at TEXT,
            held_at TEXT,
            rejected_at TEXT,
            created_by_user_id TEXT,
            source TEXT NOT NULL DEFAULT 'operator',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(context_snapshot_id) REFERENCES customer_context_snapshots(customer_context_snapshot_id) ON DELETE RESTRICT,
            FOREIGN KEY(proposal_generation_run_id) REFERENCES proposal_generation_runs(proposal_generation_run_id) ON DELETE SET NULL
          );

          CREATE TABLE IF NOT EXISTS campaign_proposal_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_proposal_event_id TEXT NOT NULL UNIQUE,
            campaign_proposal_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            from_status TEXT NOT NULL DEFAULT '',
            to_status TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            actor_type TEXT NOT NULL DEFAULT 'admin',
            actor_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(campaign_proposal_id) REFERENCES campaign_proposals(campaign_proposal_id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS campaign_briefs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_brief_id TEXT NOT NULL UNIQUE,
            campaign_proposal_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            context_snapshot_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'stub',
            brief_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(campaign_proposal_id) REFERENCES campaign_proposals(campaign_proposal_id) ON DELETE CASCADE,
            FOREIGN KEY(context_snapshot_id) REFERENCES customer_context_snapshots(customer_context_snapshot_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_customer_context_items_scope
            ON customer_context_items(tenant_id, store_id, screen_group_id, status, context_category, item_type, item_key);
          CREATE INDEX IF NOT EXISTS idx_customer_context_snapshots_scope
            ON customer_context_snapshots(tenant_id, store_id, screen_group_id, proposal_month, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_proposal_generation_runs_scope
            ON proposal_generation_runs(tenant_id, store_id, screen_group_id, proposal_month, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaign_proposals_scope
            ON campaign_proposals(tenant_id, store_id, screen_group_id, proposal_month, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaign_proposals_run
            ON campaign_proposals(proposal_generation_run_id, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaign_proposal_events_proposal
            ON campaign_proposal_events(campaign_proposal_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaign_briefs_scope
            ON campaign_briefs(tenant_id, store_id, screen_group_id, status, created_at DESC);
        `);
      }
    },
    {
      version: 10,
      name: "ai_context_source_assets",
      up() {
        addColumnIfMissing("customer_context_items", "deleted_at", "TEXT");
        db.exec(`
          CREATE TABLE IF NOT EXISTS customer_context_source_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_context_source_asset_id TEXT NOT NULL UNIQUE,
            customer_context_item_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            source_owner TEXT NOT NULL,
            visibility_scope TEXT NOT NULL,
            original_name TEXT NOT NULL,
            filename TEXT NOT NULL,
            extension TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            usage_notes TEXT NOT NULL DEFAULT '',
            extraction_status TEXT NOT NULL DEFAULT 'manual_no_ai',
            external_ai_used INTEGER NOT NULL DEFAULT 0,
            cost_owner TEXT NOT NULL DEFAULT 'manual_no_ai',
            status TEXT NOT NULL DEFAULT 'active',
            created_by_actor_type TEXT NOT NULL DEFAULT 'admin',
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(customer_context_item_id) REFERENCES customer_context_items(customer_context_item_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_customer_context_source_assets_item
            ON customer_context_source_assets(customer_context_item_id, status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_customer_context_source_assets_scope
            ON customer_context_source_assets(tenant_id, store_id, screen_group_id, visibility_scope, status, created_at DESC);
        `);
      }
    },
    {
      version: 11,
      name: "campaign_generator_project_foundation",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS campaign_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_project_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_brief_id TEXT NOT NULL DEFAULT '',
            source_type TEXT NOT NULL,
            source_proposal_id TEXT NOT NULL DEFAULT '',
            source_context_snapshot_id TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            objective TEXT NOT NULL DEFAULT '',
            target_audience TEXT NOT NULL DEFAULT '',
            store_context TEXT NOT NULL DEFAULT '',
            offer_or_message TEXT NOT NULL DEFAULT '',
            cta TEXT NOT NULL DEFAULT '',
            success_metrics_json TEXT NOT NULL DEFAULT '[]',
            constraints_json TEXT NOT NULL DEFAULT '[]',
            campaign_brief_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'draft',
            validation_status TEXT NOT NULL DEFAULT 'draft',
            validation_errors_json TEXT NOT NULL DEFAULT '[]',
            created_by_user_id TEXT NOT NULL DEFAULT '',
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS campaign_project_scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_project_scene_id TEXT NOT NULL UNIQUE,
            campaign_project_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            scene_order INTEGER NOT NULL,
            scene_type TEXT NOT NULL,
            headline TEXT NOT NULL DEFAULT '',
            body_text TEXT NOT NULL DEFAULT '',
            visual_direction TEXT NOT NULL DEFAULT '',
            cta_text TEXT NOT NULL DEFAULT '',
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            asset_requirements_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'draft',
            validation_status TEXT NOT NULL DEFAULT 'draft',
            validation_errors_json TEXT NOT NULL DEFAULT '[]',
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(campaign_project_id, scene_order),
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS campaign_project_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_project_event_id TEXT NOT NULL UNIQUE,
            campaign_project_id TEXT NOT NULL,
            campaign_project_scene_id TEXT NOT NULL DEFAULT '',
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            action TEXT NOT NULL,
            actor_type TEXT NOT NULL DEFAULT 'admin',
            actor_id TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_campaign_projects_scope
            ON campaign_projects(tenant_id, store_id, screen_group_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaign_projects_source_proposal
            ON campaign_projects(source_proposal_id, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_campaign_project_scenes_project
            ON campaign_project_scenes(campaign_project_id, status, scene_order);
          CREATE INDEX IF NOT EXISTS idx_campaign_project_events_project
            ON campaign_project_events(campaign_project_id, created_at DESC);
        `);
      }
    },
    {
      version: 12,
      name: "ad_measurement_proof_of_play_fields",
      up() {
        addColumnIfMissing("playlogs", "item_type", "TEXT");
        addColumnIfMissing("playlogs", "ad_slot_id", "TEXT");
        addColumnIfMissing("playlogs", "creative_id", "TEXT");
        addColumnIfMissing("playlogs", "qr_link_id", "TEXT");
        addColumnIfMissing("playlogs", "manifest_hash", "TEXT");
        addColumnIfMissing("playlogs", "planned_duration_seconds", "INTEGER");
        addColumnIfMissing("playlogs", "played_duration_seconds", "INTEGER");

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_playlogs_ad_measurement
            ON playlogs(tenant_id, store_id, campaign_id, ad_slot_id, creative_id, qr_link_id, occurred_at);
          CREATE INDEX IF NOT EXISTS idx_playlogs_manifest_hash
            ON playlogs(manifest_hash, occurred_at);
        `);
      }
    },
    {
      version: 13,
      name: "studio_cut_plan_render_contract",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS studio_layout_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            layout_template_id TEXT NOT NULL UNIQUE,
            template_version TEXT NOT NULL,
            screen_mode TEXT NOT NULL,
            canvas_width INTEGER NOT NULL,
            canvas_height INTEGER NOT NULL,
            fps INTEGER NOT NULL,
            safe_area_json TEXT NOT NULL DEFAULT '{}',
            bezel_policy TEXT NOT NULL,
            regions_json TEXT NOT NULL DEFAULT '[]',
            min_font_px INTEGER NOT NULL,
            max_line_length_chars INTEGER NOT NULL,
            contrast_policy TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS studio_cut_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cut_plan_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_revision INTEGER NOT NULL,
            source_scene_ids_json TEXT NOT NULL DEFAULT '[]',
            cut_plan_version TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            layout_template_id TEXT NOT NULL,
            scene_order_json TEXT NOT NULL DEFAULT '[]',
            screen_bindings_json TEXT NOT NULL DEFAULT '{}',
            copy_bindings_json TEXT NOT NULL DEFAULT '{}',
            visual_direction_json TEXT NOT NULL DEFAULT '{}',
            asset_requirements_json TEXT NOT NULL DEFAULT '[]',
            brand_constraints_json TEXT NOT NULL DEFAULT '{}',
            forbidden_elements_json TEXT NOT NULL DEFAULT '[]',
            measurement_goal TEXT NOT NULL DEFAULT '',
            expected_action TEXT NOT NULL DEFAULT '',
            deterministic_identity_json TEXT NOT NULL DEFAULT '{}',
            validation_status TEXT NOT NULL DEFAULT 'pending',
            validation_errors_json TEXT NOT NULL DEFAULT '[]',
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT,
            FOREIGN KEY(layout_template_id) REFERENCES studio_layout_templates(layout_template_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS studio_render_manifests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            render_manifest_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_revision INTEGER NOT NULL,
            cut_plan_id TEXT NOT NULL,
            cut_plan_version TEXT NOT NULL,
            layout_template_id TEXT NOT NULL,
            template_version TEXT NOT NULL,
            renderer TEXT NOT NULL,
            renderer_version TEXT NOT NULL,
            scene_ids_json TEXT NOT NULL DEFAULT '[]',
            source_asset_ids_json TEXT NOT NULL DEFAULT '[]',
            generated_asset_ids_json TEXT NOT NULL DEFAULT '[]',
            provider_job_ids_json TEXT NOT NULL DEFAULT '[]',
            output_type TEXT NOT NULL,
            output_ref TEXT NOT NULL DEFAULT '',
            output_sha256 TEXT NOT NULL DEFAULT '',
            resolution_width INTEGER NOT NULL,
            resolution_height INTEGER NOT NULL,
            fps INTEGER NOT NULL,
            duration_seconds INTEGER NOT NULL,
            screen_layout TEXT NOT NULL,
            qa_status TEXT NOT NULL DEFAULT 'pending',
            qa_errors_json TEXT NOT NULL DEFAULT '[]',
            render_state_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'active',
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(cut_plan_id) REFERENCES studio_cut_plans(cut_plan_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS studio_render_qa_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            render_qa_result_id TEXT NOT NULL UNIQUE,
            render_manifest_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            cut_plan_id TEXT NOT NULL,
            qa_suite_version TEXT NOT NULL,
            status TEXT NOT NULL,
            checks_json TEXT NOT NULL DEFAULT '[]',
            blocked_reasons_json TEXT NOT NULL DEFAULT '[]',
            errors_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY(render_manifest_id) REFERENCES studio_render_manifests(render_manifest_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_studio_cut_plans_project
            ON studio_cut_plans(campaign_project_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_cut_plans_scope
            ON studio_cut_plans(tenant_id, store_id, screen_group_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_render_manifests_cut_plan
            ON studio_render_manifests(cut_plan_id, status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_render_manifests_scope
            ON studio_render_manifests(tenant_id, store_id, screen_group_id, qa_status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_render_qa_results_manifest
            ON studio_render_qa_results(render_manifest_id, created_at DESC);
        `);

        const template = defaultLayoutTemplate(nowIso());
        db.prepare(`
          INSERT OR IGNORE INTO studio_layout_templates (
            layout_template_id, template_version, screen_mode, canvas_width, canvas_height, fps,
            safe_area_json, bezel_policy, regions_json, min_font_px, max_line_length_chars,
            contrast_policy, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          template.layout_template_id,
          template.template_version,
          template.screen_mode,
          template.canvas_width,
          template.canvas_height,
          template.fps,
          safeJsonStringify(template.safe_area_px, 10000),
          template.bezel_policy,
          safeJsonStringify(template.regions, 20000),
          template.min_font_px,
          template.max_line_length_chars,
          template.contrast_policy,
          template.status,
          template.created_at,
          template.updated_at
        );
      }
    },
    {
      version: 14,
      name: "studio_provider_job_foundation",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS studio_generation_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id TEXT NOT NULL UNIQUE,
            provider_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            capabilities_json TEXT NOT NULL DEFAULT '[]',
            external_network_allowed INTEGER NOT NULL DEFAULT 0,
            secrets_required INTEGER NOT NULL DEFAULT 0,
            mcp_runtime_dependency INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS ai_generation_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ai_generation_job_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL DEFAULT '',
            campaign_project_revision INTEGER NOT NULL DEFAULT 0,
            campaign_project_scene_id TEXT NOT NULL DEFAULT '',
            requested_asset_role TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            provider_model TEXT NOT NULL DEFAULT '',
            capability TEXT NOT NULL,
            input_snapshot_json TEXT NOT NULL DEFAULT '{}',
            input_sha256 TEXT NOT NULL,
            prompt_hash TEXT NOT NULL DEFAULT '',
            reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
            idempotency_key TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            error_class TEXT NOT NULL DEFAULT '',
            error_message TEXT NOT NULL DEFAULT '',
            provider_job_id TEXT NOT NULL DEFAULT '',
            output_asset_id TEXT NOT NULL DEFAULT '',
            cost_estimate_units INTEGER NOT NULL DEFAULT 0,
            cost_actual_units INTEGER,
            actor_type TEXT NOT NULL DEFAULT 'operator',
            actor_id TEXT NOT NULL DEFAULT '',
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 1,
            no_external_provider_call INTEGER NOT NULL DEFAULT 1,
            no_paid_provider_call INTEGER NOT NULL DEFAULT 1,
            no_mcp_runtime_dependency INTEGER NOT NULL DEFAULT 1,
            no_secret_material INTEGER NOT NULL DEFAULT 1,
            no_credit_consumption INTEGER NOT NULL DEFAULT 1,
            no_content_manifest_creation INTEGER NOT NULL DEFAULT 1,
            no_publish INTEGER NOT NULL DEFAULT 1,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS asset_provenance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_provenance_id TEXT NOT NULL UNIQUE,
            asset_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL DEFAULT '',
            ai_generation_job_id TEXT NOT NULL DEFAULT '',
            source_type TEXT NOT NULL,
            license_status TEXT NOT NULL,
            commercial_use_allowed INTEGER NOT NULL DEFAULT 0,
            rights_review_status TEXT NOT NULL,
            generated_by_provider TEXT NOT NULL DEFAULT '',
            provider_model TEXT NOT NULL DEFAULT '',
            provider_job_id TEXT NOT NULL DEFAULT '',
            prompt_hash TEXT NOT NULL DEFAULT '',
            reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
            source_asset_ids_json TEXT NOT NULL DEFAULT '[]',
            created_by_actor_type TEXT NOT NULL DEFAULT 'operator',
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            reviewed_by_actor_id TEXT NOT NULL DEFAULT '',
            review_notes TEXT NOT NULL DEFAULT '',
            publish_candidate_allowed INTEGER NOT NULL DEFAULT 0,
            no_external_provider_call INTEGER NOT NULL DEFAULT 1,
            no_secret_material INTEGER NOT NULL DEFAULT 1,
            no_credit_consumption INTEGER NOT NULL DEFAULT 1,
            no_content_manifest_creation INTEGER NOT NULL DEFAULT 1,
            no_publish INTEGER NOT NULL DEFAULT 1,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_generation_jobs_idempotency
            ON ai_generation_jobs(tenant_id, idempotency_key);
          CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_scope
            ON ai_generation_jobs(tenant_id, store_id, screen_group_id, campaign_project_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_scene
            ON ai_generation_jobs(campaign_project_scene_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_asset_provenance_scope
            ON asset_provenance(tenant_id, store_id, screen_group_id, campaign_project_id, rights_review_status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_asset_provenance_job
            ON asset_provenance(ai_generation_job_id, updated_at DESC);
        `);

        for (const provider of defaultProviderCatalog(nowIso())) {
          db.prepare(`
            INSERT OR IGNORE INTO studio_generation_providers (
              provider_id, provider_type, display_name, capabilities_json,
              external_network_allowed, secrets_required, mcp_runtime_dependency,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            provider.provider_id,
            provider.provider_type,
            provider.display_name,
            safeJsonStringify(provider.capabilities, 10000),
            provider.external_network_allowed ? 1 : 0,
            provider.secrets_required ? 1 : 0,
            provider.mcp_runtime_dependency ? 1 : 0,
            provider.status,
            provider.created_at,
            provider.updated_at
          );
        }
      }
    },
    {
      version: 15,
      name: "studio_publish_preflight_dry_run",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS studio_publish_preflight_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publish_preflight_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_revision INTEGER NOT NULL DEFAULT 1,
            render_manifest_id TEXT NOT NULL,
            render_manifest_output_sha256 TEXT NOT NULL DEFAULT '',
            required_asset_ids_json TEXT NOT NULL DEFAULT '[]',
            content_type TEXT NOT NULL,
            publish_mode TEXT NOT NULL,
            status TEXT NOT NULL,
            checks_json TEXT NOT NULL DEFAULT '[]',
            blocked_reasons_json TEXT NOT NULL DEFAULT '[]',
            docs99_gate_ref TEXT NOT NULL DEFAULT '',
            docs99_gate_verdict TEXT NOT NULL DEFAULT 'not_applicable',
            approval_gate_ref TEXT NOT NULL DEFAULT '',
            request_reason TEXT NOT NULL DEFAULT '',
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            no_active_content_manifest_mutation INTEGER NOT NULL DEFAULT 1,
            no_content_manifest_activation INTEGER NOT NULL DEFAULT 1,
            no_publish INTEGER NOT NULL DEFAULT 1,
            no_player_device_mutation INTEGER NOT NULL DEFAULT 1,
            no_schedule_activation INTEGER NOT NULL DEFAULT 1,
            dry_run_only INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT,
            FOREIGN KEY(render_manifest_id) REFERENCES studio_render_manifests(render_manifest_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS content_manifest_draft_transforms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_transform_id TEXT NOT NULL UNIQUE,
            publish_preflight_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_revision INTEGER NOT NULL DEFAULT 1,
            render_manifest_id TEXT NOT NULL,
            draft_content_manifest_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            transform_errors_json TEXT NOT NULL DEFAULT '[]',
            playlist_item_draft_ids_json TEXT NOT NULL DEFAULT '[]',
            schedule_draft_ids_json TEXT NOT NULL DEFAULT '[]',
            qr_link_ids_json TEXT NOT NULL DEFAULT '[]',
            content_manifest_draft_json TEXT NOT NULL DEFAULT '{}',
            content_manifest_draft_sha256 TEXT NOT NULL DEFAULT '',
            no_active_content_manifest_mutation INTEGER NOT NULL DEFAULT 1,
            no_content_manifest_activation INTEGER NOT NULL DEFAULT 1,
            no_publish INTEGER NOT NULL DEFAULT 1,
            no_player_device_mutation INTEGER NOT NULL DEFAULT 1,
            no_schedule_activation INTEGER NOT NULL DEFAULT 1,
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY(publish_preflight_id) REFERENCES studio_publish_preflight_results(publish_preflight_id) ON DELETE RESTRICT,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT,
            FOREIGN KEY(render_manifest_id) REFERENCES studio_render_manifests(render_manifest_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_studio_publish_preflights_project
            ON studio_publish_preflight_results(campaign_project_id, status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_publish_preflights_scope
            ON studio_publish_preflight_results(tenant_id, store_id, screen_group_id, content_type, status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_content_manifest_draft_transforms_preflight
            ON content_manifest_draft_transforms(publish_preflight_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_content_manifest_draft_transforms_project
            ON content_manifest_draft_transforms(campaign_project_id, status, created_at DESC);
        `);
      }
    },
    {
      version: 16,
      name: "studio_measurement_qr_binding_d1",
      up() {
        for (const tableName of ["campaign_projects", "campaign_project_scenes"]) {
          addColumnIfMissing(tableName, "content_layer", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "item_type", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "measurement_goal", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "expected_action", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "campaign_id", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "media_campaign_id", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "creative_id", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "ad_slot_id", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "qr_link_id", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "duration_class", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "variation_group", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "improvement_reason", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "previous_scene_id", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "measurement_label", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "data_source_class", "TEXT NOT NULL DEFAULT ''");
          addColumnIfMissing(tableName, "next_review_at", "TEXT NOT NULL DEFAULT ''");
        }

        for (const tableName of ["qr_links", "qr_scans"]) {
          addColumnIfMissing(tableName, "measurement_binding_id", "TEXT");
          addColumnIfMissing(tableName, "campaign_project_id", "TEXT");
          addColumnIfMissing(tableName, "campaign_project_scene_id", "TEXT");
          addColumnIfMissing(tableName, "media_campaign_id", "TEXT");
          addColumnIfMissing(tableName, "creative_id", "TEXT");
          addColumnIfMissing(tableName, "ad_slot_id", "TEXT");
          addColumnIfMissing(tableName, "measurement_label", "TEXT");
          addColumnIfMissing(tableName, "data_source_class", "TEXT");
          addColumnIfMissing(tableName, "attribution_claim", "TEXT");
        }

        db.exec(`
          CREATE TABLE IF NOT EXISTS studio_measurement_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            measurement_binding_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_revision INTEGER NOT NULL DEFAULT 1,
            campaign_project_scene_id TEXT NOT NULL DEFAULT '',
            render_manifest_id TEXT NOT NULL DEFAULT '',
            content_layer TEXT NOT NULL,
            item_type TEXT NOT NULL,
            measurement_goal TEXT NOT NULL,
            expected_action TEXT NOT NULL,
            campaign_id TEXT NOT NULL DEFAULT '',
            media_campaign_id TEXT NOT NULL DEFAULT '',
            creative_id TEXT NOT NULL,
            ad_slot_id TEXT NOT NULL DEFAULT '',
            qr_link_id TEXT NOT NULL DEFAULT '',
            variation_group TEXT NOT NULL DEFAULT '',
            improvement_reason TEXT NOT NULL DEFAULT '',
            previous_scene_id TEXT NOT NULL DEFAULT '',
            duration_class TEXT NOT NULL,
            measurement_label TEXT NOT NULL,
            data_source_class TEXT NOT NULL,
            baseline_evidence_ref TEXT NOT NULL DEFAULT '',
            holdout_evidence_ref TEXT NOT NULL DEFAULT '',
            next_review_at TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            validation_status TEXT NOT NULL DEFAULT 'invalid',
            validation_errors_json TEXT NOT NULL DEFAULT '[]',
            validation_checks_json TEXT NOT NULL DEFAULT '[]',
            deleted_at TEXT,
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT
          );

          CREATE TABLE IF NOT EXISTS studio_qr_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qr_binding_id TEXT NOT NULL UNIQUE,
            qr_link_id TEXT NOT NULL UNIQUE,
            qr_token TEXT NOT NULL DEFAULT '',
            measurement_binding_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_revision INTEGER NOT NULL DEFAULT 1,
            campaign_project_scene_id TEXT NOT NULL,
            creative_id TEXT NOT NULL,
            campaign_id TEXT NOT NULL DEFAULT '',
            media_campaign_id TEXT NOT NULL DEFAULT '',
            ad_slot_id TEXT NOT NULL DEFAULT '',
            target_url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            attribution_claim TEXT NOT NULL DEFAULT 'measured_response_only',
            expires_at TEXT NOT NULL DEFAULT '',
            created_by_actor_id TEXT NOT NULL DEFAULT '',
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(measurement_binding_id) REFERENCES studio_measurement_bindings(measurement_binding_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_studio_measurement_bindings_project
            ON studio_measurement_bindings(campaign_project_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_measurement_bindings_scope
            ON studio_measurement_bindings(tenant_id, store_id, screen_group_id, item_type, measurement_label, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_measurement_bindings_qr
            ON studio_measurement_bindings(qr_link_id, campaign_project_scene_id, creative_id);
          CREATE INDEX IF NOT EXISTS idx_studio_qr_bindings_measurement
            ON studio_qr_bindings(measurement_binding_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_qr_bindings_scope
            ON studio_qr_bindings(tenant_id, store_id, screen_group_id, campaign_project_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_qr_scans_studio_measurement
            ON qr_scans(tenant_id, store_id, campaign_project_id, campaign_project_scene_id, creative_id, qr_link_id, scanned_at);
        `);
      }
    },
    {
      version: 17,
      name: "studio_proof_of_play_reporting_connection_d3",
      up() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS studio_proof_of_play_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proof_binding_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            screen_group_id TEXT NOT NULL,
            measurement_binding_id TEXT NOT NULL,
            campaign_project_id TEXT NOT NULL,
            campaign_project_scene_id TEXT NOT NULL DEFAULT '',
            campaign_id TEXT NOT NULL DEFAULT '',
            media_campaign_id TEXT NOT NULL DEFAULT '',
            creative_id TEXT NOT NULL DEFAULT '',
            ad_slot_id TEXT NOT NULL DEFAULT '',
            qr_link_id TEXT NOT NULL DEFAULT '',
            source_system TEXT NOT NULL,
            source_event_id TEXT NOT NULL,
            source_row_id INTEGER NOT NULL DEFAULT 0,
            source_event_at TEXT NOT NULL,
            evidence_label TEXT NOT NULL,
            measurement_label TEXT NOT NULL,
            data_source_class TEXT NOT NULL,
            source_data_class TEXT NOT NULL,
            attribution_claim TEXT NOT NULL DEFAULT '',
            baseline_evidence_ref TEXT NOT NULL DEFAULT '',
            holdout_evidence_ref TEXT NOT NULL DEFAULT '',
            manifest_hash TEXT NOT NULL DEFAULT '',
            playlist_item_id TEXT NOT NULL DEFAULT '',
            play_result TEXT NOT NULL DEFAULT '',
            planned_duration_seconds INTEGER NOT NULL DEFAULT 0,
            played_duration_seconds INTEGER NOT NULL DEFAULT 0,
            qr_scan_id TEXT NOT NULL DEFAULT '',
            source_ref_json TEXT NOT NULL DEFAULT '{}',
            rebuild_key TEXT NOT NULL,
            validation_status TEXT NOT NULL DEFAULT 'invalid',
            validation_errors_json TEXT NOT NULL DEFAULT '[]',
            validation_checks_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(measurement_binding_id, source_system, source_event_id),
            FOREIGN KEY(measurement_binding_id) REFERENCES studio_measurement_bindings(measurement_binding_id) ON DELETE RESTRICT,
            FOREIGN KEY(campaign_project_id) REFERENCES campaign_projects(campaign_project_id) ON DELETE RESTRICT
          );

          CREATE INDEX IF NOT EXISTS idx_studio_proof_of_play_project
            ON studio_proof_of_play_bindings(campaign_project_id, source_system, source_event_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_proof_of_play_scope
            ON studio_proof_of_play_bindings(tenant_id, store_id, screen_group_id, evidence_label, source_event_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_proof_of_play_measurement
            ON studio_proof_of_play_bindings(measurement_binding_id, evidence_label, source_event_at DESC);
          CREATE INDEX IF NOT EXISTS idx_studio_proof_of_play_reverse_lookup
            ON studio_proof_of_play_bindings(campaign_project_scene_id, creative_id, ad_slot_id, qr_link_id);
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

function addColumnIfMissing(tableName, columnName, definition) {
  const safeTable = cleanId(tableName);
  const safeColumn = cleanId(columnName);
  if (!safeTable || !safeColumn) throw new Error("Invalid migration column target");
  const existingColumns = new Set(db.prepare(`PRAGMA table_info(${safeTable})`).all().map((column) => column.name));
  if (!existingColumns.has(safeColumn)) {
    db.exec(`ALTER TABLE ${safeTable} ADD COLUMN ${safeColumn} ${definition}`);
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

function listStoreSettings() {
  return db.prepare(`
    SELECT
      s.tenant_id,
      s.store_id,
      s.name AS store_name,
      ss.timezone,
      ss.business_day_start_time,
      ss.order_issue_cutoff_time,
      ss.pickup_available_from,
      ss.pickup_available_until,
      ss.currency,
      ss.tax_included,
      ss.notes,
      ss.created_at,
      ss.updated_at
    FROM stores s
    LEFT JOIN store_settings ss ON ss.store_id = s.store_id
    ORDER BY s.store_id
  `).all().map((row) => publicStoreSettings(withDefaultStoreSettings(row)));
}

function getStoreSettings(storeId, options = {}) {
  const store = db.prepare("SELECT * FROM stores WHERE store_id = ?").get(cleanId(storeId));
  if (!store) return null;
  const settings = db.prepare("SELECT * FROM store_settings WHERE store_id = ?").get(store.store_id);
  if (!settings && !options.withDefaults) return null;
  return publicStoreSettings(withDefaultStoreSettings({ ...store, ...(settings || {}) }));
}

function upsertStoreSettings(storeId, input) {
  const store = db.prepare("SELECT * FROM stores WHERE store_id = ?").get(cleanId(storeId));
  if (!store) throw requestError("Store not found", 404);
  const existing = db.prepare("SELECT * FROM store_settings WHERE store_id = ?").get(store.store_id);
  const normalized = normalizeStoreSettingsInput(input, { ...store, ...(existing || {}) });
  const now = nowIso();
  db.prepare(`
    INSERT INTO store_settings (
      tenant_id, store_id, timezone, business_day_start_time, order_issue_cutoff_time,
      pickup_available_from, pickup_available_until, currency, tax_included,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id) DO UPDATE SET
      timezone = excluded.timezone,
      business_day_start_time = excluded.business_day_start_time,
      order_issue_cutoff_time = excluded.order_issue_cutoff_time,
      pickup_available_from = excluded.pickup_available_from,
      pickup_available_until = excluded.pickup_available_until,
      currency = excluded.currency,
      tax_included = excluded.tax_included,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    store.tenant_id,
    store.store_id,
    normalized.timezone,
    normalized.business_day_start_time,
    normalized.order_issue_cutoff_time,
    normalized.pickup_available_from,
    normalized.pickup_available_until,
    normalized.currency,
    normalized.tax_included ? 1 : 0,
    normalized.notes,
    existing?.created_at || now,
    now
  );
  recordAuditLog("admin", "", "store_settings.upsert", "store", store.store_id, existing, getStoreSettings(store.store_id), {}, now);
  return getStoreSettings(store.store_id, { withDefaults: true });
}

function normalizeStoreSettingsInput(input, existing = {}) {
  const timezone = cleanString(input.timezone ?? existing.timezone ?? DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) throw requestError("timezone is invalid", 400);
  const businessDayStartTime = cleanString(input.business_day_start_time ?? existing.business_day_start_time ?? "00:00") || "00:00";
  assertOptionalBusinessTime("business_day_start_time", businessDayStartTime, true);
  const orderIssueCutoffTime = cleanString(input.order_issue_cutoff_time ?? existing.order_issue_cutoff_time);
  const pickupAvailableFrom = cleanString(input.pickup_available_from ?? existing.pickup_available_from);
  const pickupAvailableUntil = cleanString(input.pickup_available_until ?? existing.pickup_available_until);
  assertOptionalBusinessTime("order_issue_cutoff_time", orderIssueCutoffTime);
  assertOptionalBusinessTime("pickup_available_from", pickupAvailableFrom);
  assertOptionalBusinessTime("pickup_available_until", pickupAvailableUntil);
  return {
    timezone,
    business_day_start_time: businessDayStartTime,
    order_issue_cutoff_time: orderIssueCutoffTime,
    pickup_available_from: pickupAvailableFrom,
    pickup_available_until: pickupAvailableUntil,
    currency: normalizeCurrency(input.currency ?? existing.currency),
    tax_included: normalizeBooleanFlag(input.tax_included ?? existing.tax_included ?? true),
    notes: cleanString(input.notes ?? existing.notes).slice(0, 1000)
  };
}

function withDefaultStoreSettings(row) {
  return {
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    store_name: cleanString(row.store_name || row.name),
    timezone: cleanString(row.timezone) || DEFAULT_TIMEZONE,
    business_day_start_time: cleanString(row.business_day_start_time) || "00:00",
    order_issue_cutoff_time: cleanString(row.order_issue_cutoff_time),
    pickup_available_from: cleanString(row.pickup_available_from),
    pickup_available_until: cleanString(row.pickup_available_until),
    currency: normalizeCurrency(row.currency || DEFAULT_CURRENCY),
    tax_included: row.tax_included === undefined || row.tax_included === null ? true : row.tax_included !== 0,
    notes: cleanString(row.notes),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function publicStoreSettings(row) {
  return {
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    store_name: cleanString(row.store_name),
    timezone: row.timezone,
    business_day_start_time: row.business_day_start_time,
    order_issue_cutoff_time: row.order_issue_cutoff_time,
    pickup_available_from: row.pickup_available_from,
    pickup_available_until: row.pickup_available_until,
    currency: row.currency,
    tax_included: row.tax_included,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function listItems(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM items
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(boundedLimit).map(publicItem);
}

function createItem(input) {
  const normalized = normalizeItemInput(input);
  const existing = db.prepare("SELECT item_id FROM items WHERE item_id = ?").get(normalized.item_id);
  if (existing) throw requestError("Item already exists", 409);
  const now = nowIso();
  db.prepare(`
    INSERT INTO items (
      item_id, tenant_id, item_name, description, status, default_unit_price,
      currency, tax_included, tax_amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.item_id,
    normalized.tenant_id,
    normalized.item_name,
    normalized.description,
    normalized.status,
    normalized.default_unit_price,
    normalized.currency,
    normalized.tax_included ? 1 : 0,
    normalized.tax_amount,
    now,
    now
  );
  return getItem(normalized.item_id);
}

function updateItem(itemId, input) {
  const existing = db.prepare("SELECT * FROM items WHERE item_id = ?").get(cleanId(itemId));
  if (!existing) return null;
  const normalized = normalizeItemInput(input, existing);
  const now = nowIso();
  db.prepare(`
    UPDATE items SET
      tenant_id = ?,
      item_name = ?,
      description = ?,
      status = ?,
      default_unit_price = ?,
      currency = ?,
      tax_included = ?,
      tax_amount = ?,
      updated_at = ?
    WHERE item_id = ?
  `).run(
    normalized.tenant_id,
    normalized.item_name,
    normalized.description,
    normalized.status,
    normalized.default_unit_price,
    normalized.currency,
    normalized.tax_included ? 1 : 0,
    normalized.tax_amount,
    now,
    existing.item_id
  );
  recordAuditLog("admin", "", "item.update", "item", existing.item_id, existing, getItem(existing.item_id), {}, now);
  return getItem(existing.item_id);
}

function getItem(itemId) {
  const row = db.prepare("SELECT * FROM items WHERE item_id = ?").get(cleanId(itemId));
  return row ? publicItem(row) : null;
}

function normalizeItemInput(input, existing = {}) {
  const itemId = existing.item_id ? cleanId(existing.item_id) : cleanId(input.item_id || input.itemId || nextEntityId("item", input.item_name || input.name));
  const tenantId = cleanId(input.tenant_id ?? existing.tenant_id ?? "TEN-LOCAL");
  const itemName = cleanString(input.item_name ?? input.name ?? existing.item_name).slice(0, 160);
  if (!itemId) throw requestError("item_id is required", 400);
  if (!tenantId) throw requestError("tenant_id is required", 400);
  if (!itemName) throw requestError("item_name is required", 400);
  const status = cleanString(input.status ?? existing.status ?? "active");
  if (!ITEM_STATUS.has(status)) throw requestError(`status must be one of: ${Array.from(ITEM_STATUS).join(", ")}`, 400);
  return {
    item_id: itemId,
    tenant_id: tenantId,
    item_name: itemName,
    description: cleanString(input.description ?? existing.description).slice(0, 1000),
    status,
    default_unit_price: normalizeAmount(input.default_unit_price ?? input.unit_price ?? existing.default_unit_price, 0),
    currency: normalizeCurrency(input.currency ?? existing.currency),
    tax_included: normalizeBooleanFlag(input.tax_included ?? existing.tax_included ?? true),
    tax_amount: normalizeNullableAmount(input.tax_amount ?? existing.tax_amount)
  };
}

function publicItem(row) {
  return {
    item_id: cleanId(row.item_id),
    tenant_id: cleanId(row.tenant_id),
    item_name: cleanString(row.item_name),
    description: cleanString(row.description),
    status: cleanString(row.status),
    default_unit_price: asInteger(row.default_unit_price) || 0,
    currency: normalizeCurrency(row.currency),
    tax_included: row.tax_included !== 0,
    tax_amount: asInteger(row.tax_amount),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function resolvePlaylogEventId(payload, device, occurredAt) {
  const supplied = cleanId(payload.event_id || payload.eventId);
  if (supplied) return { event_id: supplied, generated: false };

  const identity = {
    tenant_id: cleanId(device.tenant_id),
    device_id: cleanId(device.device_id),
    occurred_at: cleanString(occurredAt),
    playlist_version: cleanString(payload.playlist_version),
    playlist_item_id: cleanString(payload.playlist_item_id || payload.item_id || payload.itemId),
    campaign_id: cleanString(payload.campaign_id),
    asset_id: cleanString(payload.asset_id),
    layout: cleanString(payload.layout),
    duration: asInteger(payload.duration),
    result: cleanString(payload.result || "started"),
    playback_id: cleanId(payload.playback_id || payload.playbackId)
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32);
  return { event_id: `legacy-${digest}`, generated: true };
}

function normalizePlaylogItemType(value) {
  const itemType = cleanString(value).toLowerCase();
  if (!itemType) return "content";
  if (!["content", "ad", "sponsor"].includes(itemType)) {
    throw requestError("item_type must be content, ad, or sponsor", 400);
  }
  return itemType;
}

function boundedReportDurationSeconds(value) {
  const duration = asInteger(value);
  if (duration === null) return null;
  return Math.max(0, Math.min(duration, 86400));
}

function resolveDeviceErrorEventId(payload, device, occurredAt, severity, message) {
  const supplied = cleanId(payload.event_id || payload.eventId);
  if (supplied) return { event_id: supplied, generated: false };

  const identity = {
    tenant_id: cleanId(device.tenant_id),
    device_id: cleanId(device.device_id),
    occurred_at: cleanString(occurredAt),
    severity: cleanString(severity),
    message: cleanString(message),
    path: cleanString(payload.path),
    event_type: cleanString(payload.event_type || payload.eventType || "device_error")
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32);
  return { event_id: `legacy-error-${digest}`, generated: true };
}

function listOffers(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM offers
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(boundedLimit).map((row) => publicOffer(row, { includeCurrentRevision: true }));
}

function createOffer(input) {
  const normalized = normalizeOfferInput(input);
  const existing = db.prepare("SELECT offer_id FROM offers WHERE offer_id = ?").get(normalized.offer_id);
  if (existing) throw requestError("Offer already exists", 409);
  const now = nowIso();
  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO offers (
        offer_id, tenant_id, store_id, campaign_id, status,
        current_offer_revision_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', ?, ?)
    `).run(
      normalized.offer_id,
      normalized.tenant_id,
      normalized.store_id,
      normalized.campaign_id || null,
      normalized.status,
      now,
      now
    );
    createOfferRevisionRecord(normalized.offer_id, normalized.revision, now);
  });
  create();
  return getOffer(normalized.offer_id, { includeRevisions: true });
}

function getOffer(offerId, options = {}) {
  const row = db.prepare("SELECT * FROM offers WHERE offer_id = ?").get(cleanId(offerId));
  return row ? publicOffer(row, options) : null;
}

function publicOffer(row, options = {}) {
  const offer = {
    offer_id: cleanId(row.offer_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    campaign_id: cleanId(row.campaign_id),
    status: cleanString(row.status),
    current_offer_revision_id: cleanId(row.current_offer_revision_id),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
  if (options.includeCurrentRevision && offer.current_offer_revision_id) {
    offer.current_revision = getOfferRevision(offer.current_offer_revision_id);
  }
  if (options.includeRevisions) {
    offer.revisions = listOfferRevisions(offer.offer_id);
  }
  return offer;
}

function assertOptionalCampaignExists(campaignId) {
  const normalized = cleanId(campaignId);
  if (!normalized) return;
  const exists = db.prepare("SELECT campaign_id FROM campaigns WHERE campaign_id = ?").get(normalized);
  if (!exists) throw requestError("campaign_id must reference an existing campaign", 400);
}

function normalizeOfferInput(input) {
  const storeId = cleanId(input.store_id || input.storeId);
  const store = db.prepare("SELECT * FROM stores WHERE store_id = ?").get(storeId);
  if (!store) throw requestError("store_id must reference an existing store", 400);
  const offerId = cleanId(input.offer_id || input.offerId || nextEntityId("offer", input.title || input.name || storeId));
  if (!offerId) throw requestError("offer_id is required", 400);
  const status = cleanString(input.status || "draft");
  if (!OFFER_STATUS.has(status)) throw requestError(`status must be one of: ${Array.from(OFFER_STATUS).join(", ")}`, 400);
  const campaignId = cleanId(input.campaign_id || input.campaignId);
  assertOptionalCampaignExists(campaignId);
  return {
    offer_id: offerId,
    tenant_id: cleanId(input.tenant_id || store.tenant_id),
    store_id: store.store_id,
    campaign_id: campaignId,
    status,
    revision: normalizeOfferRevisionInput({
      ...(input.revision || {}),
      title: input.title ?? input.revision?.title,
      description: input.description ?? input.revision?.description,
      status: input.revision?.status || (status === "active" ? "active" : "draft"),
      items: input.items ?? input.revision?.items
    }, {
      offer_id: offerId,
      tenant_id: cleanId(input.tenant_id || store.tenant_id),
      store_id: store.store_id,
      campaign_id: campaignId,
      revision_number: 1
    })
  };
}

function listOfferRevisions(offerId) {
  return db.prepare(`
    SELECT * FROM offer_revisions
    WHERE offer_id = ?
    ORDER BY revision_number DESC, id DESC
  `).all(cleanId(offerId)).map(publicOfferRevision);
}

function getOfferRevision(offerRevisionId) {
  const row = db.prepare("SELECT * FROM offer_revisions WHERE offer_revision_id = ?").get(cleanId(offerRevisionId));
  return row ? publicOfferRevision(row) : null;
}

function createOfferRevision(offerId, input) {
  const offer = db.prepare("SELECT * FROM offers WHERE offer_id = ?").get(cleanId(offerId));
  if (!offer) throw requestError("Offer not found", 404);
  const latest = db.prepare("SELECT MAX(revision_number) AS revision_number FROM offer_revisions WHERE offer_id = ?").get(offer.offer_id);
  const revisionNumber = (asInteger(latest?.revision_number) || 0) + 1;
  const normalized = normalizeOfferRevisionInput(input, {
    offer_id: offer.offer_id,
    tenant_id: offer.tenant_id,
    store_id: offer.store_id,
    campaign_id: offer.campaign_id,
    revision_number: revisionNumber
  });
  const now = nowIso();
  const create = db.transaction(() => {
    createOfferRevisionRecord(offer.offer_id, normalized, now);
  });
  create();
  return getOfferRevision(normalized.offer_revision_id);
}

function createOfferRevisionRecord(offerId, revision, now) {
  if (revision.status === "active") {
    db.prepare(`
      UPDATE offer_revisions SET status = 'retired', updated_at = ?
      WHERE offer_id = ? AND status = 'active'
    `).run(now, cleanId(offerId));
  }
  db.prepare(`
    INSERT INTO offer_revisions (
      offer_revision_id, offer_id, revision_number, tenant_id, store_id,
      campaign_id, status, title, description, pickup_location,
      pickup_available_from, pickup_available_until, order_issue_cutoff_time,
      valid_from, valid_until, max_orders_total, max_orders_per_day,
      max_orders_per_visit, currency, tax_included, tax_amount, total_amount,
      notes, created_by, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revision.offer_revision_id,
    cleanId(offerId),
    revision.revision_number,
    revision.tenant_id,
    revision.store_id,
    revision.campaign_id || null,
    revision.status,
    revision.title,
    revision.description,
    revision.pickup_location,
    revision.pickup_available_from,
    revision.pickup_available_until,
    revision.order_issue_cutoff_time,
    revision.valid_from,
    revision.valid_until,
    revision.max_orders_total,
    revision.max_orders_per_day,
    revision.max_orders_per_visit,
    revision.currency,
    revision.tax_included ? 1 : 0,
    revision.tax_amount,
    revision.total_amount,
    revision.notes,
    revision.created_by,
    now,
    now,
    revision.status === "active" ? now : null
  );
  for (const [index, item] of revision.items.entries()) {
    db.prepare(`
      INSERT INTO offer_revision_items (
        offer_revision_item_id, offer_revision_id, item_id, item_name_snapshot,
        quantity, unit_price_snapshot, subtotal_amount, currency, tax_included, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextEntityId("ori", `${revision.offer_revision_id}-${index + 1}`),
      revision.offer_revision_id,
      item.item_id,
      item.item_name_snapshot,
      item.quantity,
      item.unit_price_snapshot,
      item.subtotal_amount,
      item.currency,
      item.tax_included ? 1 : 0,
      now
    );
  }
  if (revision.status === "active") {
    db.prepare(`
      UPDATE offers SET status = 'active', current_offer_revision_id = ?, updated_at = ?
      WHERE offer_id = ?
    `).run(revision.offer_revision_id, now, cleanId(offerId));
  } else {
    db.prepare("UPDATE offers SET updated_at = ? WHERE offer_id = ?").run(now, cleanId(offerId));
  }
  recordAuditLog("admin", "", "offer_revision.create", "offer", cleanId(offerId), null, getOfferRevision(revision.offer_revision_id), {}, now);
}

function normalizeOfferRevisionInput(input, context = {}) {
  const revisionNumber = asInteger(context.revision_number || input.revision_number) || 1;
  const offerRevisionId = cleanId(input.offer_revision_id || input.offerRevisionId || `${context.offer_id}-r${revisionNumber}`);
  const status = cleanString(input.status || "draft");
  if (!OFFER_REVISION_STATUS.has(status)) throw requestError(`revision.status must be one of: ${Array.from(OFFER_REVISION_STATUS).join(", ")}`, 400);
  const title = cleanString(input.title || input.name).slice(0, 160);
  if (!title) throw requestError("revision.title is required", 400);
  const pickupFrom = cleanString(input.pickup_available_from || input.pickupAvailableFrom);
  const pickupUntil = cleanString(input.pickup_available_until || input.pickupAvailableUntil);
  const orderIssueCutoff = cleanString(input.order_issue_cutoff_time || input.orderIssueCutoffTime);
  assertOptionalBusinessTime("pickup_available_from", pickupFrom);
  assertOptionalBusinessTime("pickup_available_until", pickupUntil);
  assertOptionalBusinessTime("order_issue_cutoff_time", orderIssueCutoff);
  const currency = normalizeCurrency(input.currency);
  const taxIncluded = normalizeBooleanFlag(input.tax_included ?? true);
  const items = normalizeOfferRevisionItems(input.items, { currency, tax_included: taxIncluded });
  const calculatedTotal = items.reduce((sum, item) => sum + item.subtotal_amount, 0);
  const campaignId = cleanId(context.campaign_id || input.campaign_id || input.campaignId);
  assertOptionalCampaignExists(campaignId);
  return {
    offer_revision_id: offerRevisionId,
    offer_id: cleanId(context.offer_id || input.offer_id),
    revision_number: revisionNumber,
    tenant_id: cleanId(context.tenant_id || input.tenant_id),
    store_id: cleanId(context.store_id || input.store_id),
    campaign_id: campaignId,
    status,
    title,
    description: cleanString(input.description).slice(0, 2000),
    pickup_location: cleanString(input.pickup_location || input.pickupLocation).slice(0, 240),
    pickup_available_from: pickupFrom,
    pickup_available_until: pickupUntil,
    order_issue_cutoff_time: orderIssueCutoff,
    valid_from: cleanString(input.valid_from || input.validFrom),
    valid_until: cleanString(input.valid_until || input.validUntil),
    max_orders_total: normalizeNullableLimit(input.max_orders_total ?? input.maxOrdersTotal),
    max_orders_per_day: normalizeNullableLimit(input.max_orders_per_day ?? input.maxOrdersPerDay),
    max_orders_per_visit: normalizeNullableLimit(input.max_orders_per_visit ?? input.maxOrdersPerVisit),
    currency,
    tax_included: taxIncluded,
    tax_amount: normalizeNullableAmount(input.tax_amount),
    total_amount: normalizeAmount(input.total_amount ?? calculatedTotal, calculatedTotal),
    notes: cleanString(input.notes).slice(0, 1000),
    created_by: cleanString(input.created_by || input.createdBy).slice(0, 120),
    items
  };
}

function normalizeOfferRevisionItems(value, defaults = {}) {
  const source = Array.isArray(value) ? value : [];
  return source.map((item, index) => {
    const itemId = cleanId(item.item_id || item.itemId);
    const catalogItem = itemId ? getItem(itemId) : null;
    const itemName = cleanString(item.item_name || item.name || catalogItem?.item_name).slice(0, 160);
    if (!itemName) throw requestError(`items[${index}].item_name is required`, 400);
    const quantity = Math.max(1, normalizeAmount(item.quantity, 1));
    const unitPrice = normalizeAmount(item.unit_price_snapshot ?? item.unit_price ?? catalogItem?.default_unit_price, 0);
    const currency = normalizeCurrency(item.currency || catalogItem?.currency || defaults.currency);
    const taxIncluded = normalizeBooleanFlag(item.tax_included ?? catalogItem?.tax_included ?? defaults.tax_included ?? true);
    return {
      item_id: itemId,
      item_name_snapshot: itemName,
      quantity,
      unit_price_snapshot: unitPrice,
      subtotal_amount: unitPrice * quantity,
      currency,
      tax_included: taxIncluded
    };
  });
}

function publicOfferRevision(row) {
  const revision = {
    offer_revision_id: cleanId(row.offer_revision_id),
    offer_id: cleanId(row.offer_id),
    revision_number: asInteger(row.revision_number) || 1,
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    campaign_id: cleanId(row.campaign_id),
    status: cleanString(row.status),
    title: cleanString(row.title),
    description: cleanString(row.description),
    pickup_location: cleanString(row.pickup_location),
    pickup_available_from: cleanString(row.pickup_available_from),
    pickup_available_until: cleanString(row.pickup_available_until),
    order_issue_cutoff_time: cleanString(row.order_issue_cutoff_time),
    valid_from: cleanString(row.valid_from),
    valid_until: cleanString(row.valid_until),
    max_orders_total: asInteger(row.max_orders_total),
    max_orders_per_day: asInteger(row.max_orders_per_day),
    max_orders_per_visit: asInteger(row.max_orders_per_visit),
    currency: normalizeCurrency(row.currency),
    tax_included: row.tax_included !== 0,
    tax_amount: asInteger(row.tax_amount),
    total_amount: asInteger(row.total_amount) || 0,
    notes: cleanString(row.notes),
    created_by: cleanString(row.created_by),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    published_at: cleanString(row.published_at)
  };
  revision.items = listOfferRevisionItems(revision.offer_revision_id);
  return revision;
}

function listOfferRevisionItems(offerRevisionId) {
  return db.prepare(`
    SELECT * FROM offer_revision_items
    WHERE offer_revision_id = ?
    ORDER BY id ASC
  `).all(cleanId(offerRevisionId)).map((row) => ({
    offer_revision_item_id: cleanId(row.offer_revision_item_id),
    offer_revision_id: cleanId(row.offer_revision_id),
    item_id: cleanId(row.item_id),
    item_name_snapshot: cleanString(row.item_name_snapshot),
    quantity: asInteger(row.quantity) || 1,
    unit_price_snapshot: asInteger(row.unit_price_snapshot) || 0,
    subtotal_amount: asInteger(row.subtotal_amount) || 0,
    currency: normalizeCurrency(row.currency),
    tax_included: row.tax_included !== 0,
    created_at: cleanString(row.created_at)
  }));
}

function listQrLinks(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(asInteger(limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM qr_links
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(boundedLimit).map(publicQrLink);
}

function createQrLink(input) {
  const normalized = normalizeQrLinkInput(input);
  const existing = db.prepare("SELECT qr_link_id FROM qr_links WHERE qr_link_id = ? OR qr_token = ?").get(normalized.qr_link_id, normalized.qr_token);
  if (existing) throw requestError("QR link already exists", 409);
  const now = nowIso();
  db.prepare(`
    INSERT INTO qr_links (
      qr_link_id, campaign_id, advertiser_id, qr_id, label, destination_url,
      short_path, status, tenant_id, store_id, screen_group_id, content_id,
      offer_id, offer_revision_id, qr_token, destination_type, valid_from,
      valid_until, measurement_binding_id, campaign_project_id, campaign_project_scene_id,
      media_campaign_id, creative_id, ad_slot_id, measurement_label, data_source_class,
      attribution_claim, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.qr_link_id,
    normalized.campaign_id || null,
    null,
    normalized.qr_link_id,
    normalized.label,
    normalized.destination_url,
    normalized.short_path,
    normalized.status,
    normalized.tenant_id,
    normalized.store_id,
    normalized.screen_group_id,
    normalized.content_id,
    normalized.offer_id || null,
    normalized.offer_revision_id || null,
    normalized.qr_token,
    normalized.destination_type,
    normalized.valid_from,
    normalized.valid_until,
    normalized.measurement_binding_id || null,
    normalized.campaign_project_id || null,
    normalized.campaign_project_scene_id || null,
    normalized.media_campaign_id || null,
    normalized.creative_id || null,
    normalized.ad_slot_id || null,
    normalized.measurement_label || null,
    normalized.data_source_class || null,
    normalized.attribution_claim || null,
    now,
    now
  );
  return getQrLink(normalized.qr_link_id);
}

function normalizeQrLinkInput(input) {
  const qrLinkId = cleanId(input.qr_link_id || input.qrLinkId || nextEntityId("qr", input.label || input.destination_type));
  const qrToken = cleanId(input.qr_token || input.qrToken || crypto.randomBytes(12).toString("base64url"));
  const destinationType = cleanString(input.destination_type || input.destinationType || "external_url");
  if (!QR_DESTINATION_TYPES.has(destinationType)) throw requestError(`destination_type must be one of: ${Array.from(QR_DESTINATION_TYPES).join(", ")}`, 400);
  const offerId = cleanId(input.offer_id || input.offerId);
  const requestedOfferRevisionId = cleanId(input.offer_revision_id || input.offerRevisionId);
  const pinOfferRevision = normalizeBooleanFlag(input.pin_offer_revision ?? input.pinOfferRevision ?? Boolean(requestedOfferRevisionId));
  const offerRevision = requestedOfferRevisionId ? getOfferRevision(requestedOfferRevisionId) : (offerId ? resolveActiveOfferRevision(offerId) : null);
  if (requestedOfferRevisionId && !offerRevision) throw requestError("offer_revision_id was not found", 404);
  if (destinationType === "counter_order_offer" && !offerRevision) {
    throw requestError("counter_order_offer QR links require an active offer_revision", 400);
  }
  const destinationUrl = cleanString(input.destination_url || input.destinationUrl) ||
    (destinationType === "counter_order_offer" ? `/q/${qrToken}` : "");
  if (!destinationUrl) throw requestError("destination_url is required", 400);
  const campaignId = cleanId(input.campaign_id || input.campaignId || offerRevision?.campaign_id);
  assertOptionalCampaignExists(campaignId);
  return {
    qr_link_id: qrLinkId,
    qr_token: qrToken,
    tenant_id: cleanId(input.tenant_id || offerRevision?.tenant_id),
    store_id: cleanId(input.store_id || offerRevision?.store_id),
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId),
    content_id: cleanId(input.content_id || input.contentId),
    campaign_id: campaignId,
    offer_id: cleanId(offerId || offerRevision?.offer_id),
    offer_revision_id: pinOfferRevision ? cleanId(requestedOfferRevisionId || offerRevision?.offer_revision_id) : "",
    label: cleanString(input.label || offerRevision?.title || qrLinkId).slice(0, 160),
    destination_type: destinationType,
    destination_url: destinationUrl,
    short_path: cleanString(input.short_path || input.shortPath || `/q/${qrToken}`).slice(0, 160),
    valid_from: cleanString(input.valid_from || input.validFrom),
    valid_until: cleanString(input.valid_until || input.validUntil),
    status: cleanString(input.status || "active") || "active",
    measurement_binding_id: cleanId(input.measurement_binding_id || input.measurementBindingId),
    campaign_project_id: cleanId(input.campaign_project_id || input.campaignProjectId),
    campaign_project_scene_id: cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId || input.scene_id || input.sceneId),
    media_campaign_id: cleanId(input.media_campaign_id || input.mediaCampaignId),
    creative_id: cleanId(input.creative_id || input.creativeId),
    ad_slot_id: cleanId(input.ad_slot_id || input.adSlotId),
    measurement_label: cleanString(input.measurement_label || input.measurementLabel).slice(0, 40),
    data_source_class: cleanString(input.data_source_class || input.dataSourceClass).slice(0, 80),
    attribution_claim: cleanString(input.attribution_claim || input.attributionClaim).slice(0, 80)
  };
}

function getQrLink(qrLinkId) {
  const row = db.prepare("SELECT * FROM qr_links WHERE qr_link_id = ?").get(cleanId(qrLinkId));
  return row ? publicQrLink(row) : null;
}

function getQrLinkByToken(qrToken) {
  const token = cleanId(qrToken);
  const row = db.prepare(`
    SELECT * FROM qr_links
    WHERE qr_token = ?
       OR short_path = ?
  `).get(token, `/q/${token}`);
  return row ? publicQrLink(row) : null;
}

function assertQrLinkUsable(qrLink) {
  const now = nowIso();
  if (qrLink.status !== "active") throw requestError("QR link is not active", 410);
  if (qrLink.valid_from && now < qrLink.valid_from) throw requestError("QR link is not valid yet", 410);
  if (qrLink.valid_until && now > qrLink.valid_until) throw requestError("QR link has expired", 410);
}

function recordQrScan(qrLink, req) {
  const now = requestNowIso({ ...(req.query || {}), ...(req.body || {}) });
  const qrScanId = nextEntityId("qrs", qrLink.qr_link_id);
  const userAgent = cleanString(req.get("user-agent")).slice(0, 500);
  const referrer = cleanString(req.get("referer") || req.get("referrer")).slice(0, 500);
  const ipHash = hashToken(`${req.ip || ""}:${DEVICE_TOKEN_PEPPER}`);
  const visitId = cleanId(req.query.visit_id || req.body?.visit_id || req.body?.visitId);
  const offerRevision = resolveQrLinkOfferRevision(qrLink);
  db.prepare(`
    INSERT INTO qr_scans (
      qr_scan_id, qr_link_id, campaign_id, advertiser_id, store_id, device_id,
      scanned_at, user_agent, ip_hash, referrer, raw_json, tenant_id,
      screen_group_id, content_id, offer_id, offer_revision_id, visit_id,
      near_store_status, measurement_binding_id, campaign_project_id,
      campaign_project_scene_id, media_campaign_id, creative_id, ad_slot_id,
      measurement_label, data_source_class, attribution_claim
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    qrScanId,
    qrLink.qr_link_id,
    cleanId(qrLink.campaign_id || offerRevision?.campaign_id) || null,
    null,
    qrLink.store_id || offerRevision?.store_id,
    null,
    now,
    userAgent,
    ipHash,
    referrer,
    JSON.stringify({ query: req.query || {}, body: req.body || {} }),
    qrLink.tenant_id || offerRevision?.tenant_id,
    qrLink.screen_group_id,
    qrLink.content_id,
    cleanId(qrLink.offer_id || offerRevision?.offer_id) || null,
    cleanId(qrLink.offer_revision_id || offerRevision?.offer_revision_id) || null,
    visitId,
    cleanString(req.query.near_store_status || "unknown"),
    qrLink.measurement_binding_id || null,
    qrLink.campaign_project_id || null,
    qrLink.campaign_project_scene_id || null,
    qrLink.media_campaign_id || null,
    qrLink.creative_id || null,
    qrLink.ad_slot_id || null,
    qrLink.measurement_label || null,
    qrLink.data_source_class || null,
    cleanString(qrLink.attribution_claim || "measured_response_only")
  );
  return {
    qr_scan_id: qrScanId,
    qr_link_id: qrLink.qr_link_id,
    campaign_id: cleanId(qrLink.campaign_id || offerRevision?.campaign_id),
    store_id: cleanId(qrLink.store_id || offerRevision?.store_id),
    campaign_project_id: cleanId(qrLink.campaign_project_id),
    campaign_project_scene_id: cleanId(qrLink.campaign_project_scene_id),
    media_campaign_id: cleanId(qrLink.media_campaign_id),
    creative_id: cleanId(qrLink.creative_id),
    ad_slot_id: cleanId(qrLink.ad_slot_id),
    measurement_label: cleanString(qrLink.measurement_label),
    data_source_class: cleanString(qrLink.data_source_class),
    attribution_claim: cleanString(qrLink.attribution_claim || "measured_response_only"),
    scanned_at: now,
    visit_id: visitId,
    near_store_status: cleanString(req.query.near_store_status || "unknown")
  };
}

function resolveQrLinkOfferRevision(qrLink) {
  if (qrLink.offer_revision_id) return getOfferRevision(qrLink.offer_revision_id);
  if (qrLink.offer_id) return resolveActiveOfferRevision(qrLink.offer_id);
  return null;
}

function resolveQrScanForOrder(qrLink, req) {
  const suppliedQrScanId = cleanId(req.body?.qr_scan_id || req.body?.qrScanId);
  if (!suppliedQrScanId) return recordQrScan(qrLink, req);
  const row = db.prepare(`
    SELECT * FROM qr_scans
    WHERE qr_scan_id = ? AND qr_link_id = ?
  `).get(suppliedQrScanId, qrLink.qr_link_id);
  if (!row) throw requestError("qr_scan_id was not found for this QR link", 400);
  return publicQrScan(row);
}

function publicQrScan(row) {
  return {
    qr_scan_id: cleanId(row.qr_scan_id),
    qr_link_id: cleanId(row.qr_link_id),
    campaign_id: cleanId(row.campaign_id),
    store_id: cleanId(row.store_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    media_campaign_id: cleanId(row.media_campaign_id),
    creative_id: cleanId(row.creative_id),
    ad_slot_id: cleanId(row.ad_slot_id),
    measurement_label: cleanString(row.measurement_label),
    data_source_class: cleanString(row.data_source_class),
    attribution_claim: cleanString(row.attribution_claim || "measured_response_only"),
    scanned_at: cleanString(row.scanned_at),
    visit_id: cleanId(row.visit_id),
    near_store_status: cleanString(row.near_store_status || "unknown")
  };
}

function publicQrLink(row) {
  return {
    qr_link_id: cleanId(row.qr_link_id),
    qr_token: cleanId(row.qr_token),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    content_id: cleanId(row.content_id),
    campaign_id: cleanId(row.campaign_id),
    measurement_binding_id: cleanId(row.measurement_binding_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    media_campaign_id: cleanId(row.media_campaign_id),
    creative_id: cleanId(row.creative_id),
    ad_slot_id: cleanId(row.ad_slot_id),
    measurement_label: cleanString(row.measurement_label),
    data_source_class: cleanString(row.data_source_class),
    attribution_claim: cleanString(row.attribution_claim || "measured_response_only"),
    offer_id: cleanId(row.offer_id),
    offer_revision_id: cleanId(row.offer_revision_id),
    revision_binding: row.offer_revision_id ? "pinned" : (row.offer_id ? "current_offer_revision" : ""),
    label: cleanString(row.label),
    destination_type: cleanString(row.destination_type || "external_url"),
    destination_url: cleanString(row.destination_url),
    short_path: cleanString(row.short_path),
    status: cleanString(row.status),
    valid_from: cleanString(row.valid_from),
    valid_until: cleanString(row.valid_until),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function listCounterOrders(query = {}) {
  const tenantId = cleanId(query.tenant_id || query.tenantId);
  const storeId = cleanId(query.store_id);
  const status = cleanString(query.status);
  const q = cleanString(query.q || query.search || "").slice(0, 80);
  const boundedLimit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  const qLike = q ? `%${q}%` : "";
  const rows = db.prepare(`
    SELECT * FROM counter_orders
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR status = ?)
      AND (? = '' OR order_number LIKE ? OR verify_code LIKE ? OR counter_order_id LIKE ?)
    ORDER BY issued_at DESC, id DESC
    LIMIT ?
  `).all(tenantId, tenantId, storeId, storeId, status, status, q, qLike, qLike, qLike, boundedLimit);
  return rows.map(publicCounterOrder);
}

function createCounterOrder(input) {
  const now = requestNowIso(input);
  const revision = resolveCounterOrderOfferRevision(input);
  validateCounterOrderIssuance(revision, input, now);
  const storeSettings = getStoreSettings(revision.store_id, { withDefaults: true });
  const businessDate = businessDateFor(now, storeSettings.timezone, storeSettings.business_day_start_time);
  const orderNumber = nextOrderNumber(revision.store_id, businessDate);
  const verifyCode = String(crypto.randomInt(0, 10000)).padStart(4, "0");
  const orderToken = crypto.randomBytes(24).toString("base64url");
  const orderId = cleanId(input.counter_order_id || input.counterOrderId || nextEntityId("co", `${revision.store_id}-${businessDate}-${orderNumber}`));
  const qrLinkId = cleanId(input.qr_link_id || input.qrLinkId);
  const qrLink = qrLinkId ? getQrLink(qrLinkId) : null;
  const qrScanId = cleanId(input.qr_scan_id || input.qrScanId);
  const visitId = cleanId(input.visit_id || input.visitId);
  const expiresAt = cleanString(input.expires_at || input.expiresAt || revision.valid_until);
  const raw = {
    ...input,
    order_token: undefined
  };
  const items = listOfferRevisionItems(revision.offer_revision_id);
  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO counter_orders (
        counter_order_id, order_number, verify_code, order_token_hash,
        tenant_id, store_id, screen_group_id, content_id, campaign_id,
        offer_id, offer_revision_id, qr_link_id, qr_scan_id, visit_id,
        business_date, status, currency, tax_included, tax_amount,
        total_amount, issued_at, expires_at, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      orderNumber,
      verifyCode,
      hashToken(orderToken),
      revision.tenant_id,
      revision.store_id,
      cleanId(input.screen_group_id || input.screenGroupId || qrLink?.screen_group_id),
      cleanId(input.content_id || input.contentId || qrLink?.content_id),
      cleanId(input.campaign_id || input.campaignId || revision.campaign_id || qrLink?.campaign_id) || null,
      revision.offer_id,
      revision.offer_revision_id,
      qrLinkId || null,
      qrScanId || null,
      visitId || null,
      businessDate,
      revision.currency,
      revision.tax_included ? 1 : 0,
      revision.tax_amount,
      revision.total_amount,
      now,
      expiresAt,
      JSON.stringify(raw),
      now,
      now
    );
    for (const [index, item] of items.entries()) {
      db.prepare(`
        INSERT INTO counter_order_items (
          counter_order_item_id, counter_order_id, item_id, item_name_snapshot,
          quantity, unit_price_snapshot, subtotal_amount, currency, tax_included, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextEntityId("coi", `${orderId}-${index + 1}`),
        orderId,
        item.item_id,
        item.item_name_snapshot,
        item.quantity,
        item.unit_price_snapshot,
        item.subtotal_amount,
        item.currency,
        item.tax_included ? 1 : 0,
        now
      );
    }
  });
  create();
  return {
    counter_order: getCounterOrder(orderId),
    order_token: orderToken,
    order_url: `/order/${orderToken}`
  };
}

function updateCounterOrderStatus(counterOrderId, input) {
  const existing = db.prepare("SELECT * FROM counter_orders WHERE counter_order_id = ?").get(cleanId(counterOrderId));
  if (!existing) return null;
  const status = cleanString(input.status);
  if (!COUNTER_ORDER_STATUS.has(status)) throw requestError(`status must be one of: ${Array.from(COUNTER_ORDER_STATUS).join(", ")}`, 400);
  const now = nowIso();
  const redeemedAt = status === "redeemed" ? now : (status === "issued" ? null : existing.redeemed_at);
  const cancelledAt = status === "cancelled" ? now : (status === "issued" ? null : existing.cancelled_at);
  db.prepare(`
    UPDATE counter_orders SET
      status = ?,
      redeemed_at = ?,
      redeemed_by_user_id = ?,
      cancelled_at = ?,
      cancelled_by_user_id = ?,
      cancellation_reason = ?,
      updated_at = ?
    WHERE counter_order_id = ?
  `).run(
    status,
    redeemedAt,
    status === "redeemed" ? cleanString(input.actor_id || input.redeemed_by_user_id || "admin").slice(0, 120) : (status === "issued" ? "" : existing.redeemed_by_user_id),
    cancelledAt,
    status === "cancelled" ? cleanString(input.actor_id || input.cancelled_by_user_id || "admin").slice(0, 120) : (status === "issued" ? "" : existing.cancelled_by_user_id),
    status === "cancelled" ? cleanString(input.reason || input.cancellation_reason).slice(0, 1000) : (status === "issued" ? "" : existing.cancellation_reason),
    now,
    existing.counter_order_id
  );
  recordAuditLog(
    cleanString(input.actor_type || "admin"),
    cleanString(input.actor_id || "admin"),
    cleanString(input.audit_action || "counter_order.status_update"),
    "counter_order",
    existing.counter_order_id,
    existing,
    getCounterOrder(existing.counter_order_id),
    {
      status,
      store_id: cleanId(existing.store_id),
      reason: cleanString(input.reason || input.cancellation_reason).slice(0, 1000)
    },
    now
  );
  return getCounterOrder(existing.counter_order_id);
}

function getCounterOrder(counterOrderId) {
  const row = db.prepare("SELECT * FROM counter_orders WHERE counter_order_id = ?").get(cleanId(counterOrderId));
  return row ? publicCounterOrder(row) : null;
}

function getCounterOrderByToken(orderToken) {
  if (!orderToken) return null;
  const row = db.prepare("SELECT * FROM counter_orders WHERE order_token_hash = ?").get(hashToken(orderToken));
  return row ? publicCounterOrder(row) : null;
}

function publicCounterOrder(row) {
  const order = {
    counter_order_id: cleanId(row.counter_order_id),
    order_number: cleanString(row.order_number),
    verify_code: cleanString(row.verify_code),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    content_id: cleanId(row.content_id),
    campaign_id: cleanId(row.campaign_id),
    offer_id: cleanId(row.offer_id),
    offer_revision_id: cleanId(row.offer_revision_id),
    qr_link_id: cleanId(row.qr_link_id),
    qr_scan_id: cleanId(row.qr_scan_id),
    visit_id: cleanId(row.visit_id),
    business_date: cleanString(row.business_date),
    status: cleanString(row.status),
    currency: normalizeCurrency(row.currency),
    tax_included: row.tax_included !== 0,
    tax_amount: asInteger(row.tax_amount),
    total_amount: asInteger(row.total_amount) || 0,
    issued_at: cleanString(row.issued_at),
    expires_at: cleanString(row.expires_at),
    redeemed_at: cleanString(row.redeemed_at),
    redeemed_by_user_id: cleanString(row.redeemed_by_user_id),
    cancelled_at: cleanString(row.cancelled_at),
    cancelled_by_user_id: cleanString(row.cancelled_by_user_id),
    cancellation_reason: cleanString(row.cancellation_reason),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
  order.items = db.prepare(`
    SELECT * FROM counter_order_items
    WHERE counter_order_id = ?
    ORDER BY id ASC
  `).all(order.counter_order_id).map((item) => ({
    counter_order_item_id: cleanId(item.counter_order_item_id),
    counter_order_id: cleanId(item.counter_order_id),
    item_id: cleanId(item.item_id),
    item_name_snapshot: cleanString(item.item_name_snapshot),
    quantity: asInteger(item.quantity) || 1,
    unit_price_snapshot: asInteger(item.unit_price_snapshot) || 0,
    subtotal_amount: asInteger(item.subtotal_amount) || 0,
    currency: normalizeCurrency(item.currency),
    tax_included: item.tax_included !== 0,
    created_at: cleanString(item.created_at)
  }));
  return order;
}

function withCounterOrderStoreProfile(order) {
  const store = getStoreSettings(order.store_id, { withDefaults: true }) || {
    tenant_id: order.tenant_id,
    store_id: order.store_id,
    store_name: order.store_id,
    timezone: DEFAULT_TIMEZONE,
    business_day_start_time: "00:00",
    pickup_available_from: "",
    pickup_available_until: "",
    currency: order.currency,
    tax_included: order.tax_included
  };
  const revision = order.offer_revision_id ? getOfferRevision(order.offer_revision_id) : null;
  const pickupAvailableFrom = cleanString(revision?.pickup_available_from || store.pickup_available_from);
  const pickupAvailableUntil = cleanString(revision?.pickup_available_until || store.pickup_available_until);
  const validUntil = cleanString(order.expires_at || revision?.valid_until);
  return {
    ...order,
    store: {
      tenant_id: cleanId(store.tenant_id || order.tenant_id),
      store_id: cleanId(store.store_id || order.store_id),
      store_name: cleanString(store.store_name || order.store_id),
      timezone: cleanString(store.timezone || DEFAULT_TIMEZONE),
      pickup_available_from: cleanString(store.pickup_available_from),
      pickup_available_until: cleanString(store.pickup_available_until)
    },
    offer_revision: revision ? {
      offer_revision_id: revision.offer_revision_id,
      title: revision.title,
      pickup_location: revision.pickup_location,
      pickup_available_from: revision.pickup_available_from,
      pickup_available_until: revision.pickup_available_until,
      valid_until: revision.valid_until
    } : null,
    receipt_snapshot: {
      offer_title: cleanString(revision?.title),
      pickup_location: cleanString(revision?.pickup_location),
      pickup_available_from: pickupAvailableFrom,
      pickup_available_until: pickupAvailableUntil,
      pickup_window: formatPickupWindow(pickupAvailableFrom, pickupAvailableUntil),
      valid_until: validUntil,
      currency: normalizeCurrency(order.currency),
      tax_included: order.tax_included !== false,
      tax_amount: asInteger(order.tax_amount),
      total_amount: asInteger(order.total_amount) || 0
    }
  };
}

function recordOrderPageEvent(orderToken, input, req) {
  const order = getCounterOrderByToken(orderToken);
  if (!order) throw requestError("Order not found", 404);
  const eventName = cleanString(input.event_name || input.eventName || input.name || "view").slice(0, 80);
  if (!ORDER_PAGE_EVENTS.has(eventName)) {
    throw requestError(`event_name must be one of: ${Array.from(ORDER_PAGE_EVENTS).join(", ")}`, 400);
  }
  const now = requestNowIso(input);
  const metadata = {
    source: cleanString(input.source || "order_page").slice(0, 80),
    previous_order_token_present: Boolean(input.previous_order_token_present || input.previousOrderTokenPresent),
    user_action: cleanString(input.user_action || input.userAction).slice(0, 120)
  };
  const eventId = nextEntityId("ope", `${order.counter_order_id}-${eventName}`);
  db.prepare(`
    INSERT INTO order_page_events (
      order_page_event_id, counter_order_id, tenant_id, store_id, event_name,
      occurred_at, user_agent, ip_hash, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    order.counter_order_id,
    order.tenant_id,
    order.store_id,
    eventName,
    now,
    cleanString(req.get("user-agent")).slice(0, 500),
    hashToken(`${req.ip || ""}:${DEVICE_TOKEN_PEPPER}`),
    JSON.stringify(metadata)
  );
  return {
    order_page_event_id: eventId,
    counter_order_id: order.counter_order_id,
    event_name: eventName,
    occurred_at: now
  };
}

function createStoreAccessToken(storeId, input, actor = {}) {
  const store = db.prepare("SELECT * FROM stores WHERE store_id = ?").get(cleanId(storeId));
  if (!store) throw requestError("Store not found", 404);
  const pin = normalizeStoreStaffPin(input.pin);
  const now = nowIso();
  const token = generateStoreAccessToken();
  const tokenId = nextEntityId("sat", store.store_id);
  const row = {
    store_access_token_id: tokenId,
    tenant_id: store.tenant_id,
    store_id: store.store_id,
    token_hash: hashStoreAccessToken(token),
    pin_hash: hashStoreStaffPin(tokenId, pin),
    status: "active",
    failed_attempts: 0,
    locked_until: "",
    rotated_at: "",
    pin_rotated_at: now,
    notes: cleanString(input.notes).slice(0, 1000),
    created_at: now,
    updated_at: now
  };
  db.prepare(`
    INSERT INTO store_access_tokens (
      store_access_token_id, tenant_id, store_id, token_hash, pin_hash, status,
      failed_attempts, locked_until, rotated_at, pin_rotated_at, notes, created_at, updated_at
    ) VALUES (
      @store_access_token_id, @tenant_id, @store_id, @token_hash, @pin_hash, @status,
      @failed_attempts, @locked_until, @rotated_at, @pin_rotated_at, @notes, @created_at, @updated_at
    )
  `).run(row);
  const created = getStoreAccessToken(tokenId);
  recordAuditLog("admin", actor.actor_id || "admin", "store_access_token.create", "store_access_token", tokenId, null, created, {
    store_id: store.store_id,
    actor_role: actor.role || ""
  }, now);
  return {
    store_access_token: created,
    store_token: token,
    store_orders_url: `/store/orders/${token}`
  };
}

function listStoreAccessTokens(query = {}) {
  const storeId = cleanId(query.store_id || query.storeId);
  const status = cleanString(query.status);
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT sat.*, s.name AS store_name
    FROM store_access_tokens sat
    LEFT JOIN stores s ON s.store_id = sat.store_id
    WHERE (? = '' OR sat.store_id = ?)
      AND (? = '' OR sat.status = ?)
    ORDER BY sat.updated_at DESC, sat.id DESC
    LIMIT ?
  `).all(storeId, storeId, status, status, limit).map(publicStoreAccessToken);
}

function getStoreAccessToken(storeAccessTokenId) {
  const row = db.prepare(`
    SELECT sat.*, s.name AS store_name
    FROM store_access_tokens sat
    LEFT JOIN stores s ON s.store_id = sat.store_id
    WHERE sat.store_access_token_id = ?
  `).get(cleanId(storeAccessTokenId));
  return row ? publicStoreAccessToken(row) : null;
}

function getStoreAccessTokenByRawToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT sat.*, s.name AS store_name
    FROM store_access_tokens sat
    LEFT JOIN stores s ON s.store_id = sat.store_id
    WHERE sat.token_hash = ?
  `).get(hashStoreAccessToken(token));
  return row ? publicStoreAccessToken(row, { includeHashFields: true }) : null;
}

function rotateStoreAccessToken(storeAccessTokenId, input, actor = {}) {
  const existing = db.prepare("SELECT * FROM store_access_tokens WHERE store_access_token_id = ?").get(cleanId(storeAccessTokenId));
  if (!existing) throw requestError("Store access token not found", 404);
  const now = nowIso();
  const token = generateStoreAccessToken();
  db.transaction(() => {
    db.prepare(`
      UPDATE store_access_tokens SET
        token_hash = ?,
        status = 'active',
        failed_attempts = 0,
        locked_until = '',
        rotated_at = ?,
        notes = COALESCE(NULLIF(?, ''), notes),
        updated_at = ?
      WHERE store_access_token_id = ?
    `).run(hashStoreAccessToken(token), now, cleanString(input.notes).slice(0, 1000), now, existing.store_access_token_id);
    db.prepare(`
      UPDATE store_staff_sessions SET
        status = 'revoked',
        revoked_at = ?
      WHERE store_access_token_id = ?
        AND status = 'active'
    `).run(now, existing.store_access_token_id);
  })();
  const updated = getStoreAccessToken(existing.store_access_token_id);
  recordAuditLog("admin", actor.actor_id || "admin", "store_access_token.rotate", "store_access_token", existing.store_access_token_id, publicStoreAccessToken(existing), updated, {
    store_id: existing.store_id,
    actor_role: actor.role || ""
  }, now);
  return {
    store_access_token: updated,
    store_token: token,
    store_orders_url: `/store/orders/${token}`
  };
}

function resetStoreAccessTokenPin(storeAccessTokenId, input, actor = {}) {
  const existing = db.prepare("SELECT * FROM store_access_tokens WHERE store_access_token_id = ?").get(cleanId(storeAccessTokenId));
  if (!existing) throw requestError("Store access token not found", 404);
  const pin = normalizeStoreStaffPin(input.pin);
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE store_access_tokens SET
        pin_hash = ?,
        failed_attempts = 0,
        locked_until = '',
        pin_rotated_at = ?,
        updated_at = ?
      WHERE store_access_token_id = ?
    `).run(hashStoreStaffPin(existing.store_access_token_id, pin), now, now, existing.store_access_token_id);
    db.prepare(`
      UPDATE store_staff_sessions SET
        status = 'revoked',
        revoked_at = ?
      WHERE store_access_token_id = ?
        AND status = 'active'
    `).run(now, existing.store_access_token_id);
  })();
  const updated = getStoreAccessToken(existing.store_access_token_id);
  recordAuditLog("admin", actor.actor_id || "admin", "store_access_token.pin_reset", "store_access_token", existing.store_access_token_id, publicStoreAccessToken(existing), updated, {
    store_id: existing.store_id,
    actor_role: actor.role || ""
  }, now);
  return updated;
}

function createStoreStaffSession(storeToken, input, req) {
  const access = getStoreAccessTokenByRawToken(storeToken);
  if (!access) throw requestError("Store access token not found", 404);
  const now = nowIso();
  if (access.status !== "active") throw requestError("Store access token is not active", 403);
  if (access.locked_until && access.locked_until > now) {
    recordStoreStaffLoginAudit(access, "store_staff.login_locked", req, { locked_until: access.locked_until }, now);
    throw requestError("PIN is temporarily locked", 429);
  }
  const pin = normalizeStoreStaffPin(input.pin, { label: "pin", allowEmpty: false });
  const expectedHash = hashStoreStaffPin(access.store_access_token_id, pin);
  if (!safeEqualHex(access.pin_hash, expectedHash)) {
    const failedAttempts = (asInteger(access.failed_attempts) || 0) + 1;
    const lockedUntil = failedAttempts >= STORE_STAFF_PIN_MAX_ATTEMPTS
      ? new Date(Date.now() + STORE_STAFF_PIN_LOCK_SECONDS * 1000).toISOString()
      : "";
    db.prepare(`
      UPDATE store_access_tokens SET
        failed_attempts = ?,
        locked_until = ?,
        updated_at = ?
      WHERE store_access_token_id = ?
    `).run(failedAttempts, lockedUntil, now, access.store_access_token_id);
    recordStoreStaffLoginAudit(access, "store_staff.login_failed", req, { failed_attempts: failedAttempts, locked_until: lockedUntil }, now);
    throw requestError(lockedUntil ? "PIN is temporarily locked" : "PIN is invalid", lockedUntil ? 429 : 401);
  }

  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STORE_STAFF_SESSION_TTL_SECONDS * 1000).toISOString();
  const sessionId = nextEntityId("sss", access.store_id);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO store_staff_sessions (
        store_staff_session_id, store_access_token_id, session_token_hash,
        tenant_id, store_id, status, created_at, expires_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      sessionId,
      access.store_access_token_id,
      hashStoreStaffSessionToken(sessionToken),
      access.tenant_id,
      access.store_id,
      now,
      expiresAt,
      now
    );
    db.prepare(`
      UPDATE store_access_tokens SET
        failed_attempts = 0,
        locked_until = '',
        last_used_at = ?,
        updated_at = ?
      WHERE store_access_token_id = ?
    `).run(now, now, access.store_access_token_id);
  })();
  const session = getStoreStaffSessionById(sessionId);
  recordStoreStaffLoginAudit(access, "store_staff.login_success", req, { session_id: sessionId }, now);
  return {
    ...session,
    session_token: sessionToken
  };
}

function requireStoreStaffSession(req, res, next) {
  try {
    const token = getStoreStaffSessionToken(req);
    if (!token) throw requestError("Store staff session is required", 401);
    const session = getStoreStaffSessionByRawToken(token);
    if (!session) throw requestError("Store staff session is invalid", 401);
    const now = nowIso();
    if (session.status !== "active" || session.expires_at <= now) {
      throw requestError("Store staff session has expired", 401);
    }
    if (session.access_token_status !== "active") {
      throw requestError("Store access token is not active", 403);
    }
    db.prepare("UPDATE store_staff_sessions SET last_used_at = ? WHERE store_staff_session_id = ?").run(now, session.store_staff_session_id);
    req.storeStaffSession = {
      ...session,
      last_used_at: now
    };
    next();
  } catch (error) {
    next(error);
  }
}

function updateStoreCounterOrderStatus(session, counterOrderId, input) {
  const order = getCounterOrder(counterOrderId);
  if (!order) throw requestError("Counter order not found", 404);
  if (order.store_id !== session.store_id) throw requestError("Counter order is outside this store", 403);
  const status = cleanString(input.status);
  if (!["issued", "redeemed", "cancelled"].includes(status)) {
    throw requestError("status must be one of: issued, redeemed, cancelled", 400);
  }
  if (status === "redeemed") {
    const suppliedVerifyCode = cleanString(input.verify_code || input.verifyCode);
    if (!suppliedVerifyCode) throw requestError("verify_code is required to redeem", 400);
    if (!safeEqualString(order.verify_code, suppliedVerifyCode)) {
      throw requestError("verify_code does not match", 403);
    }
  }
  return updateCounterOrderStatus(order.counter_order_id, {
    ...input,
    actor_type: "store_staff",
    actor_id: session.store_staff_session_id,
    audit_action: "counter_order.staff_status_update"
  });
}

function revokeStoreStaffSession(session) {
  const now = nowIso();
  db.prepare(`
    UPDATE store_staff_sessions SET
      status = 'revoked',
      revoked_at = ?,
      last_used_at = ?
    WHERE store_staff_session_id = ?
  `).run(now, now, session.store_staff_session_id);
}

function getStoreStaffSessionByRawToken(token) {
  const row = db.prepare(`
    SELECT
      sss.*,
      sat.status AS access_token_status,
      sat.notes AS access_token_notes,
      st.name AS store_name
    FROM store_staff_sessions sss
    JOIN store_access_tokens sat ON sat.store_access_token_id = sss.store_access_token_id
    LEFT JOIN stores st ON st.store_id = sss.store_id
    WHERE sss.session_token_hash = ?
  `).get(hashStoreStaffSessionToken(token));
  return row ? publicStoreStaffSessionRow(row) : null;
}

function getStoreStaffSessionById(sessionId) {
  const row = db.prepare(`
    SELECT
      sss.*,
      sat.status AS access_token_status,
      sat.notes AS access_token_notes,
      st.name AS store_name
    FROM store_staff_sessions sss
    JOIN store_access_tokens sat ON sat.store_access_token_id = sss.store_access_token_id
    LEFT JOIN stores st ON st.store_id = sss.store_id
    WHERE sss.store_staff_session_id = ?
  `).get(cleanId(sessionId));
  return row ? publicStoreStaffSessionRow(row) : null;
}

function publicStoreStaffSessionRow(row) {
  const store = getStoreSettings(row.store_id, { withDefaults: true }) || {
    tenant_id: row.tenant_id,
    store_id: row.store_id,
    store_name: row.store_name || row.store_id
  };
  return {
    store_staff_session_id: cleanId(row.store_staff_session_id),
    store_access_token_id: cleanId(row.store_access_token_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    status: cleanString(row.status),
    access_token_status: cleanString(row.access_token_status),
    created_at: cleanString(row.created_at),
    expires_at: cleanString(row.expires_at),
    last_used_at: cleanString(row.last_used_at),
    revoked_at: cleanString(row.revoked_at),
    store: {
      tenant_id: cleanId(store.tenant_id || row.tenant_id),
      store_id: cleanId(store.store_id || row.store_id),
      store_name: cleanString(store.store_name || row.store_name || row.store_id),
      timezone: cleanString(store.timezone || DEFAULT_TIMEZONE),
      pickup_available_from: cleanString(store.pickup_available_from),
      pickup_available_until: cleanString(store.pickup_available_until)
    }
  };
}

function publicStoreStaffSession(session) {
  return {
    store_staff_session_id: session.store_staff_session_id,
    store_access_token_id: session.store_access_token_id,
    tenant_id: session.tenant_id,
    store_id: session.store_id,
    status: session.status,
    expires_at: session.expires_at,
    last_used_at: session.last_used_at
  };
}

function publicStoreAccessToken(row, options = {}) {
  const token = {
    store_access_token_id: cleanId(row.store_access_token_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    store_name: cleanString(row.store_name),
    status: cleanString(row.status),
    failed_attempts: asInteger(row.failed_attempts) || 0,
    locked_until: cleanString(row.locked_until),
    rotated_at: cleanString(row.rotated_at),
    pin_rotated_at: cleanString(row.pin_rotated_at),
    last_used_at: cleanString(row.last_used_at),
    notes: cleanString(row.notes),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    store_orders_path: `/store/orders/:store_token`
  };
  if (options.includeHashFields) {
    token.token_hash = cleanString(row.token_hash);
    token.pin_hash = cleanString(row.pin_hash);
  }
  return token;
}

function recordStoreStaffLoginAudit(access, action, req, metadata = {}, createdAt = nowIso()) {
  recordAuditLog("store_staff", access.store_access_token_id, action, "store_access_token", access.store_access_token_id, null, null, {
    store_id: access.store_id,
    tenant_id: access.tenant_id,
    ip_hash: hashToken(`${req.ip || ""}:${DEVICE_TOKEN_PEPPER}`),
    user_agent: cleanString(req.get("user-agent")).slice(0, 500),
    ...metadata
  }, createdAt);
}

function normalizeStoreStaffPin(value, options = {}) {
  const pin = cleanString(value);
  if (!pin && options.allowEmpty !== true) throw requestError(`${options.label || "pin"} is required`, 400);
  if (!/^\d{4,12}$/.test(pin)) throw requestError(`${options.label || "pin"} must be 4 to 12 digits`, 400);
  return pin;
}

function enforcePublicRateLimit(req, routeType, rawScope, options = {}) {
  const limit = Math.max(1, asInteger(options.limit) || 1);
  const windowSeconds = Math.max(10, asInteger(options.windowSeconds) || 60);
  const now = requestNowIso({ ...(req.query || {}), ...(req.body || {}) });
  const occurredAt = new Date(now).getTime();
  const windowStartedAt = new Date(Math.floor(occurredAt / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const ipHash = hashToken(`${req.ip || ""}:${DEVICE_TOKEN_PEPPER}`);
  const userAgent = cleanString(req.get("user-agent")).slice(0, 500);
  const userAgentHash = hashToken(userAgent);
  const visitId = cleanId(req.query?.visit_id || req.query?.visitId || req.body?.visit_id || req.body?.visitId);
  const scopeHash = hashToken(JSON.stringify({
    route_type: cleanString(routeType),
    scope: cleanString(rawScope),
    visit_id: visitId,
    ip_hash: ipHash,
    user_agent_hash: userAgentHash
  }));
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM public_rate_limit_events
    WHERE route_type = ?
      AND scope_hash = ?
      AND window_started_at = ?
      AND decision = 'allow'
  `).get(cleanString(routeType), scopeHash, windowStartedAt).count;
  const allowed = count < limit;
  const reason = allowed ? "" : "public_rate_limit_exceeded";
  recordPublicRateLimitEvent({
    route_type: routeType,
    scope_hash: scopeHash,
    window_started_at: windowStartedAt,
    occurred_at: now,
    decision: allowed ? "allow" : "reject",
    limit_count: limit,
    window_seconds: windowSeconds,
    reason,
    ip_hash: ipHash,
    user_agent_hash: userAgentHash,
    metadata: {
      method: cleanString(req.method),
      route_type: cleanString(routeType),
      visit_id_present: Boolean(visitId)
    }
  });
  if (!allowed) {
    recordAuditLog("public", "anonymous", "public_rate_limit.reject", "public_route", cleanString(routeType), null, null, {
      route_type: cleanString(routeType),
      scope_hash: scopeHash,
      window_started_at: windowStartedAt,
      limit_count: limit,
      window_seconds: windowSeconds,
      ip_hash: ipHash,
      user_agent_hash: userAgentHash
    }, now);
    throw requestError("Public rate limit exceeded", 429);
  }
}

function recordPublicRateLimitEvent(event) {
  db.prepare(`
    INSERT INTO public_rate_limit_events (
      public_rate_limit_event_id, route_type, scope_hash, window_started_at,
      occurred_at, decision, limit_count, window_seconds, reason,
      ip_hash, user_agent_hash, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nextEntityId("prl", `${event.route_type}-${event.scope_hash}-${event.occurred_at}`),
    cleanString(event.route_type).slice(0, 80),
    cleanString(event.scope_hash),
    cleanString(event.window_started_at),
    cleanString(event.occurred_at),
    cleanString(event.decision),
    asInteger(event.limit_count) || 0,
    asInteger(event.window_seconds) || 0,
    cleanString(event.reason).slice(0, 200),
    cleanString(event.ip_hash),
    cleanString(event.user_agent_hash),
    JSON.stringify(event.metadata || {})
  );
}

function createCustomerAccessToken(tenantId, input, actor = {}) {
  const tenant = db.prepare("SELECT * FROM tenants WHERE tenant_id = ?").get(cleanId(tenantId));
  if (!tenant) throw requestError("Tenant not found", 404);
  const pin = normalizeStoreStaffPin(input.pin, { label: "pin" });
  const role = normalizeCustomerRole(input.role || "customer_viewer");
  const storeIds = normalizeCustomerStoreIds(input.store_ids || input.storeIds || input.store_id || input.storeId, tenant.tenant_id);
  const now = nowIso();
  const token = generateCustomerAccessToken();
  const tokenId = nextEntityId("cat", tenant.tenant_id);
  const row = {
    customer_access_token_id: tokenId,
    tenant_id: tenant.tenant_id,
    token_hash: hashCustomerAccessToken(token),
    pin_hash: hashCustomerPin(tokenId, pin),
    role,
    store_ids_json: JSON.stringify(storeIds),
    status: "active",
    failed_attempts: 0,
    locked_until: "",
    rotated_at: "",
    pin_rotated_at: now,
    last_used_at: "",
    notes: cleanString(input.notes).slice(0, 1000),
    created_at: now,
    updated_at: now
  };
  db.prepare(`
    INSERT INTO customer_access_tokens (
      customer_access_token_id, tenant_id, token_hash, pin_hash, role,
      store_ids_json, status, failed_attempts, locked_until, rotated_at,
      pin_rotated_at, last_used_at, notes, created_at, updated_at
    ) VALUES (
      @customer_access_token_id, @tenant_id, @token_hash, @pin_hash, @role,
      @store_ids_json, @status, @failed_attempts, @locked_until, @rotated_at,
      @pin_rotated_at, @last_used_at, @notes, @created_at, @updated_at
    )
  `).run(row);
  const created = getCustomerAccessToken(tokenId);
  recordAuditLog("admin", actor.actor_id || "admin", "customer_access_token.create", "customer_access_token", tokenId, null, created, {
    tenant_id: tenant.tenant_id,
    actor_role: actor.role || "",
    role,
    store_ids: storeIds
  }, now);
  return {
    customer_access_token: created,
    customer_admin_url: `/customer/admin/${tokenId}`
  };
}

function listCustomerAccessTokens(query = {}) {
  const tenantId = cleanId(query.tenant_id || query.tenantId);
  const status = cleanString(query.status);
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT cat.*, t.name AS tenant_name
    FROM customer_access_tokens cat
    LEFT JOIN tenants t ON t.tenant_id = cat.tenant_id
    WHERE (? = '' OR cat.tenant_id = ?)
      AND (? = '' OR cat.status = ?)
    ORDER BY cat.updated_at DESC, cat.id DESC
    LIMIT ?
  `).all(tenantId, tenantId, status, status, limit).map(publicCustomerAccessToken);
}

function getCustomerAccessToken(customerAccessTokenId) {
  const row = db.prepare(`
    SELECT cat.*, t.name AS tenant_name
    FROM customer_access_tokens cat
    LEFT JOIN tenants t ON t.tenant_id = cat.tenant_id
    WHERE cat.customer_access_token_id = ?
  `).get(cleanId(customerAccessTokenId));
  return row ? publicCustomerAccessToken(row) : null;
}

function getCustomerAccessTokenForAuth(customerAccessTokenId) {
  if (!customerAccessTokenId) return null;
  const row = db.prepare(`
    SELECT cat.*, t.name AS tenant_name
    FROM customer_access_tokens cat
    LEFT JOIN tenants t ON t.tenant_id = cat.tenant_id
    WHERE cat.customer_access_token_id = ?
  `).get(cleanId(customerAccessTokenId));
  return row ? publicCustomerAccessToken(row, { includeHashFields: true }) : null;
}

function createCustomerSession(customerAccessTokenId, input, req) {
  const access = getCustomerAccessTokenForAuth(customerAccessTokenId);
  if (!access) throw requestError("Customer access token not found", 404);
  const now = nowIso();
  if (access.status !== "active") throw requestError("Customer access token is not active", 403);
  if (access.locked_until && access.locked_until > now) {
    recordCustomerLoginAudit(access, "customer.login_locked", req, { locked_until: access.locked_until }, now);
    throw requestError("PIN is temporarily locked", 429);
  }
  const pin = normalizeStoreStaffPin(input.pin, { label: "pin", allowEmpty: false });
  const expectedHash = hashCustomerPin(access.customer_access_token_id, pin);
  if (!safeEqualHex(access.pin_hash, expectedHash)) {
    const failedAttempts = (asInteger(access.failed_attempts) || 0) + 1;
    const lockedUntil = failedAttempts >= CUSTOMER_PIN_MAX_ATTEMPTS
      ? new Date(Date.now() + CUSTOMER_PIN_LOCK_SECONDS * 1000).toISOString()
      : "";
    db.prepare(`
      UPDATE customer_access_tokens SET
        failed_attempts = ?,
        locked_until = ?,
        updated_at = ?
      WHERE customer_access_token_id = ?
    `).run(failedAttempts, lockedUntil, now, access.customer_access_token_id);
    recordCustomerLoginAudit(access, "customer.login_failed", req, { failed_attempts: failedAttempts, locked_until: lockedUntil }, now);
    throw requestError(lockedUntil ? "PIN is temporarily locked" : "PIN is invalid", lockedUntil ? 429 : 401);
  }

  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_SECONDS * 1000).toISOString();
  const sessionId = nextEntityId("cus", access.tenant_id);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO customer_sessions (
        customer_session_id, customer_access_token_id, session_token_hash,
        tenant_id, role, store_ids_json, status, created_at, expires_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      sessionId,
      access.customer_access_token_id,
      hashCustomerSessionToken(sessionToken),
      access.tenant_id,
      access.role,
      JSON.stringify(access.store_ids || []),
      now,
      expiresAt,
      now
    );
    db.prepare(`
      UPDATE customer_access_tokens SET
        failed_attempts = 0,
        locked_until = '',
        last_used_at = ?,
        updated_at = ?
      WHERE customer_access_token_id = ?
    `).run(now, now, access.customer_access_token_id);
  })();
  const session = getCustomerSessionById(sessionId);
  recordCustomerLoginAudit(access, "customer.login_success", req, { session_id: sessionId }, now);
  return {
    ...session,
    session_token: sessionToken
  };
}

function requireCustomerSession(req, res, next) {
  try {
    const token = getCustomerSessionToken(req);
    if (!token) throw requestError("Customer session is required", 401);
    const session = getCustomerSessionByRawToken(token);
    if (!session) throw requestError("Customer session is invalid", 401);
    const now = nowIso();
    if (session.status !== "active" || session.expires_at <= now) {
      throw requestError("Customer session has expired", 401);
    }
    if (session.access_token_status !== "active") {
      throw requestError("Customer access token is not active", 403);
    }
    db.prepare("UPDATE customer_sessions SET last_used_at = ? WHERE customer_session_id = ?").run(now, session.customer_session_id);
    req.customerSession = {
      ...session,
      last_used_at: now
    };
    next();
  } catch (error) {
    next(error);
  }
}

function requireCustomerEditor(req, res, next) {
  if (!CUSTOMER_EDIT_ROLES.has(req.customerSession?.role)) {
    res.status(403).json({ error: "Customer role cannot edit offers" });
    return;
  }
  next();
}

function revokeCustomerSession(session) {
  const now = nowIso();
  db.prepare(`
    UPDATE customer_sessions SET
      status = 'revoked',
      revoked_at = ?,
      last_used_at = ?
    WHERE customer_session_id = ?
  `).run(now, now, session.customer_session_id);
}

function getCustomerSessionByRawToken(token) {
  const row = db.prepare(`
    SELECT
      cs.*,
      cat.status AS access_token_status,
      cat.notes AS access_token_notes,
      t.name AS tenant_name
    FROM customer_sessions cs
    JOIN customer_access_tokens cat ON cat.customer_access_token_id = cs.customer_access_token_id
    LEFT JOIN tenants t ON t.tenant_id = cs.tenant_id
    WHERE cs.session_token_hash = ?
  `).get(hashCustomerSessionToken(token));
  return row ? publicCustomerSessionRow(row) : null;
}

function getCustomerSessionById(sessionId) {
  const row = db.prepare(`
    SELECT
      cs.*,
      cat.status AS access_token_status,
      cat.notes AS access_token_notes,
      t.name AS tenant_name
    FROM customer_sessions cs
    JOIN customer_access_tokens cat ON cat.customer_access_token_id = cs.customer_access_token_id
    LEFT JOIN tenants t ON t.tenant_id = cs.tenant_id
    WHERE cs.customer_session_id = ?
  `).get(cleanId(sessionId));
  return row ? publicCustomerSessionRow(row) : null;
}

function publicCustomerSessionRow(row) {
  return {
    customer_session_id: cleanId(row.customer_session_id),
    customer_access_token_id: cleanId(row.customer_access_token_id),
    tenant_id: cleanId(row.tenant_id),
    tenant_name: cleanString(row.tenant_name || row.tenant_id),
    role: normalizeCustomerRole(row.role || "customer_viewer"),
    store_ids: parseStoreIdsJson(row.store_ids_json),
    status: cleanString(row.status),
    access_token_status: cleanString(row.access_token_status),
    created_at: cleanString(row.created_at),
    expires_at: cleanString(row.expires_at),
    last_used_at: cleanString(row.last_used_at),
    revoked_at: cleanString(row.revoked_at)
  };
}

function publicCustomerSession(session) {
  return {
    customer_session_id: session.customer_session_id,
    customer_access_token_id: session.customer_access_token_id,
    tenant_id: session.tenant_id,
    tenant_name: session.tenant_name,
    role: session.role,
    store_ids: session.store_ids || [],
    status: session.status,
    expires_at: session.expires_at,
    last_used_at: session.last_used_at
  };
}

function publicCustomerAccessToken(row, options = {}) {
  const token = {
    customer_access_token_id: cleanId(row.customer_access_token_id),
    tenant_id: cleanId(row.tenant_id),
    tenant_name: cleanString(row.tenant_name || row.tenant_id),
    role: normalizeCustomerRole(row.role || "customer_viewer"),
    store_ids: parseStoreIdsJson(row.store_ids_json),
    status: cleanString(row.status),
    failed_attempts: asInteger(row.failed_attempts) || 0,
    locked_until: cleanString(row.locked_until),
    rotated_at: cleanString(row.rotated_at),
    pin_rotated_at: cleanString(row.pin_rotated_at),
    last_used_at: cleanString(row.last_used_at),
    notes: cleanString(row.notes),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    customer_admin_path: "/customer/admin/:customer_access_token_id"
  };
  if (options.includeHashFields) {
    token.token_hash = cleanString(row.token_hash);
    token.pin_hash = cleanString(row.pin_hash);
  }
  return token;
}

function normalizeCustomerRole(value) {
  const role = cleanString(value || "customer_viewer");
  if (!CUSTOMER_ROLES.has(role)) throw requestError(`role must be one of: ${Array.from(CUSTOMER_ROLES).join(", ")}`, 400);
  return role;
}

function normalizeCustomerStoreIds(value, tenantId) {
  const raw = Array.isArray(value) ? value : cleanString(value).split(",");
  const storeIds = Array.from(new Set(raw.map(cleanId).filter(Boolean)));
  for (const storeId of storeIds) {
    const store = db.prepare("SELECT tenant_id FROM stores WHERE store_id = ?").get(storeId);
    if (!store) throw requestError(`store_id was not found: ${storeId}`, 400);
    if (cleanId(store.tenant_id) !== cleanId(tenantId)) throw requestError(`store_id is outside tenant scope: ${storeId}`, 403);
  }
  return storeIds;
}

function parseStoreIdsJson(value) {
  const parsed = parseJson(value || "[]", []);
  return Array.isArray(parsed) ? parsed.map(cleanId).filter(Boolean) : [];
}

function assertCustomerStoreScope(session, storeId) {
  const normalizedStoreId = cleanId(storeId);
  if (!normalizedStoreId) return "";
  const store = db.prepare("SELECT tenant_id FROM stores WHERE store_id = ?").get(normalizedStoreId);
  if (!store) throw requestError("Store not found", 404);
  if (cleanId(store.tenant_id) !== session.tenant_id) throw requestError("Store is outside tenant scope", 403);
  if (session.store_ids?.length && !session.store_ids.includes(normalizedStoreId)) {
    throw requestError("Store is outside customer scope", 403);
  }
  return normalizedStoreId;
}

function defaultCustomerStoreId(session, suppliedStoreId = "") {
  const storeId = cleanId(suppliedStoreId);
  if (storeId) return assertCustomerStoreScope(session, storeId);
  if (session.store_ids?.length === 1) return session.store_ids[0];
  if (session.store_ids?.length > 1) throw requestError("store_id is required for multi-store customer scope", 400);
  return "";
}

function normalizeCustomerReportCriteria(input, session) {
  const criteria = normalizeReportCriteria({
    ...input,
    tenant_id: session.tenant_id,
    store_id: defaultCustomerStoreId(session, input.store_id || input.storeId || input.site_id || input.siteId)
  });
  return criteria;
}

function normalizeCustomerCounterOrderQuery(input, session) {
  const storeId = defaultCustomerStoreId(session, input.store_id || input.storeId);
  return {
    ...input,
    tenant_id: session.tenant_id,
    store_id: storeId
  };
}

function buildCustomerConversionReport(criteria, session) {
  const summary = buildReportSummary(criteria);
  const totals = summary.totals || {};
  const issued = asInteger(totals.counter_orders_issued_count) || 0;
  const redeemed = asInteger(totals.counter_orders_redeemed_count) || 0;
  const scans = asInteger(totals.qr_scan_count) || 0;
  const kpis = {
    qr_scan_count: scans,
    counter_orders_issued_count: issued,
    counter_orders_redeemed_count: redeemed,
    potential_sales_amount: asInteger(totals.counter_order_total_amount) || 0,
    estimated_redeemed_amount: asInteger(totals.counter_order_redeemed_amount) || 0,
    scan_to_order_rate: scans > 0 ? issued / scans : 0,
    order_to_redeem_rate: issued > 0 ? redeemed / issued : 0,
    amount_wording: {
      potential_sales_amount: "受付発行額。POS決済済み売上ではありません。",
      estimated_redeemed_amount: "引換済み推定額。現地会計の確定売上ではありません。"
    }
  };
  return {
    ...summary,
    audience: "customer",
    customer_scope: {
      tenant_id: session.tenant_id,
      role: session.role,
      store_ids: session.store_ids || []
    },
    kpis
  };
}

function listCustomerStoreSettings(session) {
  return listStoreSettings().filter((store) => {
    if (store.tenant_id !== session.tenant_id) return false;
    return !session.store_ids?.length || session.store_ids.includes(store.store_id);
  });
}

function listCustomerScreenGroups(session) {
  return db.prepare(`
    SELECT tenant_id, store_id, location_id, screen_group_id, name, display_count, created_at, updated_at
    FROM screen_groups
    WHERE tenant_id = ?
    ORDER BY store_id ASC, screen_group_id ASC
    LIMIT 500
  `).all(session.tenant_id).filter((group) => {
    return !session.store_ids?.length || session.store_ids.includes(cleanId(group.store_id));
  }).map((group) => ({
    tenant_id: cleanId(group.tenant_id),
    store_id: cleanId(group.store_id),
    location_id: cleanId(group.location_id),
    screen_group_id: cleanId(group.screen_group_id),
    screen_group_name: cleanString(group.name),
    display_count: asInteger(group.display_count) || 0,
    created_at: cleanString(group.created_at),
    updated_at: cleanString(group.updated_at)
  }));
}

function listCustomerOffers(session) {
  return db.prepare(`
    SELECT * FROM offers
    WHERE tenant_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 200
  `).all(session.tenant_id)
    .filter((offer) => !session.store_ids?.length || session.store_ids.includes(cleanId(offer.store_id)))
    .map((row) => publicOffer(row, { includeCurrentRevision: true }));
}

function createCustomerOfferRevision(session, offerId, input) {
  const offer = getOffer(offerId, { includeCurrentRevision: true });
  if (!offer) throw requestError("Offer not found", 404);
  if (offer.tenant_id !== session.tenant_id) throw requestError("Offer is outside tenant scope", 403);
  assertCustomerStoreScope(session, offer.store_id);
  const current = offer.current_revision || getOfferRevision(offer.current_offer_revision_id);
  if (!current) throw requestError("Offer has no current revision to copy", 409);
  const allowedStatus = cleanString(input.status || current.status || "draft");
  const nextInput = {
    title: cleanString(input.title ?? current.title),
    description: cleanString(input.description ?? current.description),
    pickup_location: cleanString(input.pickup_location ?? input.pickupLocation ?? current.pickup_location),
    pickup_available_from: cleanString(input.pickup_available_from ?? input.pickupAvailableFrom ?? current.pickup_available_from),
    pickup_available_until: cleanString(input.pickup_available_until ?? input.pickupAvailableUntil ?? current.pickup_available_until),
    order_issue_cutoff_time: cleanString(input.order_issue_cutoff_time ?? input.orderIssueCutoffTime ?? current.order_issue_cutoff_time),
    valid_from: cleanString(input.valid_from ?? input.validFrom ?? current.valid_from),
    valid_until: cleanString(input.valid_until ?? input.validUntil ?? current.valid_until),
    max_orders_total: input.max_orders_total ?? input.maxOrdersTotal ?? current.max_orders_total,
    max_orders_per_day: input.max_orders_per_day ?? input.maxOrdersPerDay ?? current.max_orders_per_day,
    max_orders_per_visit: input.max_orders_per_visit ?? input.maxOrdersPerVisit ?? current.max_orders_per_visit,
    currency: normalizeCurrency(input.currency ?? current.currency),
    tax_included: normalizeBooleanFlag(input.tax_included ?? current.tax_included ?? true),
    tax_amount: input.tax_amount ?? current.tax_amount,
    notes: cleanString(input.notes ?? current.notes),
    status: allowedStatus,
    created_by: session.customer_session_id,
    items: Array.isArray(input.items) ? input.items : (current.items || []).map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price_snapshot,
      currency: item.currency,
      tax_included: item.tax_included
    }))
  };
  const revision = createOfferRevision(offer.offer_id, nextInput);
  recordAuditLog("customer", session.customer_session_id, "offer_revision.customer_create", "offer", offer.offer_id, current, revision, {
    tenant_id: session.tenant_id,
    store_id: offer.store_id,
    role: session.role
  }, nowIso());
  return revision;
}

function listCustomerContextItems(query = {}, options = {}) {
  const scope = normalizeCampaignScope(query, { requireStore: false, allowEmptyTenant: true });
  const itemType = cleanId(query.item_type || query.itemType);
  const contextCategory = cleanString(query.context_category || query.contextCategory);
  const visibilityScope = cleanString(query.visibility_scope || query.visibilityScope);
  const sourceOwner = cleanString(query.source_owner || query.sourceOwner);
  const status = cleanString(query.status || "active");
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  if (status && !CUSTOMER_CONTEXT_RECORD_STATUS.has(status)) throw requestError("status is invalid", 400);
  const items = db.prepare(`
    SELECT * FROM customer_context_items
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR screen_group_id = ?)
      AND (? = '' OR context_category = ?)
      AND (? = '' OR visibility_scope = ?)
      AND (? = '' OR source_owner = ?)
      AND (? = '' OR item_type = ?)
      AND (? = '' OR status = ?)
    ORDER BY tenant_id ASC, store_id ASC, screen_group_id ASC, context_category ASC, item_type ASC, item_key ASC
    LIMIT ?
  `).all(
    scope.tenant_id, scope.tenant_id,
    scope.store_id, scope.store_id,
    scope.screen_group_id, scope.screen_group_id,
    contextCategory, contextCategory,
    visibilityScope, visibilityScope,
    sourceOwner, sourceOwner,
    itemType, itemType,
    status, status,
    limit
  ).map(publicCustomerContextItem);
  return options.includeAssets === false ? items : attachContextSourceAssets(items);
}

function upsertCustomerContextItem(input, actor = {}) {
  const scope = normalizeCampaignScope(input, { requireStore: true, requireScreenGroup: true });
  const itemType = cleanId(input.item_type || input.itemType || "context_note");
  const itemKey = cleanId(input.item_key || input.itemKey || input.key);
  if (!itemType) throw requestError("item_type is required", 400);
  if (!itemKey) throw requestError("item_key is required", 400);
  const classification = normalizeCustomerContextClassification({
    ...input,
    item_type: itemType,
    item_key: itemKey
  });
  const value = normalizeStructuredJson(input.value_json ?? input.valueJson ?? input.value ?? {}, {});
  const valueJson = safeJsonStringify(value, 30000);
  const source = cleanString(input.source || "operator").slice(0, 80) || "operator";
  const status = cleanString(input.status || "active");
  if (!CUSTOMER_CONTEXT_RECORD_STATUS.has(status)) throw requestError("status must be active, archived, or deleted", 400);
  const now = nowIso();
  const contextItemId = cleanId(input.customer_context_item_id || input.customerContextItemId) ||
    nextEntityId("cci", `${scope.tenant_id}-${scope.store_id || "tenant"}-${itemType}-${itemKey}`);
  const existing = db.prepare(`
    SELECT * FROM customer_context_items
    WHERE tenant_id = ?
      AND store_id = ?
      AND screen_group_id = ?
      AND item_type = ?
      AND item_key = ?
  `).get(scope.tenant_id, scope.store_id, scope.screen_group_id, itemType, itemKey);

  const storedContextItemId = existing?.customer_context_item_id || contextItemId;
  let sourceAssetScopeSyncedCount = 0;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO customer_context_items (
        customer_context_item_id, tenant_id, store_id, screen_group_id,
        context_category, visibility_scope, source_owner, source_type, confidence,
        item_type, item_key, value_json, source, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, store_id, screen_group_id, item_type, item_key)
      DO UPDATE SET
        context_category = excluded.context_category,
        visibility_scope = excluded.visibility_scope,
        source_owner = excluded.source_owner,
        source_type = excluded.source_type,
        confidence = excluded.confidence,
        value_json = excluded.value_json,
        source = excluded.source,
        status = excluded.status,
        deleted_at = CASE WHEN excluded.status = 'deleted' THEN excluded.updated_at ELSE NULL END,
        updated_at = excluded.updated_at
    `).run(
      storedContextItemId,
      scope.tenant_id,
      scope.store_id,
      scope.screen_group_id,
      classification.context_category,
      classification.visibility_scope,
      classification.source_owner,
      classification.source_type,
      classification.confidence,
      itemType,
      itemKey,
      valueJson,
      source,
      status,
      now,
      now
    );
    sourceAssetScopeSyncedCount = syncCustomerContextSourceAssetScope(
      storedContextItemId,
      classification.source_owner,
      classification.visibility_scope,
      now
    );
  })();
  const item = db.prepare(`
    SELECT * FROM customer_context_items
    WHERE tenant_id = ?
      AND store_id = ?
      AND screen_group_id = ?
      AND item_type = ?
      AND item_key = ?
  `).get(scope.tenant_id, scope.store_id, scope.screen_group_id, itemType, itemKey);
  recordAuditLog(actor.actor_type || actor.actorType || "admin", actor.actor_id || actor.actorId || "admin", existing ? "customer_context_item.update" : "customer_context_item.create", "customer_context_item", item.customer_context_item_id, existing ? publicCustomerContextItem(existing) : null, publicCustomerContextItem(item), {
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    screen_group_id: scope.screen_group_id,
    ...classification,
    item_type: itemType,
    item_key: itemKey,
    source_asset_scope_synced_count: sourceAssetScopeSyncedCount
  }, now);
  return attachContextSourceAssets([publicCustomerContextItem(item)])[0];
}

function listCustomerVisibleContextItems(session, query = {}) {
  const scope = normalizeCustomerContextScope(session, query, { requireScreenGroup: true });
  return listCustomerContextItems({
    tenant_id: session.tenant_id,
    store_id: scope.store_id,
    screen_group_id: scope.screen_group_id,
    context_category: query.context_category || query.contextCategory || "",
    item_type: query.item_type || query.itemType || "",
    visibility_scope: "customer_visible",
    status: query.status || "active",
    limit: query.limit || 100
  }).filter((item) => item.source_owner === "customer" || item.visibility_scope === "customer_visible");
}

function createCustomerOwnedContextItem(session, input = {}) {
  const scope = normalizeCustomerContextScope(session, input, { requireScreenGroup: true });
  const payload = customerWritableContextPayload(input, scope);
  return upsertCustomerContextItem(payload, { actor_type: "customer", actor_id: session.customer_session_id });
}

function updateCustomerOwnedContextItem(session, contextItemId, input = {}) {
  const existing = getCustomerOwnedContextItemForWrite(session, contextItemId);
  return updateCustomerContextItem(existing.customer_context_item_id, customerWritableContextPayload({
    ...existing,
    ...input,
    item_type: existing.item_type,
    item_key: existing.item_key
  }, existing), {
    actorType: "customer",
    actorId: session.customer_session_id
  });
}

function softDeleteCustomerOwnedContextItem(session, contextItemId) {
  const existing = getCustomerOwnedContextItemForWrite(session, contextItemId);
  return softDeleteCustomerContextItem(existing.customer_context_item_id, {
    actorType: "customer",
    actorId: session.customer_session_id
  });
}

function getCustomerOwnedContextItemForWrite(session, contextItemId) {
  const item = getCustomerContextItem(contextItemId);
  if (!item) throw requestError("Customer context item not found", 404);
  assertCustomerContextItemScope(session, item);
  if (item.visibility_scope !== "customer_visible" || item.source_owner !== "customer") {
    throw requestError("Customer can only edit customer-owned visible context", 403);
  }
  if (item.status === "deleted") throw requestError("Customer context item is deleted", 409);
  return item;
}

function customerWritableContextPayload(input, scope) {
  const status = cleanString(input.status || "active");
  const payload = {
    ...input,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    screen_group_id: scope.screen_group_id,
    visibility_scope: "customer_visible",
    source_owner: "customer",
    source_type: cleanString(input.source_type || input.sourceType || "customer_input") === "asset_upload" ? "asset_upload" : "customer_input",
    confidence: cleanString(input.confidence || "customer_confirmed") || "customer_confirmed",
    source: "customer",
    status
  };
  const normalized = assertContextContract(payload, { customerInput: true });
  assertCustomerWritableContext(normalized);
  return {
    ...payload,
    ...normalized
  };
}

function updateCustomerContextItem(contextItemId, input = {}, actor = {}) {
  const existing = getCustomerContextItem(contextItemId);
  if (!existing) throw requestError("Customer context item not found", 404);
  const classification = normalizeCustomerContextClassification({
    context_category: input.context_category ?? input.contextCategory ?? existing.context_category,
    visibility_scope: input.visibility_scope ?? input.visibilityScope ?? existing.visibility_scope,
    source_owner: input.source_owner ?? input.sourceOwner ?? existing.source_owner,
    source_type: input.source_type ?? input.sourceType ?? existing.source_type,
    confidence: input.confidence ?? existing.confidence,
    item_type: existing.item_type,
    item_key: existing.item_key,
    status: input.status ?? existing.status
  });
  const status = cleanString(input.status || existing.status || "active");
  if (!CUSTOMER_CONTEXT_RECORD_STATUS.has(status)) throw requestError("status must be active, archived, or deleted", 400);
  const value = normalizeStructuredJson(input.value_json ?? input.valueJson ?? input.value ?? existing.value ?? {}, {});
  const now = nowIso();
  let sourceAssetScopeSyncedCount = 0;
  db.transaction(() => {
    db.prepare(`
      UPDATE customer_context_items SET
        context_category = ?,
        visibility_scope = ?,
        source_owner = ?,
        source_type = ?,
        confidence = ?,
        value_json = ?,
        source = ?,
        status = ?,
        deleted_at = CASE WHEN ? = 'deleted' THEN COALESCE(deleted_at, ?) ELSE NULL END,
        updated_at = ?
      WHERE customer_context_item_id = ?
    `).run(
      classification.context_category,
      classification.visibility_scope,
      classification.source_owner,
      classification.source_type,
      classification.confidence,
      safeJsonStringify(value, 30000),
      cleanString(input.source || existing.source || "operator").slice(0, 80) || "operator",
      status,
      status,
      now,
      now,
      existing.customer_context_item_id
    );
    sourceAssetScopeSyncedCount = syncCustomerContextSourceAssetScope(
      existing.customer_context_item_id,
      classification.source_owner,
      classification.visibility_scope,
      now
    );
  })();
  const updated = getCustomerContextItem(existing.customer_context_item_id);
  recordAuditLog(actor.actorType || "admin", actor.actorId || "admin", "customer_context_item.update", "customer_context_item", existing.customer_context_item_id, existing, updated, {
    tenant_id: updated.tenant_id,
    store_id: updated.store_id,
    screen_group_id: updated.screen_group_id,
    status,
    source_asset_scope_synced_count: sourceAssetScopeSyncedCount
  }, now);
  return attachContextSourceAssets([updated])[0];
}

function syncCustomerContextSourceAssetScope(contextItemId, sourceOwner, visibilityScope, now) {
  const result = db.prepare(`
    UPDATE customer_context_source_assets SET
      source_owner = ?,
      visibility_scope = ?,
      updated_at = ?
    WHERE customer_context_item_id = ?
      AND status != 'deleted'
      AND (source_owner != ? OR visibility_scope != ?)
  `).run(
    cleanString(sourceOwner),
    cleanString(visibilityScope),
    now,
    cleanId(contextItemId),
    cleanString(sourceOwner),
    cleanString(visibilityScope)
  );
  return result.changes || 0;
}

function softDeleteCustomerContextItem(contextItemId, actor = {}) {
  const existing = getCustomerContextItem(contextItemId);
  if (!existing) throw requestError("Customer context item not found", 404);
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE customer_context_items SET
        status = 'deleted',
        deleted_at = COALESCE(deleted_at, ?),
        updated_at = ?
      WHERE customer_context_item_id = ?
    `).run(now, now, existing.customer_context_item_id);
    db.prepare(`
      UPDATE customer_context_source_assets SET
        status = 'deleted',
        deleted_at = COALESCE(deleted_at, ?),
        updated_at = ?
      WHERE customer_context_item_id = ?
        AND status != 'deleted'
    `).run(now, now, existing.customer_context_item_id);
  })();
  const updated = getCustomerContextItem(existing.customer_context_item_id);
  recordAuditLog(actor.actorType || "admin", actor.actorId || "admin", "customer_context_item.delete", "customer_context_item", existing.customer_context_item_id, existing, updated, {
    tenant_id: updated.tenant_id,
    store_id: updated.store_id,
    screen_group_id: updated.screen_group_id,
    soft_delete: true
  }, now);
  return attachContextSourceAssets([updated], { assetStatus: "" })[0];
}

function normalizeCustomerContextScope(session, input = {}, options = {}) {
  const screenGroupId = cleanId(input.screen_group_id || input.screenGroupId);
  if (!screenGroupId && options.requireScreenGroup) throw requestError("screen_group_id is required", 400);
  const suppliedStoreId = cleanId(input.store_id || input.storeId);
  let storeId = defaultCustomerStoreId(session, suppliedStoreId);
  if (screenGroupId) {
    const screenGroup = db.prepare("SELECT tenant_id, store_id FROM screen_groups WHERE screen_group_id = ?").get(screenGroupId);
    if (!screenGroup) throw requestError("Screen group not found", 404);
    if (cleanId(screenGroup.tenant_id) !== session.tenant_id) throw requestError("Screen group is outside tenant scope", 403);
    storeId = defaultCustomerStoreId(session, suppliedStoreId || screenGroup.store_id);
    if (cleanId(screenGroup.store_id) !== storeId) throw requestError("Screen group is outside store scope", 403);
    assertScreenGroupScope(session.tenant_id, storeId, screenGroupId);
  }
  return {
    tenant_id: session.tenant_id,
    store_id: storeId,
    screen_group_id: screenGroupId
  };
}

function assertCustomerContextItemScope(session, item) {
  if (item.tenant_id !== session.tenant_id) throw requestError("Customer context item is outside tenant scope", 403);
  assertCustomerStoreScope(session, item.store_id);
  if (item.screen_group_id) assertScreenGroupScope(session.tenant_id, item.store_id, item.screen_group_id);
}

function getCustomerContextItem(contextItemId) {
  const row = db.prepare("SELECT * FROM customer_context_items WHERE customer_context_item_id = ?").get(cleanId(contextItemId));
  return row ? publicCustomerContextItem(row) : null;
}

function attachContextSourceAssets(items, options = {}) {
  if (!items.length) return items;
  const assetsByItem = listCustomerContextSourceAssetsForItems(
    items.map((item) => item.customer_context_item_id),
    { status: options.assetStatus ?? "active" }
  );
  return items.map((item) => ({
    ...item,
    source_assets: (assetsByItem.get(item.customer_context_item_id) || [])
      .filter((asset) => sourceAssetMatchesContextItemScope(item, asset))
  }));
}

function sourceAssetMatchesContextItemScope(item, asset) {
  if (!item || !asset) return false;
  return cleanId(asset.customer_context_item_id || asset.context_item_id) === cleanId(item.customer_context_item_id) &&
    cleanId(asset.tenant_id) === cleanId(item.tenant_id) &&
    cleanId(asset.store_id) === cleanId(item.store_id) &&
    cleanId(asset.screen_group_id) === cleanId(item.screen_group_id) &&
    cleanString(asset.source_owner) === cleanString(item.source_owner) &&
    cleanString(asset.visibility_scope) === cleanString(item.visibility_scope);
}

function listCustomerContextSourceAssetsForItems(contextItemIds, options = {}) {
  const ids = [...new Set((contextItemIds || []).map(cleanId).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const status = cleanString(options.status ?? "active");
  const rows = db.prepare(`
    SELECT * FROM customer_context_source_assets
    WHERE customer_context_item_id IN (${placeholders})
      AND (? = '' OR status = ?)
    ORDER BY created_at DESC, id DESC
  `).all(...ids, status, status);
  for (const row of rows) {
    const asset = publicCustomerContextSourceAsset(row, options);
    if (!result.has(asset.customer_context_item_id)) result.set(asset.customer_context_item_id, []);
    result.get(asset.customer_context_item_id).push(asset);
  }
  return result;
}

function createCustomerContextSourceAsset(contextItemId, file, body = {}, actor = {}) {
  if (!file) throw requestError("source file is required", 400);
  const item = getCustomerContextItem(contextItemId);
  if (!item) throw requestError("Customer context item not found", 404);
  if (item.status === "deleted") throw requestError("Customer context item is deleted", 409);
  assertNoAutomaticExternalAi(body);
  const contract = assertContextSourceAssetContract({
    ...body,
    context_item_id: item.customer_context_item_id,
    tenant_id: item.tenant_id,
    store_id: item.store_id,
    screen_group_id: item.screen_group_id,
    source_owner: item.source_owner,
    visibility_scope: item.visibility_scope,
    filename: file.originalname || file.filename,
    mime_type: file.mimetype,
    size_bytes: file.size,
    extraction_status: cleanString(body.extraction_status || body.extractionStatus || "manual_no_ai") || "manual_no_ai"
  });
  if (contract.visibility_scope !== item.visibility_scope || contract.source_owner !== item.source_owner) {
    throw requestError("source asset scope must match context item", 400);
  }
  if (!CUSTOMER_CONTEXT_DOCUMENT_PROCESSING_STATUS.has(contract.extraction_status)) throw requestError("extraction_status is invalid", 400);
  if (contract.extraction_status !== "manual_no_ai") {
    throw requestError("automatic document processing is out of scope for this endpoint", 400);
  }
  const costOwner = cleanString(body.cost_owner || body.costOwner || "manual_no_ai") || "manual_no_ai";
  if (!CUSTOMER_CONTEXT_COST_OWNERS.has(costOwner)) throw requestError("cost_owner is invalid", 400);
  const bytes = fs.readFileSync(file.path);
  validateCustomerContextSourceHeader(contract.extension, bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const now = nowIso();
  const assetId = cleanId(body.customer_context_source_asset_id || body.customerContextSourceAssetId) ||
    nextEntityId("ccsa", `${item.store_id}-${item.item_type}-${item.item_key}`);
  if (db.prepare("SELECT customer_context_source_asset_id FROM customer_context_source_assets WHERE customer_context_source_asset_id = ?").get(assetId)) {
    throw requestError("Customer context source asset already exists", 409);
  }
  const filename = `${assetId}${contract.extension}`;
  const storagePath = normalizedCustomerContextSourcePath(path.join(CUSTOMER_CONTEXT_SOURCE_DIR, filename));
  if (fs.existsSync(storagePath)) throw requestError("Customer context source file already exists", 409);
  fs.renameSync(file.path, storagePath);
  try {
    fs.chmodSync(storagePath, 0o600);
    db.prepare(`
      INSERT INTO customer_context_source_assets (
        customer_context_source_asset_id, customer_context_item_id, tenant_id, store_id, screen_group_id,
        source_owner, visibility_scope, original_name, filename, extension, mime_type,
        size_bytes, sha256, storage_path, usage_notes, extraction_status, external_ai_used,
        cost_owner, status, created_by_actor_type, created_by_actor_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?, ?)
    `).run(
      assetId,
      item.customer_context_item_id,
      item.tenant_id,
      item.store_id,
      item.screen_group_id,
      contract.source_owner,
      contract.visibility_scope,
      cleanString(file.originalname).slice(0, 240) || filename,
      filename,
      contract.extension,
      contract.mime_type,
      contract.size_bytes,
      sha256,
      storagePath,
      contract.usage_notes,
      contract.extraction_status,
      costOwner,
      cleanString(actor.actorType || "admin"),
      cleanString(actor.actorId || "admin").slice(0, 160),
      now,
      now
    );
  } catch (error) {
    fs.rmSync(storagePath, { force: true });
    throw error;
  }
  const asset = getCustomerContextSourceAsset(assetId);
  recordAuditLog(actor.actorType || "admin", actor.actorId || "admin", "customer_context_source_asset.create", "customer_context_source_asset", assetId, null, asset, {
    tenant_id: item.tenant_id,
    store_id: item.store_id,
    screen_group_id: item.screen_group_id,
    customer_context_item_id: item.customer_context_item_id,
    no_external_ai: true
  }, now);
  return asset;
}

function softDeleteCustomerOwnedContextSourceAsset(session, sourceAssetId) {
  const asset = getCustomerContextSourceAsset(sourceAssetId);
  if (!asset) throw requestError("Customer context source asset not found", 404);
  const item = getCustomerOwnedContextItemForWrite(session, asset.customer_context_item_id);
  if (asset.visibility_scope !== "customer_visible" || asset.source_owner !== "customer") {
    throw requestError("Customer can only delete customer-owned visible source assets", 403);
  }
  assertCustomerContextItemScope(session, item);
  return softDeleteCustomerContextSourceAsset(asset.customer_context_source_asset_id, {
    actorType: "customer",
    actorId: session.customer_session_id
  });
}

function softDeleteCustomerContextSourceAsset(sourceAssetId, actor = {}) {
  const existing = getCustomerContextSourceAsset(sourceAssetId);
  if (!existing) throw requestError("Customer context source asset not found", 404);
  const now = nowIso();
  db.prepare(`
    UPDATE customer_context_source_assets SET
      status = 'deleted',
      deleted_at = COALESCE(deleted_at, ?),
      updated_at = ?
    WHERE customer_context_source_asset_id = ?
  `).run(now, now, existing.customer_context_source_asset_id);
  const updated = getCustomerContextSourceAsset(existing.customer_context_source_asset_id, { includeDeleted: true });
  recordAuditLog(actor.actorType || "admin", actor.actorId || "admin", "customer_context_source_asset.delete", "customer_context_source_asset", existing.customer_context_source_asset_id, existing, updated, {
    tenant_id: updated.tenant_id,
    store_id: updated.store_id,
    screen_group_id: updated.screen_group_id,
    customer_context_item_id: updated.customer_context_item_id,
    soft_delete: true
  }, now);
  return updated;
}

function getCustomerContextSourceAsset(sourceAssetId, options = {}) {
  const row = db.prepare(`
    SELECT * FROM customer_context_source_assets
    WHERE customer_context_source_asset_id = ?
      AND (? = 1 OR status != 'deleted')
  `).get(cleanId(sourceAssetId), options.includeDeleted ? 1 : 0);
  return row ? publicCustomerContextSourceAsset(row, options) : null;
}

function sendCustomerContextSourceAsset(req, res, sourceAssetId, options = {}) {
  const row = db.prepare("SELECT * FROM customer_context_source_assets WHERE customer_context_source_asset_id = ?").get(cleanId(sourceAssetId));
  if (!row || cleanString(row.status) !== "active") throw requestError("Customer context source asset not found", 404);
  const asset = publicCustomerContextSourceAsset(row, { includeStoragePath: true });
  if (options.actorType === "customer") {
    const item = getCustomerContextItem(asset.customer_context_item_id);
    if (!item || item.status !== "active") throw requestError("Customer context item is not active", 404);
    if (!sourceAssetMatchesContextItemScope(item, asset)) throw requestError("Customer context source asset scope does not match context item", 403);
    if (item.visibility_scope !== "customer_visible" || asset.visibility_scope !== "customer_visible") {
      throw requestError("Customer context source asset is not visible", 403);
    }
    assertCustomerContextItemScope(options.session, item);
  }
  res.setHeader("Content-Type", asset.mime_type);
  res.setHeader("Content-Length", String(asset.size_bytes));
  res.setHeader("Content-Disposition", `inline; filename="${asset.original_name.replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(asset.storage_path);
}

function publicCustomerContextSourceAsset(row, options = {}) {
  const asset = {
    customer_context_source_asset_id: cleanId(row.customer_context_source_asset_id),
    asset_id: cleanId(row.customer_context_source_asset_id),
    customer_context_item_id: cleanId(row.customer_context_item_id),
    context_item_id: cleanId(row.customer_context_item_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    source_owner: cleanString(row.source_owner),
    visibility_scope: cleanString(row.visibility_scope),
    original_name: cleanString(row.original_name),
    filename: cleanString(row.filename),
    extension: cleanString(row.extension),
    mime_type: cleanString(row.mime_type),
    size_bytes: asInteger(row.size_bytes) || 0,
    sha256: cleanString(row.sha256),
    usage_notes: cleanString(row.usage_notes),
    extraction_status: cleanString(row.extraction_status),
    external_ai_used: row.external_ai_used === 1,
    cost_owner: cleanString(row.cost_owner),
    status: cleanString(row.status),
    view_path: `/api/customer/context-source-assets/${encodeURIComponent(cleanId(row.customer_context_source_asset_id))}/view`,
    admin_view_path: `/api/admin/customer-context-source-assets/${encodeURIComponent(cleanId(row.customer_context_source_asset_id))}/view`,
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    deleted_at: cleanString(row.deleted_at)
  };
  if (options.includeStoragePath) {
    asset.storage_path = normalizedCustomerContextSourcePath(row.storage_path);
  }
  return asset;
}

function validateCustomerContextSourceHeader(extension, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) throw requestError("source file is empty or invalid", 400);
  if (extension === ".pdf") {
    if (bytes.length < 5 || bytes.toString("ascii", 0, 5) !== "%PDF-") throw requestError("pdf source file has an invalid file signature", 400);
    return;
  }
  if (extension === ".png") {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) throw requestError("png source file has an invalid file signature", 400);
    return;
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw requestError("jpeg source file has an invalid file signature", 400);
    return;
  }
  if (extension === ".webp") {
    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
      throw requestError("webp source file has an invalid file signature", 400);
    }
  }
}

function normalizedCustomerContextSourcePath(value) {
  const resolved = path.resolve(value);
  const root = path.resolve(CUSTOMER_CONTEXT_SOURCE_DIR);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw requestError("customer context source storage path is invalid", 400);
  }
  return resolved;
}

function normalizeCustomerContextSourceUploadError(error) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return requestError("source file exceeds the maximum upload size", 413);
  }
  return requestError(error.message || "source file upload failed", error.status || 400);
}

function createProposalGenerationRun(input, actor = {}) {
  if (normalizeBooleanFlag(input.external_ai_used || input.externalAiUsed) || cleanString(input.external_ai_provider || input.externalAiProvider)) {
    throw requestError("External AI generation is out of scope for this foundation endpoint", 400);
  }
  const scope = normalizeCampaignScope(input, { requireStore: true, requireScreenGroup: true });
  const proposalMonth = cleanMonthKey(input.proposal_month || input.proposalMonth || input.month) || new Date().toISOString().slice(0, 7);
  const run = db.transaction(() => {
    const snapshot = createCustomerContextSnapshotRecord(scope, proposalMonth, cleanString(input.source || "operator_seed") || "operator_seed");
    return createProposalGenerationRunRecord({
      ...scope,
      proposal_month: proposalMonth,
      context_snapshot_id: snapshot.customer_context_snapshot_id,
      generator_type: cleanString(input.generator_type || input.generatorType || "operator_seed") || "operator_seed",
      status: cleanString(input.status || "completed") || "completed",
      proposal_count: asInteger(input.proposal_count || input.proposalCount) || 0,
      requested_by_user_id: cleanString(input.requested_by_user_id || input.requestedByUserId || actor.actor_id || "admin"),
      metadata: normalizeStructuredJson(input.metadata_json ?? input.metadataJson ?? input.metadata ?? {}, {})
    });
  })();
  return run;
}

function listProposalGenerationRuns(query = {}) {
  const scope = normalizeCampaignScope(query, { requireStore: false, allowEmptyTenant: true });
  const proposalMonth = cleanMonthKey(query.proposal_month || query.proposalMonth || query.month);
  const status = cleanString(query.status);
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 50, 200));
  return db.prepare(`
    SELECT pgr.*, ccs.snapshot_sha256, ccs.item_count
    FROM proposal_generation_runs pgr
    LEFT JOIN customer_context_snapshots ccs ON ccs.customer_context_snapshot_id = pgr.context_snapshot_id
    WHERE (? = '' OR pgr.tenant_id = ?)
      AND (? = '' OR pgr.store_id = ?)
      AND (? = '' OR pgr.screen_group_id = ?)
      AND (? = '' OR pgr.proposal_month = ?)
      AND (? = '' OR pgr.status = ?)
    ORDER BY pgr.created_at DESC, pgr.id DESC
    LIMIT ?
  `).all(
    scope.tenant_id, scope.tenant_id,
    scope.store_id, scope.store_id,
    scope.screen_group_id, scope.screen_group_id,
    proposalMonth, proposalMonth,
    status, status,
    limit
  ).map(publicProposalGenerationRun);
}

function createCampaignProposal(input, actor = {}) {
  const proposal = db.transaction(() => {
    const scope = normalizeCampaignScope(input, { requireStore: true, requireScreenGroup: true });
    const proposalMonth = cleanMonthKey(input.proposal_month || input.proposalMonth || input.month) || new Date().toISOString().slice(0, 7);
    const title = cleanString(input.title).slice(0, 160);
    if (!title) throw requestError("title is required", 400);
    const status = cleanString(input.status || "proposed");
    if (!CAMPAIGN_PROPOSAL_STATUS.has(status)) {
      throw requestError(`status must be one of: ${Array.from(CAMPAIGN_PROPOSAL_STATUS).join(", ")}`, 400);
    }

    const snapshot = input.context_snapshot_id || input.contextSnapshotId
      ? getCustomerContextSnapshot(cleanId(input.context_snapshot_id || input.contextSnapshotId), scope)
      : createCustomerContextSnapshotRecord(scope, proposalMonth, "operator_seed");
    const runId = cleanId(input.proposal_generation_run_id || input.proposalGenerationRunId);
    let run = runId ? getProposalGenerationRun(runId, scope) : null;
    if (!run) {
      run = createProposalGenerationRunRecord({
        ...scope,
        proposal_month: proposalMonth,
        context_snapshot_id: snapshot.customer_context_snapshot_id,
        generator_type: "operator_seed",
        status: "completed",
        proposal_count: 1,
        requested_by_user_id: cleanString(input.created_by_user_id || input.createdByUserId || actor.actor_id || "admin"),
        metadata: {
          source: "admin_operator_create",
          no_external_ai: true
        }
      });
    }

    const now = nowIso();
    const proposalId = cleanId(input.campaign_proposal_id || input.campaignProposalId) ||
      nextEntityId("cpr", `${scope.store_id}-${proposalMonth}`);
    db.prepare(`
      INSERT INTO campaign_proposals (
        campaign_proposal_id, tenant_id, store_id, screen_group_id,
        proposal_month, context_snapshot_id, proposal_generation_run_id,
        title, objective, target_audience, three_screen_outline_json,
        qr_flow, recommended_time_slots_json, expected_effect, required_assets_json,
        status, rejected_reason, selected_at, held_at, rejected_at,
        created_by_user_id, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposalId,
      scope.tenant_id,
      scope.store_id,
      scope.screen_group_id,
      proposalMonth,
      snapshot.customer_context_snapshot_id,
      run.proposal_generation_run_id,
      title,
      cleanString(input.objective).slice(0, 1000),
      cleanString(input.target_audience || input.targetAudience).slice(0, 1000),
      safeJsonStringify(normalizeStructuredJson(input.three_screen_outline_json ?? input.threeScreenOutlineJson ?? input.three_screen_outline ?? input.threeScreenOutline ?? [], []), 20000),
      cleanString(input.qr_flow || input.qrFlow).slice(0, 1000),
      safeJsonStringify(normalizeStructuredJson(input.recommended_time_slots_json ?? input.recommendedTimeSlotsJson ?? input.recommended_time_slots ?? input.recommendedTimeSlots ?? [], []), 10000),
      cleanString(input.expected_effect || input.expectedEffect).slice(0, 1000),
      safeJsonStringify(normalizeStructuredJson(input.required_assets_json ?? input.requiredAssetsJson ?? input.required_assets ?? input.requiredAssets ?? [], []), 10000),
      status,
      status === "selected" ? now : null,
      status === "held" ? now : null,
      status === "rejected" ? now : null,
      cleanString(input.created_by_user_id || input.createdByUserId || actor.actor_id || "admin").slice(0, 120),
      cleanString(input.source || "operator").slice(0, 80) || "operator",
      now,
      now
    );
    recordCampaignProposalEvent(proposalId, "", status, "", "admin", actor.actor_id || "admin", {
      source: "admin_operator_create",
      context_snapshot_id: snapshot.customer_context_snapshot_id,
      proposal_generation_run_id: run.proposal_generation_run_id,
      no_external_ai: true
    }, now);
    db.prepare(`
      UPDATE proposal_generation_runs
      SET proposal_count = (
        SELECT COUNT(*) FROM campaign_proposals
        WHERE proposal_generation_run_id = ?
      ),
      updated_at = ?,
      completed_at = COALESCE(completed_at, ?)
      WHERE proposal_generation_run_id = ?
    `).run(run.proposal_generation_run_id, now, now, run.proposal_generation_run_id);
    if (status === "selected") {
      createCampaignBriefStub(proposalId, "admin", actor.actor_id || "admin", now);
    }
    return getCampaignProposal(proposalId, { includeEvents: true });
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "campaign_proposal.create", "campaign_proposal", proposal.campaign_proposal_id, null, proposal, {
    tenant_id: proposal.tenant_id,
    store_id: proposal.store_id,
    screen_group_id: proposal.screen_group_id,
    no_external_ai: true
  }, proposal.created_at || nowIso());
  return proposal;
}

function listCampaignProposals(query = {}, options = {}) {
  const scope = normalizeCampaignScope(query, { requireStore: false, allowEmptyTenant: true });
  const proposalMonth = cleanMonthKey(query.proposal_month || query.proposalMonth || query.month);
  const status = cleanString(query.status);
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT cp.*, ccs.snapshot_sha256, ccs.item_count, cb.campaign_brief_id, cb.status AS campaign_brief_status
    FROM campaign_proposals cp
    LEFT JOIN customer_context_snapshots ccs ON ccs.customer_context_snapshot_id = cp.context_snapshot_id
    LEFT JOIN campaign_briefs cb ON cb.campaign_proposal_id = cp.campaign_proposal_id
    WHERE (? = '' OR cp.tenant_id = ?)
      AND (? = '' OR cp.store_id = ?)
      AND (? = '' OR cp.screen_group_id = ?)
      AND (? = '' OR cp.proposal_month = ?)
      AND (? = '' OR cp.status = ?)
    ORDER BY cp.proposal_month DESC, cp.updated_at DESC, cp.id DESC
    LIMIT ?
  `).all(
    scope.tenant_id, scope.tenant_id,
    scope.store_id, scope.store_id,
    scope.screen_group_id, scope.screen_group_id,
    proposalMonth, proposalMonth,
    status, status,
    limit
  ).map((row) => publicCampaignProposal(row, options));
}

function listCustomerCampaignProposals(session, query = {}) {
  const screenGroupId = cleanId(query.screen_group_id || query.screenGroupId);
  if (!screenGroupId) throw requestError("screen_group_id is required", 400);
  const screenGroup = db.prepare("SELECT tenant_id, store_id FROM screen_groups WHERE screen_group_id = ?").get(screenGroupId);
  if (!screenGroup) throw requestError("Screen group not found", 404);
  if (cleanId(screenGroup.tenant_id) !== session.tenant_id) throw requestError("Screen group is outside tenant scope", 403);
  const suppliedStoreId = cleanId(query.store_id || query.storeId);
  const storeId = defaultCustomerStoreId(session, suppliedStoreId || screenGroup.store_id);
  if (cleanId(screenGroup.store_id) !== storeId) throw requestError("Screen group is outside store scope", 403);
  assertScreenGroupScope(session.tenant_id, storeId, screenGroupId);
  const proposalMonth = cleanMonthKey(query.proposal_month || query.proposalMonth || query.month) || new Date().toISOString().slice(0, 7);
  const proposals = listCampaignProposals({
    tenant_id: session.tenant_id,
    store_id: storeId,
    screen_group_id: screenGroupId,
    proposal_month: proposalMonth,
    limit: query.limit || 100
  });
  return proposals.filter((proposal) => CUSTOMER_VISIBLE_CAMPAIGN_PROPOSAL_STATUS.has(proposal.status));
}

function updateCustomerCampaignProposalStatus(session, campaignProposalId, input) {
  const status = cleanString(input.status);
  if (!CUSTOMER_CAMPAIGN_PROPOSAL_STATUS.has(status)) {
    throw requestError("status must be selected, held, or rejected", 400);
  }
  const reason = cleanString(input.rejected_reason || input.rejectedReason || input.reason).slice(0, 1000);
  const updated = db.transaction(() => {
    const existing = getCampaignProposal(campaignProposalId);
    if (!existing) throw requestError("Campaign proposal not found", 404);
    assertCustomerProposalScope(session, existing);
    if (!CUSTOMER_VISIBLE_CAMPAIGN_PROPOSAL_STATUS.has(existing.status)) {
      throw requestError("Campaign proposal is not visible to customer", 403);
    }
    const now = nowIso();
    db.prepare(`
      UPDATE campaign_proposals SET
        status = ?,
        rejected_reason = ?,
        selected_at = CASE WHEN ? = 'selected' THEN ? ELSE selected_at END,
        held_at = CASE WHEN ? = 'held' THEN ? ELSE held_at END,
        rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_at END,
        updated_at = ?
      WHERE campaign_proposal_id = ?
    `).run(
      status,
      status === "rejected" ? reason : "",
      status, now,
      status, now,
      status, now,
      now,
      existing.campaign_proposal_id
    );
    recordCampaignProposalEvent(existing.campaign_proposal_id, existing.status, status, reason, "customer", session.customer_session_id, {
      tenant_id: session.tenant_id,
      store_id: existing.store_id,
      screen_group_id: existing.screen_group_id,
      role: session.role
    }, now);
    if (status === "selected") {
      createCampaignBriefStub(existing.campaign_proposal_id, "customer", session.customer_session_id, now);
    }
    return getCampaignProposal(existing.campaign_proposal_id, { includeEvents: true });
  })();
  recordAuditLog("customer", session.customer_session_id, "campaign_proposal.customer_status_update", "campaign_proposal", updated.campaign_proposal_id, null, updated, {
    tenant_id: session.tenant_id,
    store_id: updated.store_id,
    screen_group_id: updated.screen_group_id,
    status,
    rejected_reason: status === "rejected" ? reason : ""
  }, updated.updated_at || nowIso());
  return updated;
}

function normalizeCampaignScope(input = {}, options = {}) {
  const tenantId = cleanId(input.tenant_id || input.tenantId);
  if (!tenantId && !options.allowEmptyTenant) throw requestError("tenant_id is required", 400);
  if (tenantId) {
    const tenant = db.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ?").get(tenantId);
    if (!tenant) throw requestError("Tenant not found", 404);
  }
  let storeId = cleanId(input.store_id || input.storeId || input.site_id || input.siteId);
  const screenGroupId = cleanId(input.screen_group_id || input.screenGroupId || input.display_wall_id || input.displayWallId);
  if (screenGroupId) {
    const screenGroup = db.prepare("SELECT tenant_id, store_id FROM screen_groups WHERE screen_group_id = ?").get(screenGroupId);
    if (!screenGroup) throw requestError("Screen group not found", 404);
    if (tenantId && cleanId(screenGroup.tenant_id) !== tenantId) throw requestError("Screen group is outside tenant scope", 403);
    if (storeId && cleanId(screenGroup.store_id) !== storeId) throw requestError("Screen group is outside store scope", 403);
    storeId = storeId || cleanId(screenGroup.store_id);
  }
  if (storeId) {
    const store = db.prepare("SELECT tenant_id FROM stores WHERE store_id = ?").get(storeId);
    if (!store) throw requestError("Store not found", 404);
    if (tenantId && cleanId(store.tenant_id) !== tenantId) throw requestError("Store is outside tenant scope", 403);
  }
  if (options.requireStore && !storeId) throw requestError("store_id is required", 400);
  if (options.requireScreenGroup && !screenGroupId) throw requestError("screen_group_id is required", 400);
  return {
    tenant_id: tenantId,
    store_id: storeId,
    screen_group_id: screenGroupId
  };
}

function assertScreenGroupScope(tenantId, storeId, screenGroupId) {
  const normalizedScreenGroupId = cleanId(screenGroupId);
  if (!normalizedScreenGroupId) return "";
  const row = db.prepare("SELECT tenant_id, store_id FROM screen_groups WHERE screen_group_id = ?").get(normalizedScreenGroupId);
  if (!row) throw requestError("Screen group not found", 404);
  if (cleanId(row.tenant_id) !== cleanId(tenantId)) throw requestError("Screen group is outside tenant scope", 403);
  if (storeId && cleanId(row.store_id) !== cleanId(storeId)) throw requestError("Screen group is outside store scope", 403);
  return normalizedScreenGroupId;
}

function assertCustomerProposalScope(session, proposal) {
  if (proposal.tenant_id !== session.tenant_id) throw requestError("Campaign proposal is outside tenant scope", 403);
  assertCustomerStoreScope(session, proposal.store_id);
  if (proposal.screen_group_id) assertScreenGroupScope(session.tenant_id, proposal.store_id, proposal.screen_group_id);
}

function normalizeCustomerContextClassification(input = {}) {
  for (const field of ["context_category", "visibility_scope", "source_owner", "source_type", "confidence"]) {
    const camel = field.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    if (!cleanString(input[field] ?? input[camel])) throw requestError(`${field} is required`, 400);
  }
  const normalized = assertContextContract(input);
  const contextCategory = normalized.context_category;
  const visibilityScope = normalized.visibility_scope;
  const sourceOwner = normalized.source_owner;
  const sourceType = normalized.source_type;
  const confidence = normalized.confidence;
  return {
    context_category: contextCategory,
    visibility_scope: visibilityScope,
    source_owner: sourceOwner,
    source_type: sourceType,
    confidence
  };
}

function createCustomerContextSnapshotRecord(scope, proposalMonth, source = "operator_seed") {
  const itemRows = contextItemsForSnapshot(scope);
  const items = itemRows.map(publicCustomerContextItem);
  const itemsById = new Map(items.map((item) => [item.customer_context_item_id, item]));
  const sourceAssets = Array.from(
    listCustomerContextSourceAssetsForItems(items.map((item) => item.customer_context_item_id), { status: "active" }).values()
  ).flat().filter((asset) => sourceAssetMatchesContextItemScope(itemsById.get(asset.customer_context_item_id), asset));
  const snapshotPayload = {
    schema_version: 1,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    screen_group_id: scope.screen_group_id,
    proposal_month: proposalMonth,
    items: buildContextSnapshotSourceSummary(items, sourceAssets)
  };
  const snapshotJson = safeJsonStringify(stableReportPayloadForHash(snapshotPayload), 50000);
  const snapshotSha256 = crypto.createHash("sha256").update(snapshotJson).digest("hex");
  const now = nowIso();
  const snapshotId = nextEntityId("ccs", `${scope.store_id}-${proposalMonth}`);
  db.prepare(`
    INSERT INTO customer_context_snapshots (
      customer_context_snapshot_id, tenant_id, store_id, screen_group_id,
      proposal_month, snapshot_json, snapshot_sha256, item_count, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId,
    scope.tenant_id,
    scope.store_id,
    scope.screen_group_id,
    proposalMonth,
    snapshotJson,
    snapshotSha256,
    items.length,
    cleanString(source || "operator_seed").slice(0, 80) || "operator_seed",
    now
  );
  return getCustomerContextSnapshot(snapshotId, scope);
}

function contextItemsForSnapshot(scope) {
  return db.prepare(`
    SELECT * FROM customer_context_items
    WHERE tenant_id = ?
      AND store_id = ?
      AND screen_group_id = ?
      AND status = 'active'
    ORDER BY context_category ASC, item_type ASC, item_key ASC, updated_at ASC
  `).all(scope.tenant_id, scope.store_id, scope.screen_group_id);
}

function getCustomerContextSnapshot(snapshotId, scope = null) {
  const row = db.prepare(`
    SELECT * FROM customer_context_snapshots
    WHERE customer_context_snapshot_id = ?
  `).get(cleanId(snapshotId));
  if (!row) throw requestError("Customer context snapshot not found", 404);
  if (scope) {
    if (cleanId(row.tenant_id) !== scope.tenant_id) throw requestError("Customer context snapshot is outside tenant scope", 403);
    if (scope.store_id && cleanId(row.store_id) !== scope.store_id) throw requestError("Customer context snapshot is outside store scope", 403);
    if (scope.screen_group_id && cleanId(row.screen_group_id) !== scope.screen_group_id) throw requestError("Customer context snapshot is outside screen group scope", 403);
  }
  return publicCustomerContextSnapshot(row);
}

function createProposalGenerationRunRecord(input) {
  if (normalizeBooleanFlag(input.external_ai_used || input.externalAiUsed) || cleanString(input.external_ai_provider || input.externalAiProvider)) {
    throw requestError("External AI generation is out of scope for this foundation endpoint", 400);
  }
  const now = nowIso();
  const runId = cleanId(input.proposal_generation_run_id || input.proposalGenerationRunId) ||
    nextEntityId("pgr", `${input.store_id}-${input.proposal_month}`);
  const status = cleanString(input.status || "completed");
  if (!["queued", "running", "completed", "failed"].includes(status)) {
    throw requestError("proposal generation run status must be queued, running, completed, or failed", 400);
  }
  db.prepare(`
    INSERT INTO proposal_generation_runs (
      proposal_generation_run_id, tenant_id, store_id, screen_group_id,
      proposal_month, context_snapshot_id, generator_type, status,
      external_ai_used, external_ai_provider, external_ai_request_id,
      requested_by_user_id, proposal_count, error, metadata_json,
      started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    input.tenant_id,
    input.store_id,
    input.screen_group_id,
    input.proposal_month,
    input.context_snapshot_id,
    cleanString(input.generator_type || "operator_seed").slice(0, 80) || "operator_seed",
    status,
    cleanString(input.requested_by_user_id).slice(0, 120),
    Math.max(0, asInteger(input.proposal_count) || 0),
    cleanString(input.error).slice(0, 1000),
    safeJsonStringify(input.metadata || {}, 10000),
    now,
    status === "completed" || status === "failed" ? now : null,
    now,
    now
  );
  return getProposalGenerationRun(runId, {
    tenant_id: input.tenant_id,
    store_id: input.store_id,
    screen_group_id: input.screen_group_id
  });
}

function getProposalGenerationRun(runId, scope = null) {
  const row = db.prepare(`
    SELECT pgr.*, ccs.snapshot_sha256, ccs.item_count
    FROM proposal_generation_runs pgr
    LEFT JOIN customer_context_snapshots ccs ON ccs.customer_context_snapshot_id = pgr.context_snapshot_id
    WHERE pgr.proposal_generation_run_id = ?
  `).get(cleanId(runId));
  if (!row) throw requestError("Proposal generation run not found", 404);
  if (scope) {
    if (scope.tenant_id && cleanId(row.tenant_id) !== scope.tenant_id) throw requestError("Proposal generation run is outside tenant scope", 403);
    if (scope.store_id && cleanId(row.store_id) !== scope.store_id) throw requestError("Proposal generation run is outside store scope", 403);
    if (scope.screen_group_id && cleanId(row.screen_group_id) !== scope.screen_group_id) throw requestError("Proposal generation run is outside screen group scope", 403);
  }
  return publicProposalGenerationRun(row);
}

function getCampaignProposal(proposalId, options = {}) {
  const row = db.prepare(`
    SELECT cp.*, ccs.snapshot_sha256, ccs.item_count, cb.campaign_brief_id, cb.status AS campaign_brief_status
    FROM campaign_proposals cp
    LEFT JOIN customer_context_snapshots ccs ON ccs.customer_context_snapshot_id = cp.context_snapshot_id
    LEFT JOIN campaign_briefs cb ON cb.campaign_proposal_id = cp.campaign_proposal_id
    WHERE cp.campaign_proposal_id = ?
  `).get(cleanId(proposalId));
  return row ? publicCampaignProposal(row, options) : null;
}

function createCampaignBriefStub(campaignProposalId, actorType, actorId, createdAt = nowIso()) {
  const existing = db.prepare("SELECT * FROM campaign_briefs WHERE campaign_proposal_id = ?").get(cleanId(campaignProposalId));
  if (existing) return publicCampaignBrief(existing);
  const proposal = getCampaignProposal(campaignProposalId);
  if (!proposal) throw requestError("Campaign proposal not found", 404);
  const briefId = nextEntityId("cbr", campaignProposalId);
  const briefPayload = {
    schema_version: 1,
    status: "stub",
    source: "campaign_proposal_selected",
    campaign_proposal_id: proposal.campaign_proposal_id,
    title: proposal.title,
    objective: proposal.objective,
    target_audience: proposal.target_audience,
    three_screen_outline: proposal.three_screen_outline,
    qr_flow: proposal.qr_flow,
    recommended_time_slots: proposal.recommended_time_slots,
    expected_effect: proposal.expected_effect,
    required_assets: proposal.required_assets,
    no_scene_generation: true,
    no_content_manifest_creation: true,
    no_external_ai: true
  };
  db.prepare(`
    INSERT INTO campaign_briefs (
      campaign_brief_id, campaign_proposal_id, tenant_id, store_id, screen_group_id,
      context_snapshot_id, status, brief_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'stub', ?, ?, ?)
  `).run(
    briefId,
    proposal.campaign_proposal_id,
    proposal.tenant_id,
    proposal.store_id,
    proposal.screen_group_id,
    proposal.context_snapshot_id,
    safeJsonStringify(briefPayload, 30000),
    createdAt,
    createdAt
  );
  recordCampaignProposalEvent(proposal.campaign_proposal_id, proposal.status, proposal.status, "campaign_brief_stub_created", actorType, actorId, {
    campaign_brief_id: briefId,
    no_scene_generation: true,
    no_content_manifest_creation: true
  }, createdAt);
  return publicCampaignBrief(db.prepare("SELECT * FROM campaign_briefs WHERE campaign_brief_id = ?").get(briefId));
}

function recordCampaignProposalEvent(proposalId, fromStatus, toStatus, reason, actorType, actorId, metadata = {}, createdAt = nowIso()) {
  const proposal = db.prepare("SELECT tenant_id, store_id, screen_group_id FROM campaign_proposals WHERE campaign_proposal_id = ?").get(cleanId(proposalId));
  if (!proposal) throw requestError("Campaign proposal not found", 404);
  const eventId = nextEntityId("cpe", proposalId);
  db.prepare(`
    INSERT INTO campaign_proposal_events (
      campaign_proposal_event_id, campaign_proposal_id, tenant_id, store_id, screen_group_id,
      from_status, to_status, reason, actor_type, actor_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    cleanId(proposalId),
    cleanId(proposal.tenant_id),
    cleanId(proposal.store_id),
    cleanId(proposal.screen_group_id),
    cleanString(fromStatus),
    cleanString(toStatus),
    cleanString(reason).slice(0, 1000),
    cleanString(actorType || "admin").slice(0, 80),
    cleanString(actorId).slice(0, 120),
    safeJsonStringify(metadata || {}, 10000),
    createdAt
  );
  return eventId;
}

function listCampaignProposalEvents(campaignProposalId) {
  return db.prepare(`
    SELECT * FROM campaign_proposal_events
    WHERE campaign_proposal_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).all(cleanId(campaignProposalId)).map(publicCampaignProposalEvent);
}

function createCampaignProjectFromProposal(input, actor = {}) {
  assertCampaignGeneratorInput(input);
  const proposalId = cleanId(input.campaign_proposal_id || input.campaignProposalId);
  if (!proposalId) throw requestError("campaign_proposal_id is required", 400);
  const proposal = getCampaignProposal(proposalId);
  if (!proposal) throw requestError("Campaign proposal not found", 404);
  if (proposal.status !== "selected") throw requestError("Campaign proposal must be selected before project creation", 400);
  assertCampaignProjectInputScope(input, proposal, "Campaign proposal");
  const brief = createCampaignBriefStub(proposal.campaign_proposal_id, "admin", actor.actor_id || "admin");
  const campaignBrief = normalizeCampaignBriefForProject(input.brief || input, briefDefaultsFromProposal(proposal, brief, actor));
  return insertCampaignProject({
    input,
    scope: {
      tenant_id: proposal.tenant_id,
      store_id: proposal.store_id,
      screen_group_id: proposal.screen_group_id
    },
    source_type: "campaign_proposal",
    source_proposal_id: proposal.campaign_proposal_id,
    source_context_snapshot_id: proposal.context_snapshot_id,
    campaign_brief_id: brief.campaign_brief_id,
    title: cleanString(input.title || proposal.title).slice(0, 200) || campaignBrief.objective,
    campaignBrief,
    scenes: resolveCampaignProjectInitialScenes(input, campaignBrief, {
      source_type: "campaign_proposal",
      title: input.title || proposal.title
    })
  }, actor);
}

function createCampaignProjectFromBrief(input, actor = {}) {
  assertCampaignGeneratorInput(input);
  const briefId = cleanId(input.campaign_brief_id || input.campaignBriefId);
  if (!briefId) throw requestError("campaign_brief_id is required", 400);
  const brief = getCampaignBrief(briefId);
  if (!brief) throw requestError("Campaign brief not found", 404);
  assertCampaignProjectInputScope(input, brief, "Campaign brief");
  const proposal = getCampaignProposal(brief.campaign_proposal_id);
  if (!proposal) throw requestError("Campaign brief source proposal not found", 404);
  if (proposal.status !== "selected") throw requestError("Campaign brief source proposal must be selected before project creation", 400);
  const campaignBrief = normalizeCampaignBriefForProject(input.brief || input, briefDefaultsFromProposal(proposal, brief, actor));
  return insertCampaignProject({
    input,
    scope: {
      tenant_id: brief.tenant_id,
      store_id: brief.store_id,
      screen_group_id: brief.screen_group_id
    },
    source_type: "campaign_brief",
    source_proposal_id: proposal.campaign_proposal_id,
    source_context_snapshot_id: brief.context_snapshot_id,
    campaign_brief_id: brief.campaign_brief_id,
    title: cleanString(input.title || proposal.title).slice(0, 200) || campaignBrief.objective,
    campaignBrief,
    scenes: resolveCampaignProjectInitialScenes(input, campaignBrief, {
      source_type: "campaign_brief",
      title: input.title || proposal.title
    })
  }, actor);
}

function createCampaignProjectFromFreeInput(input, actor = {}) {
  assertCampaignGeneratorInput(input);
  const scope = normalizeCampaignScope(input, { requireStore: true, requireScreenGroup: true });
  const sourceContextSnapshotId = cleanId(input.source_context_snapshot_id || input.sourceContextSnapshotId || input.context_snapshot_id || input.contextSnapshotId);
  if (sourceContextSnapshotId) getCustomerContextSnapshot(sourceContextSnapshotId, scope);
  const campaignBrief = normalizeCampaignBriefForProject(input.brief || input, {
    source_context_snapshot_id: sourceContextSnapshotId,
    created_by_user_id: actor.actor_id || "admin"
  });
  return insertCampaignProject({
    input,
    scope,
    source_type: "free_input",
    source_proposal_id: "",
    source_context_snapshot_id: campaignBrief.source_context_snapshot_id,
    campaign_brief_id: "",
    title: cleanString(input.title).slice(0, 200) || campaignBrief.objective,
    campaignBrief,
    scenes: resolveCampaignProjectInitialScenes(input, campaignBrief, {
      source_type: "free_input",
      title: input.title
    })
  }, actor);
}

function insertCampaignProject({ input, scope, source_type: sourceType, source_proposal_id: sourceProposalId, source_context_snapshot_id: sourceContextSnapshotId, campaign_brief_id: campaignBriefId, title, campaignBrief, scenes }, actor = {}) {
  if (!CAMPAIGN_PROJECT_SOURCE_TYPE.has(sourceType)) {
    throw requestError(`source_type must be one of: ${Array.from(CAMPAIGN_PROJECT_SOURCE_TYPE).join(", ")}`, 400);
  }
  const project = db.transaction(() => {
    const now = nowIso();
    const projectId = cleanId(input.campaign_project_id || input.campaignProjectId) ||
      nextEntityId("cgp", `${scope.store_id}-${scope.screen_group_id}`);
    db.prepare(`
      INSERT INTO campaign_projects (
        campaign_project_id, tenant_id, store_id, screen_group_id,
        campaign_brief_id, source_type, source_proposal_id, source_context_snapshot_id,
        title, objective, target_audience, store_context, offer_or_message, cta,
        success_metrics_json, constraints_json, campaign_brief_json,
        status, validation_status, validation_errors_json,
        created_by_user_id, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'draft', '[]', ?, NULL, ?, ?)
    `).run(
      projectId,
      scope.tenant_id,
      scope.store_id,
      scope.screen_group_id,
      cleanId(campaignBriefId),
      sourceType,
      cleanId(sourceProposalId),
      cleanId(sourceContextSnapshotId),
      cleanString(title).slice(0, 200) || "Campaign Project",
      campaignBrief.objective,
      campaignBrief.target_audience,
      campaignBrief.store_context,
      campaignBrief.offer_or_message,
      campaignBrief.cta,
      safeJsonStringify(campaignBrief.success_metrics, 10000),
      safeJsonStringify(campaignBrief.constraints, 10000),
      safeJsonStringify({
        schema_version: 1,
        ...campaignBrief,
        no_external_ai: true,
        no_media_generation: true,
        no_content_manifest_creation: true,
        no_publish: true
      }, 40000),
      cleanString(campaignBrief.created_by_user_id || actor.actor_id || "admin").slice(0, 120),
      now,
      now
    );
    const sceneInputs = normalizeCampaignProjectSceneInputs(scenes);
    const generatedInitialSceneMetadata = shouldAutoGenerateCampaignScenes(input) && sceneInputs.length > 0
      ? {
          ...deterministicCampaignSceneGeneratorMetadata(),
          scene_count: sceneInputs.length,
          auto_generate_scenes: true
        }
      : {
          scene_count: sceneInputs.length,
          auto_generate_scenes: false
        };
    for (const sceneInput of sceneInputs) {
      insertCampaignProjectScene(projectId, scope, sceneInput, now);
    }
    recordCampaignProjectEvent(projectId, "", "project.created", "admin", actor.actor_id || "admin", {
      source_type: sourceType,
      source_proposal_id: cleanId(sourceProposalId),
      campaign_brief_id: cleanId(campaignBriefId),
      ...generatedInitialSceneMetadata,
      no_external_ai: true,
      no_media_generation: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return getCampaignProject(projectId, null, { includeScenes: true, includeEvents: true });
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "campaign_project.create", "campaign_project", project.campaign_project_id, null, project, {
    tenant_id: project.tenant_id,
    store_id: project.store_id,
    screen_group_id: project.screen_group_id,
    source_type: project.source_type,
    ...((project.events || []).find((event) => event.action === "project.created")?.metadata || {}),
    no_external_ai: true,
    no_content_manifest_creation: true
  }, project.created_at || nowIso());
  return project;
}

function listCampaignProjects(query = {}) {
  const scope = normalizeCampaignProjectScopeQuery(query);
  const status = cleanString(query.status);
  if (status && !CAMPAIGN_PROJECT_STATUS.has(status)) {
    throw requestError(`status must be one of: ${Array.from(CAMPAIGN_PROJECT_STATUS).join(", ")}`, 400);
  }
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM campaign_projects
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR screen_group_id = ?)
      AND (? = '' OR status = ?)
      AND (? = 1 OR status != 'deleted')
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(
    scope.tenant_id, scope.tenant_id,
    scope.store_id, scope.store_id,
    scope.screen_group_id, scope.screen_group_id,
    status, status,
    includeDeleted ? 1 : 0,
    limit
  ).map(publicCampaignProject);
}

function getCampaignProject(projectId, scope = null, options = {}) {
  const row = db.prepare("SELECT * FROM campaign_projects WHERE campaign_project_id = ?").get(cleanId(projectId));
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Campaign project");
  return publicCampaignProject(row, options);
}

function getCampaignProjectPlaylistHandoffDraft(projectId, scope = null) {
  const row = getCampaignProjectRow(projectId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Campaign project");
  if (row.status === "deleted") throw requestError("Campaign project is deleted", 400);
  return buildCampaignProjectPlaylistHandoffDraft(
    publicCampaignProject(row),
    listCampaignProjectScenes(row.campaign_project_id)
  );
}

function getCampaignProjectScheduleHandoffDraft(projectId, scope = null) {
  const row = getCampaignProjectRow(projectId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Campaign project");
  if (row.status === "deleted") throw requestError("Campaign project is deleted", 400);
  const project = publicCampaignProject(row);
  const scenes = listCampaignProjectScenes(row.campaign_project_id);
  return buildCampaignProjectScheduleHandoffDraft(
    project,
    scenes,
    getStoreSettings(project.store_id, { withDefaults: true })
  );
}

function activeCampaignProjectScenes(scenes = []) {
  return scenes
    .filter((scene) => scene.status !== "deleted")
    .sort((a, b) => (Number(a.scene_order || 0) - Number(b.scene_order || 0)));
}

function buildCampaignProjectPlaylistHandoffDraft(project, scenes = []) {
  const activeScenes = activeCampaignProjectScenes(scenes);
  const validationIssues = campaignProjectHandoffValidationIssues(project, activeScenes);
  const payload = {
    schema_version: "campaign-project-playlist-handoff-draft/v1",
    draft_type: "operator_copy_handoff",
    draft_status: validationIssues.length ? "needs_validation" : "ready_for_operator_handoff",
    draft_key: cleanId(`handoff-${project.campaign_project_id}-${project.updated_at || project.created_at || ""}`),
    source_updated_at: project.updated_at,
    campaign_project_id: project.campaign_project_id,
    tenant_id: project.tenant_id,
    store_id: project.store_id,
    screen_group_id: project.screen_group_id,
    no_external_ai: true,
    no_media_generation: true,
    no_content_manifest_creation: true,
    no_publish: true,
    no_credit_consumption: true,
    publish_ready: false,
    content_manifest_created: false,
    scope: {
      tenant_id: project.tenant_id,
      store_id: project.store_id,
      screen_group_id: project.screen_group_id
    },
    source: {
      source_type: project.source_type,
      source_proposal_id: project.source_proposal_id,
      source_context_snapshot_id: project.source_context_snapshot_id,
      campaign_brief_id: project.campaign_brief_id
    },
    campaign_project: {
      campaign_project_id: project.campaign_project_id,
      title: project.title,
      objective: project.objective,
      target_audience: project.target_audience,
      cta: project.cta,
      status: project.status,
      validation_status: project.validation_status
    },
    playlist: {
      schema_version: 1,
      playlist_version: cleanId(`draft-${project.campaign_project_id}`),
      release_channel: "draft",
      title: project.title,
      item_count: activeScenes.length,
      items: activeScenes.map((scene) => buildCampaignProjectPlaylistHandoffItem(project, scene))
    },
    validation: {
      valid: validationIssues.length === 0,
      issue_count: validationIssues.length,
      issues: validationIssues
    },
    forbidden_operations: [
      "external_ai_call",
      "media_render",
      "content_manifest_create",
      "publish",
      "schedule_activate",
      "device_policy_update",
      "credit_ledger_mutation"
    ]
  };
  return {
    ...payload,
    draft_sha256: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  };
}

function buildCampaignProjectScheduleHandoffDraft(project, scenes = [], storeSettings = null) {
  const playlistDraft = buildCampaignProjectPlaylistHandoffDraft(project, scenes);
  const settings = storeSettings || {
    timezone: DEFAULT_TIMEZONE,
    business_day_start_time: "00:00"
  };
  const payload = {
    schema_version: "campaign-project-schedule-handoff-draft/v1",
    draft_type: "operator_copy_handoff",
    draft_status: playlistDraft.validation?.valid ? "ready_for_operator_schedule_input" : "needs_project_validation",
    draft_key: cleanId(`schedule-handoff-${project.campaign_project_id}-${project.updated_at || project.created_at || ""}`),
    source_updated_at: project.updated_at,
    campaign_project_id: project.campaign_project_id,
    tenant_id: project.tenant_id,
    store_id: project.store_id,
    screen_group_id: project.screen_group_id,
    no_external_ai: true,
    no_media_generation: true,
    no_content_manifest_creation: true,
    no_publish: true,
    no_credit_consumption: true,
    no_schedule_activation: true,
    schedule_activation_ready: false,
    schedule_created: false,
    device_policy_updated: false,
    content_manifest_created: false,
    scope: {
      tenant_id: project.tenant_id,
      store_id: project.store_id,
      screen_group_id: project.screen_group_id
    },
    source: {
      campaign_project_id: project.campaign_project_id,
      playlist_draft_key: playlistDraft.draft_key,
      playlist_draft_sha256: playlistDraft.draft_sha256
    },
    playlist_reference: {
      schema_version: playlistDraft.schema_version,
      playlist_version: playlistDraft.playlist?.playlist_version || "",
      release_channel: playlistDraft.playlist?.release_channel || "draft",
      item_count: playlistDraft.playlist?.item_count || 0,
      draft_key: playlistDraft.draft_key,
      draft_sha256: playlistDraft.draft_sha256,
      validation_valid: playlistDraft.validation?.valid === true
    },
    schedule: {
      schema_version: 1,
      schedule_version: cleanId(`schedule-draft-${project.campaign_project_id}`),
      status: "draft",
      activation_mode: "manual_after_publish_gate",
      timezone: cleanString(settings.timezone || DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE,
      business_day_start_time: cleanString(settings.business_day_start_time || "00:00") || "00:00",
      start_date: "",
      end_date: "",
      days_of_week: [],
      time_windows: [],
      priority: 0,
      requires_operator_schedule_input: true,
      operator_required_fields: [
        "start_date",
        "end_date",
        "days_of_week",
        "time_windows",
        "priority"
      ]
    },
    validation: {
      valid: playlistDraft.validation?.valid === true,
      issue_count: playlistDraft.validation?.issue_count || 0,
      issues: playlistDraft.validation?.issues || []
    },
    forbidden_operations: [
      "external_ai_call",
      "media_render",
      "content_manifest_create",
      "publish",
      "schedule_activate",
      "schedule_create",
      "device_policy_update",
      "credit_ledger_mutation"
    ]
  };
  return {
    ...payload,
    draft_sha256: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  };
}

function buildCampaignProjectPlaylistHandoffItem(project, scene) {
  const layout = scene.scene_type === "wide" ? "wide" : "three-zone";
  const item = {
    draft_playlist_item_id: cleanId(`draft-${scene.campaign_project_scene_id}`),
    source_scene_id: scene.campaign_project_scene_id,
    scene_order: scene.scene_order,
    scene_type: scene.scene_type,
    layout,
    enabled: true,
    duration: scene.duration_seconds,
    duration_seconds: scene.duration_seconds,
    campaign_id: project.campaign_project_id,
    asset_id: "",
    validation_status: scene.validation_status,
    validation_errors: scene.validation_errors,
    asset_requirements: scene.asset_requirements
  };
  if (layout === "wide") {
    return {
      ...item,
      wide: {
        headline: scene.headline,
        body_text: scene.body_text,
        visual_direction: scene.visual_direction,
        cta_text: scene.cta_text || project.cta
      }
    };
  }
  return {
    ...item,
    left: {
      text: scene.visual_direction || project.store_context,
      asset_requirements: scene.asset_requirements
    },
    center: {
      headline: scene.headline,
      body_text: scene.body_text
    },
    right: {
      cta_text: scene.cta_text || project.cta
    }
  };
}

function campaignProjectHandoffValidationIssues(project, scenes = []) {
  const issues = [];
  if (!scenes.length) {
    issues.push({ field: "scenes", code: "required", message: "at least one active scene is required" });
  }
  if (project.status !== "validated" || project.validation_status !== "valid") {
    issues.push({ field: "campaign_project", code: "not_validated", message: "campaign project must be validated before operator handoff" });
  }
  const projectErrors = Array.isArray(project.validation_errors) ? project.validation_errors : [];
  for (const error of projectErrors) {
    issues.push({ ...error, source: "campaign_project" });
  }
  for (const scene of scenes) {
    if (scene.status !== "valid" || scene.validation_status !== "valid") {
      issues.push({
        field: "scene",
        code: "not_validated",
        message: "scene must be valid before operator handoff",
        campaign_project_scene_id: scene.campaign_project_scene_id,
        scene_order: scene.scene_order
      });
    }
    const sceneErrors = Array.isArray(scene.validation_errors) ? scene.validation_errors : [];
    for (const error of sceneErrors) {
      issues.push({
        ...error,
        source: "campaign_project_scene",
        campaign_project_scene_id: scene.campaign_project_scene_id,
        scene_order: scene.scene_order
      });
    }
  }
  return issues;
}

function createCampaignProjectScene(projectId, input, actor = {}) {
  assertCampaignGeneratorInput(input);
  const projectRow = getCampaignProjectRow(projectId);
  if (!projectRow) throw requestError("Campaign project not found", 404);
  if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
  const scene = db.transaction(() => {
    const now = nowIso();
    const sceneInput = normalizeSceneForStorage(input, {
      scene_order: nextCampaignProjectSceneOrder(projectRow.campaign_project_id)
    });
    const inserted = insertCampaignProjectScene(projectRow.campaign_project_id, projectRow, sceneInput, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, inserted.campaign_project_scene_id, "scene.created", "admin", actor.actor_id || "admin", {
      scene_order: inserted.scene_order
    }, now);
    touchCampaignProjectDraft(projectRow.campaign_project_id, now);
    return inserted;
  })();
  return scene;
}

function updateCampaignProjectScene(projectId, sceneId, input, actor = {}) {
  assertCampaignGeneratorInput(input);
  const scene = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const existing = getCampaignProjectSceneRow(sceneId);
    if (!existing || cleanId(existing.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
      throw requestError("Campaign project scene not found", 404);
    }
    if (existing.status === "deleted") throw requestError("Campaign project scene is deleted", 400);
    const normalized = normalizeSceneForStorage(input, publicCampaignProjectScene(existing));
    assertCampaignProjectSceneOrderAvailable(projectRow.campaign_project_id, normalized.scene_order, existing.campaign_project_scene_id);
    const now = nowIso();
    db.prepare(`
      UPDATE campaign_project_scenes SET
        scene_order = ?,
        scene_type = ?,
        headline = ?,
        body_text = ?,
        visual_direction = ?,
        cta_text = ?,
        duration_seconds = ?,
        asset_requirements_json = ?,
        status = 'draft',
        validation_status = 'draft',
        validation_errors_json = '[]',
        updated_at = ?
      WHERE campaign_project_scene_id = ?
    `).run(
      normalized.scene_order,
      normalized.scene_type,
      normalized.headline,
      normalized.body_text,
      normalized.visual_direction,
      normalized.cta_text,
      normalized.duration_seconds,
      safeJsonStringify(normalized.asset_requirements, 10000),
      now,
      existing.campaign_project_scene_id
    );
    touchCampaignProjectDraft(projectRow.campaign_project_id, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, existing.campaign_project_scene_id, "scene.updated", "admin", actor.actor_id || "admin", {
      scene_order: normalized.scene_order
    }, now);
    return publicCampaignProjectScene(getCampaignProjectSceneRow(existing.campaign_project_scene_id));
  })();
  return scene;
}

function reorderCampaignProjectScene(projectId, sceneId, input = {}, actor = {}) {
  assertCampaignGeneratorInput(input);
  const direction = cleanString(input.direction).toLowerCase();
  if (!["up", "down"].includes(direction)) throw requestError("direction must be up or down", 400);
  return db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const sceneRow = getCampaignProjectSceneRow(sceneId);
    if (!sceneRow || cleanId(sceneRow.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
      throw requestError("Campaign project scene not found", 404);
    }
    if (sceneRow.status === "deleted") throw requestError("Campaign project scene is deleted", 400);
    const activeScenes = db.prepare(`
      SELECT campaign_project_scene_id, scene_order
      FROM campaign_project_scenes
      WHERE campaign_project_id = ?
        AND status != 'deleted'
      ORDER BY scene_order ASC, id ASC
    `).all(projectRow.campaign_project_id);
    const currentIndex = activeScenes.findIndex((scene) => scene.campaign_project_scene_id === sceneRow.campaign_project_scene_id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    const targetScene = activeScenes[targetIndex];
    if (currentIndex < 0 || !targetScene) throw requestError(`scene cannot move ${direction}`, 409);
    const now = nowIso();
    const temporaryOrder = nextCampaignProjectSceneOrder(projectRow.campaign_project_id);
    db.prepare(`
      UPDATE campaign_project_scenes
      SET scene_order = ?, updated_at = ?
      WHERE campaign_project_scene_id = ?
    `).run(temporaryOrder, now, sceneRow.campaign_project_scene_id);
    db.prepare(`
      UPDATE campaign_project_scenes
      SET scene_order = ?, updated_at = ?
      WHERE campaign_project_scene_id = ?
    `).run(sceneRow.scene_order, now, targetScene.campaign_project_scene_id);
    db.prepare(`
      UPDATE campaign_project_scenes
      SET scene_order = ?, updated_at = ?
      WHERE campaign_project_scene_id = ?
    `).run(targetScene.scene_order, now, sceneRow.campaign_project_scene_id);
    touchCampaignProjectDraft(projectRow.campaign_project_id, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, sceneRow.campaign_project_scene_id, "scene.reordered", "admin", actor.actor_id || "admin", {
      direction,
      from_order: asInteger(sceneRow.scene_order) || 0,
      to_order: asInteger(targetScene.scene_order) || 0,
      swapped_with_scene_id: targetScene.campaign_project_scene_id,
      swapped_with_order: asInteger(targetScene.scene_order) || 0,
      temporary_order: temporaryOrder,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true,
      no_external_ai: true
    }, now);
    return {
      campaign_project_scene: publicCampaignProjectScene(getCampaignProjectSceneRow(sceneRow.campaign_project_scene_id)),
      campaign_project: getCampaignProject(projectRow.campaign_project_id, null, { includeScenes: true, includeEvents: true })
    };
  })();
}

function duplicateCampaignProjectScene(projectId, sceneId, input = {}, actor = {}) {
  assertCampaignGeneratorInput(input);
  return db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const sourceRow = getCampaignProjectSceneRow(sceneId);
    if (!sourceRow || cleanId(sourceRow.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
      throw requestError("Campaign project scene not found", 404);
    }
    if (sourceRow.status === "deleted") throw requestError("Campaign project scene is deleted", 400);
    const sourceScene = publicCampaignProjectScene(sourceRow);
    const now = nowIso();
    const duplicate = insertCampaignProjectScene(projectRow.campaign_project_id, projectRow, {
      scene_order: nextCampaignProjectSceneOrder(projectRow.campaign_project_id),
      scene_type: sourceScene.scene_type,
      headline: sourceScene.headline,
      body_text: sourceScene.body_text,
      visual_direction: sourceScene.visual_direction,
      cta_text: sourceScene.cta_text,
      duration_seconds: sourceScene.duration_seconds,
      asset_requirements: sourceScene.asset_requirements
    }, now);
    touchCampaignProjectDraft(projectRow.campaign_project_id, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, duplicate.campaign_project_scene_id, "scene.duplicated", "admin", actor.actor_id || "admin", {
      source_scene_id: sourceScene.campaign_project_scene_id,
      source_scene_order: asInteger(sourceScene.scene_order) || 0,
      new_scene_order: asInteger(duplicate.scene_order) || 0,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true,
      no_external_ai: true
    }, now);
    return duplicate;
  })();
}

function generateCampaignProjectScenes(projectId, input = {}, actor = {}) {
  assertCampaignGeneratorInput(input);
  const projectRow = getCampaignProjectRow(projectId);
  if (!projectRow) throw requestError("Campaign project not found", 404);
  if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
  const scope = normalizeCampaignProjectScopeQuery(input);
  if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
    assertCampaignProjectInputScope(scope, projectRow, "Campaign project");
  }
  const activeScenes = listCampaignProjectScenes(projectRow.campaign_project_id);
  if (activeScenes.length > 0) {
    throw requestError("Campaign project already has active scenes; edit, duplicate, or delete existing scenes before generating initial scenes", 409);
  }
  const generated = db.transaction(() => {
    const now = nowIso();
    const startOrder = nextCampaignProjectSceneOrder(projectRow.campaign_project_id);
    const scenes = buildDeterministicCampaignProjectScenes(
      campaignBriefFromProjectRow(projectRow),
      { title: projectRow.title, source_type: projectRow.source_type, start_order: startOrder }
    );
    const inserted = scenes.map((scene) => insertCampaignProjectScene(projectRow.campaign_project_id, projectRow, scene, now));
    touchCampaignProjectDraft(projectRow.campaign_project_id, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, "", "project.scenes.generated", "admin", actor.actor_id || "admin", {
      generator_type: "deterministic_template",
      generator_version: "campaign-demo-v1",
      scene_count: inserted.length,
      no_external_ai: true,
      no_media_generation: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true
    }, now);
    return {
      generated_scenes: inserted,
      campaign_project: getCampaignProject(projectRow.campaign_project_id, null, { includeScenes: true, includeEvents: true }),
      generator: deterministicCampaignSceneGeneratorMetadata()
    };
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "campaign_project.scenes.generate", "campaign_project", projectRow.campaign_project_id, null, generated, {
    tenant_id: projectRow.tenant_id,
    store_id: projectRow.store_id,
    screen_group_id: projectRow.screen_group_id,
    no_external_ai: true,
    no_content_manifest_creation: true,
    no_publish: true
  }, nowIso());
  return generated;
}

function createCampaignProjectRegenerationRequest(projectId, sceneId, input = {}, actor = {}) {
  assertCampaignGeneratorInput(input);
  const requestType = cleanString(input.request_type || input.requestType).slice(0, 80);
  if (!CAMPAIGN_PROJECT_REGENERATION_REQUEST_TYPES.has(requestType)) {
    throw requestError(`request_type must be one of: ${Array.from(CAMPAIGN_PROJECT_REGENERATION_REQUEST_TYPES).join(", ")}`, 400);
  }
  const request = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const sceneRow = getCampaignProjectSceneRow(sceneId);
    if (!sceneRow || cleanId(sceneRow.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
      throw requestError("Campaign project scene not found", 404);
    }
    if (sceneRow.status === "deleted") throw requestError("Campaign project scene is deleted", 400);
    const now = nowIso();
    const actorId = actor.actor_id || "admin";
    const reason = cleanString(input.reason || input.request_reason || input.requestReason).slice(0, 1000);
    const metadata = {
      request_type: requestType,
      request_status: "manual_required",
      reason,
      scene_order: asInteger(sceneRow.scene_order) || 0,
      no_external_ai: true,
      no_provider_job: true,
      no_generated_output: true,
      no_scene_mutation: true,
      no_media_generation: true,
      no_render: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true,
      no_billing: true
    };
    const eventId = recordCampaignProjectEvent(
      projectRow.campaign_project_id,
      sceneRow.campaign_project_scene_id,
      CAMPAIGN_PROJECT_REGENERATION_ACTIONS[requestType],
      "admin",
      actorId,
      metadata,
      now
    );
    recordAuditLog("admin", actorId, "campaign_project.regeneration_request", "campaign_project_scene", sceneRow.campaign_project_scene_id, null, null, {
      tenant_id: projectRow.tenant_id,
      store_id: projectRow.store_id,
      screen_group_id: projectRow.screen_group_id,
      campaign_project_id: projectRow.campaign_project_id,
      campaign_project_event_id: eventId,
      request_type: requestType,
      request_status: "manual_required",
      no_external_ai: true,
      no_scene_mutation: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true
    }, now);
    return {
      campaign_project_event_id: eventId,
      campaign_project_id: projectRow.campaign_project_id,
      campaign_project_scene_id: sceneRow.campaign_project_scene_id,
      request_type: requestType,
      status: "manual_required",
      reason,
      created_at: now,
      no_external_ai: true,
      no_scene_mutation: true,
      no_generated_output: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true
    };
  })();
  return request;
}

function validateCampaignProject(projectId, input = {}, actor = {}) {
  assertCampaignGeneratorInput(input);
  const result = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const now = nowIso();
    const projectErrors = validateCampaignProjectSource(projectRow);
    const scenes = db.prepare(`
      SELECT * FROM campaign_project_scenes
      WHERE campaign_project_id = ?
      ORDER BY scene_order ASC, id ASC
    `).all(projectRow.campaign_project_id);
    const activeScenes = scenes.filter((scene) => scene.status !== "deleted");
    if (activeScenes.length === 0) {
      projectErrors.push({ field: "scenes", code: "required", message: "at least one scene draft is required" });
    }
    const validatedScenes = [];
    for (const sceneRow of activeScenes) {
      const validation = validateSceneDraft(publicCampaignProjectScene(sceneRow));
      const nextStatus = validation.valid ? "valid" : "invalid";
      db.prepare(`
        UPDATE campaign_project_scenes SET
          status = ?,
          validation_status = ?,
          validation_errors_json = ?,
          updated_at = ?
        WHERE campaign_project_scene_id = ?
      `).run(
        nextStatus,
        nextStatus,
        safeJsonStringify(validation.errors, 10000),
        now,
        sceneRow.campaign_project_scene_id
      );
      validatedScenes.push(publicCampaignProjectScene(getCampaignProjectSceneRow(sceneRow.campaign_project_scene_id)));
    }
    const sceneErrors = validatedScenes.flatMap((scene) => scene.validation_errors.map((error) => ({
      ...error,
      campaign_project_scene_id: scene.campaign_project_scene_id,
      scene_order: scene.scene_order
    })));
    const allErrors = [...projectErrors, ...sceneErrors];
    const valid = allErrors.length === 0;
    const projectStatus = valid ? "validated" : "draft";
    const validationStatus = valid ? "valid" : "invalid";
    db.prepare(`
      UPDATE campaign_projects SET
        status = ?,
        validation_status = ?,
        validation_errors_json = ?,
        updated_at = ?
      WHERE campaign_project_id = ?
    `).run(
      projectStatus,
      validationStatus,
      safeJsonStringify(projectErrors, 10000),
      now,
      projectRow.campaign_project_id
    );
    recordCampaignProjectEvent(projectRow.campaign_project_id, "", "project.validated", "admin", actor.actor_id || "admin", {
      valid,
      error_count: allErrors.length,
      scene_count: activeScenes.length,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return {
      valid,
      validation_errors: allErrors,
      campaign_project: getCampaignProject(projectRow.campaign_project_id, null, { includeScenes: true, includeEvents: true })
    };
  })();
  return result;
}

function softDeleteCampaignProject(projectId, actor = {}) {
  const project = db.transaction(() => {
    const existing = getCampaignProjectRow(projectId);
    if (!existing) throw requestError("Campaign project not found", 404);
    if (existing.status === "deleted") return publicCampaignProject(existing, { includeScenes: true, includeEvents: true });
    const now = nowIso();
    db.prepare(`
      UPDATE campaign_projects SET
        status = 'deleted',
        deleted_at = ?,
        updated_at = ?
      WHERE campaign_project_id = ?
    `).run(now, now, existing.campaign_project_id);
    recordCampaignProjectEvent(existing.campaign_project_id, "", "project.deleted", "admin", actor.actor_id || "admin", {}, now);
    return getCampaignProject(existing.campaign_project_id, null, { includeScenes: true, includeEvents: true });
  })();
  return project;
}

function softDeleteCampaignProjectScene(projectId, sceneId, actor = {}) {
  const scene = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    const existing = getCampaignProjectSceneRow(sceneId);
    if (!existing || cleanId(existing.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
      throw requestError("Campaign project scene not found", 404);
    }
    if (existing.status === "deleted") return publicCampaignProjectScene(existing);
    const now = nowIso();
    db.prepare(`
      UPDATE campaign_project_scenes SET
        status = 'deleted',
        validation_status = 'deleted',
        deleted_at = ?,
        updated_at = ?
      WHERE campaign_project_scene_id = ?
    `).run(now, now, existing.campaign_project_scene_id);
    touchCampaignProjectDraft(projectRow.campaign_project_id, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, existing.campaign_project_scene_id, "scene.deleted", "admin", actor.actor_id || "admin", {}, now);
    return publicCampaignProjectScene(getCampaignProjectSceneRow(existing.campaign_project_scene_id));
  })();
  return scene;
}

function createStudioCutPlanFromProject(projectId, input = {}, actor = {}) {
  assertStudioA1InputBoundary(input);
  const created = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const scope = normalizeCampaignProjectScopeQuery(input);
    if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
      assertCampaignProjectInputScope(scope, projectRow, "Campaign project");
    }
    const scenes = listCampaignProjectScenes(projectRow.campaign_project_id);
    if (scenes.length === 0) throw requestError("at least one active scene is required before creating a cut plan", 400);
    const layoutTemplate = getStudioLayoutTemplate(cleanId(input.layout_template_id || input.layoutTemplateId) || "");
    const publicProject = publicCampaignProject(projectRow);
    const cutPlanId = cleanId(input.cut_plan_id || input.cutPlanId) ||
      nextEntityId("scp", `${projectRow.store_id}-${projectRow.screen_group_id}`);
    const cutPlanContract = buildCutPlanContract(publicProject, scenes, layoutTemplate, { cut_plan_id: cutPlanId });
    const validation = validateCutPlanContract(cutPlanContract, layoutTemplate);
    if (!validation.valid) {
      throw requestError(`cut plan validation failed: ${validation.errors.map((error) => error.code).join(", ")}`, 400);
    }
    const now = nowIso();
    db.prepare(`
      INSERT INTO studio_cut_plans (
        cut_plan_id, tenant_id, store_id, screen_group_id, campaign_project_id,
        campaign_project_revision, source_scene_ids_json, cut_plan_version, status,
        layout_template_id, scene_order_json, screen_bindings_json, copy_bindings_json,
        visual_direction_json, asset_requirements_json, brand_constraints_json,
        forbidden_elements_json, measurement_goal, expected_action, deterministic_identity_json,
        validation_status, validation_errors_json, created_by_actor_id, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?, NULL, ?, ?)
    `).run(
      cutPlanId,
      cutPlanContract.tenant_id,
      cutPlanContract.store_id,
      cutPlanContract.screen_group_id,
      cutPlanContract.campaign_project_id,
      cutPlanContract.campaign_project_revision,
      safeJsonStringify(cutPlanContract.source_scene_ids, 20000),
      cutPlanContract.cut_plan_version,
      cutPlanContract.layout_template_id,
      safeJsonStringify(cutPlanContract.scene_order, 30000),
      safeJsonStringify(cutPlanContract.screen_bindings, 30000),
      safeJsonStringify(cutPlanContract.copy_bindings, 50000),
      safeJsonStringify(cutPlanContract.visual_direction, 30000),
      safeJsonStringify(cutPlanContract.asset_requirements, 30000),
      safeJsonStringify(cutPlanContract.brand_constraints, 20000),
      safeJsonStringify(cutPlanContract.forbidden_elements, 10000),
      cutPlanContract.measurement_goal,
      cutPlanContract.expected_action,
      safeJsonStringify(cutPlanContract.deterministic_identity, 20000),
      cleanString(actor.actor_id || "admin").slice(0, 120),
      now,
      now
    );
    recordCampaignProjectEvent(projectRow.campaign_project_id, "", "cut_plan.created", "admin", actor.actor_id || "admin", {
      cut_plan_id: cutPlanId,
      cut_plan_version: cutPlanContract.cut_plan_version,
      layout_template_id: cutPlanContract.layout_template_id,
      scene_count: cutPlanContract.source_scene_ids.length,
      renderer_version: RENDERER_VERSION,
      no_external_ai: true,
      no_media_generation: true,
      no_mp4_export: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return getStudioCutPlan(cutPlanId, null, { includeLayoutTemplate: true });
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "studio_cut_plan.create", "studio_cut_plan", created.cut_plan_id, null, created, {
    tenant_id: created.tenant_id,
    store_id: created.store_id,
    screen_group_id: created.screen_group_id,
    campaign_project_id: created.campaign_project_id,
    cut_plan_version: created.cut_plan_version,
    no_external_ai: true,
    no_content_manifest_creation: true,
    no_publish: true
  }, created.created_at || nowIso());
  return created;
}

function listStudioCutPlansForProject(projectId, query = {}) {
  const projectRow = getCampaignProjectRow(projectId);
  if (!projectRow) throw requestError("Campaign project not found", 404);
  assertCampaignProjectInputScope(query, projectRow, "Campaign project");
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  const status = cleanString(query.status);
  if (status && !STUDIO_CUT_PLAN_STATUS.has(status)) {
    throw requestError(`status must be one of: ${Array.from(STUDIO_CUT_PLAN_STATUS).join(", ")}`, 400);
  }
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM studio_cut_plans
    WHERE campaign_project_id = ?
      AND (? = '' OR status = ?)
      AND (? = 1 OR status != 'deleted')
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(cleanId(projectId), status, status, includeDeleted ? 1 : 0, limit)
    .map((row) => publicStudioCutPlan(row));
}

function getStudioCutPlan(cutPlanId, scope = null, options = {}) {
  const row = getStudioCutPlanRow(cutPlanId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Studio cut plan");
  return publicStudioCutPlan(row, options);
}

function validateStudioCutPlan(cutPlanId, input = {}, actor = {}) {
  assertStudioA1InputBoundary(input);
  const result = db.transaction(() => {
    const row = getStudioCutPlanRow(cutPlanId);
    if (!row) throw requestError("Studio cut plan not found", 404);
    if (row.status === "deleted") throw requestError("Studio cut plan is deleted", 400);
    const scope = normalizeCampaignProjectScopeQuery(input);
    if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
      assertCampaignProjectInputScope(scope, row, "Studio cut plan");
    }
    const layoutTemplate = getStudioLayoutTemplate(row.layout_template_id);
    const cutPlan = publicStudioCutPlan(row);
    const validation = validateCutPlanContract(cutPlan, layoutTemplate);
    const now = nowIso();
    const nextStatus = validation.valid ? "validated" : "invalid";
    const validationStatus = validation.valid ? "passed" : "failed";
    db.prepare(`
      UPDATE studio_cut_plans SET
        status = ?,
        validation_status = ?,
        validation_errors_json = ?,
        updated_at = ?
      WHERE cut_plan_id = ?
    `).run(
      nextStatus,
      validationStatus,
      safeJsonStringify(validation.errors, 20000),
      now,
      row.cut_plan_id
    );
    recordCampaignProjectEvent(row.campaign_project_id, "", "cut_plan.validated", "admin", actor.actor_id || "admin", {
      cut_plan_id: row.cut_plan_id,
      valid: validation.valid,
      error_count: validation.errors.length,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return {
      valid: validation.valid,
      validation_errors: validation.errors,
      studio_cut_plan: getStudioCutPlan(row.cut_plan_id, null, { includeLayoutTemplate: true })
    };
  })();
  return result;
}

function softDeleteStudioCutPlan(cutPlanId, actor = {}) {
  const cutPlan = db.transaction(() => {
    const row = getStudioCutPlanRow(cutPlanId);
    if (!row) throw requestError("Studio cut plan not found", 404);
    if (row.status === "deleted") return publicStudioCutPlan(row);
    const now = nowIso();
    db.prepare(`
      UPDATE studio_cut_plans SET
        status = 'deleted',
        validation_status = 'deleted',
        deleted_at = ?,
        updated_at = ?
      WHERE cut_plan_id = ?
    `).run(now, now, row.cut_plan_id);
    recordCampaignProjectEvent(row.campaign_project_id, "", "cut_plan.deleted", "admin", actor.actor_id || "admin", {
      cut_plan_id: row.cut_plan_id,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return getStudioCutPlan(row.cut_plan_id, null, { includeRenderManifests: true });
  })();
  return cutPlan;
}

function createStudioRenderManifest(cutPlanId, input = {}, actor = {}) {
  assertStudioA1InputBoundary(input);
  const created = db.transaction(() => {
    const cutPlanRow = getStudioCutPlanRow(cutPlanId);
    if (!cutPlanRow) throw requestError("Studio cut plan not found", 404);
    if (cutPlanRow.status === "deleted") throw requestError("Studio cut plan is deleted", 400);
    const scope = normalizeCampaignProjectScopeQuery(input);
    if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
      assertCampaignProjectInputScope(scope, cutPlanRow, "Studio cut plan");
    }
    if (cutPlanRow.validation_status !== "passed" || cutPlanRow.status !== "validated") {
      throw requestError("Studio cut plan must be validated before creating a render manifest", 409);
    }
    const layoutTemplate = getStudioLayoutTemplate(cutPlanRow.layout_template_id);
    const cutPlan = publicStudioCutPlan(cutPlanRow);
    const renderManifestId = cleanId(input.render_manifest_id || input.renderManifestId) ||
      nextEntityId("srm", `${cutPlanRow.cut_plan_id}-html-preview`);
    const manifest = buildRenderManifestContract(cutPlan, layoutTemplate, {
      render_manifest_id: renderManifestId,
      output_type: cleanString(input.output_type || input.outputType || "html_preview")
    });
    const qa = runRenderQaContract(cutPlan, layoutTemplate, manifest);
    manifest.qa_status = qa.status;
    manifest.qa_errors = qa.errors;
    const now = nowIso();
    db.prepare(`
      INSERT INTO studio_render_manifests (
        render_manifest_id, tenant_id, store_id, screen_group_id, campaign_project_id,
        campaign_project_revision, cut_plan_id, cut_plan_version, layout_template_id,
        template_version, renderer, renderer_version, scene_ids_json, source_asset_ids_json,
        generated_asset_ids_json, provider_job_ids_json, output_type, output_ref, output_sha256,
        resolution_width, resolution_height, fps, duration_seconds, screen_layout, qa_status,
        qa_errors_json, render_state_json, status, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)
    `).run(
      renderManifestId,
      manifest.tenant_id,
      manifest.store_id,
      manifest.screen_group_id,
      manifest.campaign_project_id,
      manifest.campaign_project_revision,
      manifest.cut_plan_id,
      manifest.cut_plan_version,
      manifest.layout_template_id,
      manifest.template_version,
      manifest.renderer,
      manifest.renderer_version,
      safeJsonStringify(manifest.scene_ids, 30000),
      safeJsonStringify(manifest.source_asset_ids, 20000),
      safeJsonStringify(manifest.generated_asset_ids, 20000),
      safeJsonStringify(manifest.provider_job_ids, 20000),
      manifest.output_type,
      manifest.output_ref,
      manifest.output_sha256,
      manifest.resolution_width,
      manifest.resolution_height,
      manifest.fps,
      manifest.duration_seconds,
      manifest.screen_layout,
      manifest.qa_status,
      safeJsonStringify(manifest.qa_errors, 30000),
      safeJsonStringify(manifest.render_state, 50000),
      now,
      now
    );
    insertStudioRenderQaResult(renderManifestId, qa, now);
    recordCampaignProjectEvent(cutPlanRow.campaign_project_id, "", "render_manifest.created", "admin", actor.actor_id || "admin", {
      cut_plan_id: cutPlanRow.cut_plan_id,
      render_manifest_id: renderManifestId,
      output_type: manifest.output_type,
      output_sha256: manifest.output_sha256,
      qa_status: qa.status,
      no_external_ai: true,
      no_media_generation: true,
      no_mp4_export: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return getStudioRenderManifest(renderManifestId, null, { includeQaResults: true });
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "studio_render_manifest.create", "studio_render_manifest", created.render_manifest_id, null, created, {
    tenant_id: created.tenant_id,
    store_id: created.store_id,
    screen_group_id: created.screen_group_id,
    campaign_project_id: created.campaign_project_id,
    cut_plan_id: created.cut_plan_id,
    qa_status: created.qa_status,
    no_external_ai: true,
    no_content_manifest_creation: true,
    no_publish: true
  }, created.created_at || nowIso());
  return created;
}

function listStudioRenderManifestsForCutPlan(cutPlanId, query = {}) {
  const cutPlanRow = getStudioCutPlanRow(cutPlanId);
  if (!cutPlanRow) throw requestError("Studio cut plan not found", 404);
  assertCampaignProjectInputScope(query, cutPlanRow, "Studio cut plan");
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM studio_render_manifests
    WHERE cut_plan_id = ?
      AND (? = 1 OR status != 'deleted')
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(cleanId(cutPlanId), includeDeleted ? 1 : 0, limit).map(publicStudioRenderManifest);
}

function getStudioRenderManifest(renderManifestId, scope = null, options = {}) {
  const row = getStudioRenderManifestRow(renderManifestId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Studio render manifest");
  return publicStudioRenderManifest(row, options);
}

function rerunStudioRenderQa(renderManifestId, input = {}, actor = {}) {
  assertStudioA1InputBoundary(input);
  const result = db.transaction(() => {
    const manifestRow = getStudioRenderManifestRow(renderManifestId);
    if (!manifestRow) throw requestError("Studio render manifest not found", 404);
    if (manifestRow.status === "deleted") throw requestError("Studio render manifest is deleted", 400);
    const scope = normalizeCampaignProjectScopeQuery(input);
    if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
      assertCampaignProjectInputScope(scope, manifestRow, "Studio render manifest");
    }
    const cutPlanRow = getStudioCutPlanRow(manifestRow.cut_plan_id);
    if (!cutPlanRow) throw requestError("Studio cut plan not found", 404);
    const layoutTemplate = getStudioLayoutTemplate(cutPlanRow.layout_template_id);
    const cutPlan = publicStudioCutPlan(cutPlanRow);
    const manifest = publicStudioRenderManifest(manifestRow);
    const qa = runRenderQaContract(cutPlan, layoutTemplate, manifest);
    const now = nowIso();
    db.prepare(`
      UPDATE studio_render_manifests SET
        qa_status = ?,
        qa_errors_json = ?,
        updated_at = ?
      WHERE render_manifest_id = ?
    `).run(
      qa.status,
      safeJsonStringify(qa.errors, 30000),
      now,
      manifestRow.render_manifest_id
    );
    insertStudioRenderQaResult(manifestRow.render_manifest_id, qa, now);
    recordCampaignProjectEvent(manifestRow.campaign_project_id, "", "render_manifest.qa_rerun", "admin", actor.actor_id || "admin", {
      cut_plan_id: manifestRow.cut_plan_id,
      render_manifest_id: manifestRow.render_manifest_id,
      qa_status: qa.status,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return {
      qa_result: qa,
      studio_render_manifest: getStudioRenderManifest(manifestRow.render_manifest_id, null, { includeQaResults: true })
    };
  })();
  return result;
}

function softDeleteStudioRenderManifest(renderManifestId, actor = {}) {
  const manifest = db.transaction(() => {
    const row = getStudioRenderManifestRow(renderManifestId);
    if (!row) throw requestError("Studio render manifest not found", 404);
    if (row.status === "deleted") return publicStudioRenderManifest(row);
    const now = nowIso();
    db.prepare(`
      UPDATE studio_render_manifests SET
        status = 'deleted',
        qa_status = 'deleted',
        deleted_at = ?,
        updated_at = ?
      WHERE render_manifest_id = ?
    `).run(now, now, row.render_manifest_id);
    recordCampaignProjectEvent(row.campaign_project_id, "", "render_manifest.deleted", "admin", actor.actor_id || "admin", {
      cut_plan_id: row.cut_plan_id,
      render_manifest_id: row.render_manifest_id,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return getStudioRenderManifest(row.render_manifest_id, null, { includeQaResults: true });
  })();
  return manifest;
}

function insertStudioRenderQaResult(renderManifestId, qa, createdAt = nowIso()) {
  const manifestRow = getStudioRenderManifestRow(renderManifestId);
  if (!manifestRow) throw requestError("Studio render manifest not found", 404);
  const qaId = nextEntityId("srqa", `${renderManifestId}-${qa.status}`);
  db.prepare(`
    INSERT INTO studio_render_qa_results (
      render_qa_result_id, render_manifest_id, tenant_id, store_id, screen_group_id,
      campaign_project_id, cut_plan_id, qa_suite_version, status, checks_json,
      blocked_reasons_json, errors_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    qaId,
    manifestRow.render_manifest_id,
    manifestRow.tenant_id,
    manifestRow.store_id,
    manifestRow.screen_group_id,
    manifestRow.campaign_project_id,
    manifestRow.cut_plan_id,
    QA_SUITE_VERSION,
    qa.status,
    safeJsonStringify(qa.checks || [], 40000),
    safeJsonStringify(qa.blocked_reasons || [], 20000),
    safeJsonStringify(qa.errors || [], 40000),
    createdAt
  );
  return qaId;
}

function createStudioPublishPreflight(projectId, input = {}, actor = {}) {
  assertStudioC1RouteBoundary(input);
  const result = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    const scope = normalizeCampaignProjectScopeQuery(input);
    if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
      assertCampaignProjectInputScope(scope, projectRow, "Campaign project");
    }
    const renderManifestId = cleanId(input.render_manifest_id || input.renderManifestId);
    if (!renderManifestId) throw requestError("render_manifest_id is required", 400);
    const manifestRow = getStudioRenderManifestRow(renderManifestId);
    if (!manifestRow || manifestRow.status === "deleted") throw requestError("Studio render manifest not found", 404);
    collectScopeMismatchErrorsOrThrow(projectRow, manifestRow, "Studio render manifest");
    if (cleanId(manifestRow.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
      throw requestError("Studio render manifest is outside campaign project scope", 403);
    }
    const publishPreflightId = cleanId(input.publish_preflight_id || input.publishPreflightId) ||
      nextEntityId("sppf", `${projectRow.store_id}-${projectRow.screen_group_id}`);
    const now = nowIso();
    const scenes = listCampaignProjectScenes(projectRow.campaign_project_id);
    const project = publicCampaignProject(projectRow);
    const renderManifest = publicStudioRenderManifest(manifestRow);
    const provenance = listAssetProvenance({
      tenant_id: projectRow.tenant_id,
      store_id: projectRow.store_id,
      screen_group_id: projectRow.screen_group_id,
      campaign_project_id: projectRow.campaign_project_id
    });
    const preflight = buildPublishPreflightContract({
      project,
      scenes,
      renderManifest,
      assetProvenance: provenance,
      input: {
        ...input,
        publish_preflight_id: publishPreflightId,
        created_by_actor_id: actor.actor_id || "admin"
      }
    });
    assertValidPublishPreflightContract(preflight);
    db.prepare(`
      INSERT INTO studio_publish_preflight_results (
        publish_preflight_id, tenant_id, store_id, screen_group_id, campaign_project_id,
        campaign_project_revision, render_manifest_id, render_manifest_output_sha256,
        required_asset_ids_json, content_type, publish_mode, status, checks_json, blocked_reasons_json,
        docs99_gate_ref, docs99_gate_verdict, approval_gate_ref, request_reason,
        created_by_actor_id, no_active_content_manifest_mutation,
        no_content_manifest_activation, no_publish, no_player_device_mutation,
        no_schedule_activation, dry_run_only, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, ?)
    `).run(
      preflight.publish_preflight_id,
      preflight.tenant_id,
      preflight.store_id,
      preflight.screen_group_id,
      preflight.campaign_project_id,
      preflight.campaign_project_revision,
      preflight.render_manifest_id,
      preflight.render_manifest_output_sha256,
      safeJsonStringify(preflight.required_asset_ids || [], 20000),
      preflight.content_type,
      preflight.publish_mode,
      preflight.status,
      safeJsonStringify(preflight.checks, 50000),
      safeJsonStringify(preflight.blocked_reasons, 20000),
      preflight.docs99_gate_ref,
      preflight.docs99_gate_verdict,
      preflight.approval_gate_ref,
      preflight.request_reason,
      preflight.created_by_actor_id,
      now
    );
    const transformId = nextEntityId("cmdt", preflight.publish_preflight_id);
    const draftContentManifestId = nextEntityId("cmdraft", preflight.publish_preflight_id);
    const transform = buildContentManifestDraftTransform(preflight, {
      project,
      scenes,
      renderManifest,
      draft_transform_id: transformId,
      draft_content_manifest_id: draftContentManifestId
    });
    db.prepare(`
      INSERT INTO content_manifest_draft_transforms (
        draft_transform_id, publish_preflight_id, tenant_id, store_id, screen_group_id,
        campaign_project_id, campaign_project_revision, render_manifest_id,
        draft_content_manifest_id, status, transform_errors_json,
        playlist_item_draft_ids_json, schedule_draft_ids_json, qr_link_ids_json,
        content_manifest_draft_json, content_manifest_draft_sha256,
        no_active_content_manifest_mutation, no_content_manifest_activation,
        no_publish, no_player_device_mutation, no_schedule_activation,
        created_by_actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, ?, ?)
    `).run(
      transform.draft_transform_id,
      transform.publish_preflight_id,
      transform.tenant_id,
      transform.store_id,
      transform.screen_group_id,
      transform.campaign_project_id,
      transform.campaign_project_revision,
      transform.render_manifest_id,
      transform.draft_content_manifest_id,
      transform.status,
      safeJsonStringify(transform.transform_errors, 20000),
      safeJsonStringify(transform.playlist_item_draft_ids, 20000),
      safeJsonStringify(transform.schedule_draft_ids, 10000),
      safeJsonStringify(transform.qr_link_ids, 10000),
      safeJsonStringify(transform.content_manifest_draft || {}, 80000),
      transform.content_manifest_draft_sha256,
      preflight.created_by_actor_id,
      now
    );
    recordCampaignProjectEvent(projectRow.campaign_project_id, "", "publish_preflight.created", "admin", actor.actor_id || "admin", {
      publish_preflight_id: preflight.publish_preflight_id,
      draft_transform_id: transform.draft_transform_id,
      render_manifest_id: preflight.render_manifest_id,
      status: preflight.status,
      blocked_reasons: preflight.blocked_reasons,
      content_type: preflight.content_type,
      publish_mode: preflight.publish_mode,
      docs99_gate_verdict: preflight.docs99_gate_verdict,
      no_active_content_manifest_mutation: true,
      no_content_manifest_activation: true,
      no_publish: true,
      no_player_device_mutation: true,
      no_schedule_activation: true
    }, now);
    return {
      studio_publish_preflight: getStudioPublishPreflight(preflight.publish_preflight_id, null, { includeDraftTransform: true }),
      content_manifest_draft_transform: getContentManifestDraftTransform(transform.draft_transform_id)
    };
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "studio_publish_preflight.create", "studio_publish_preflight", result.studio_publish_preflight.publish_preflight_id, null, result.studio_publish_preflight, {
    tenant_id: result.studio_publish_preflight.tenant_id,
    store_id: result.studio_publish_preflight.store_id,
    screen_group_id: result.studio_publish_preflight.screen_group_id,
    campaign_project_id: result.studio_publish_preflight.campaign_project_id,
    render_manifest_id: result.studio_publish_preflight.render_manifest_id,
    status: result.studio_publish_preflight.status,
    no_active_content_manifest_mutation: true,
    no_content_manifest_activation: true,
    no_publish: true,
    no_player_device_mutation: true,
    no_schedule_activation: true
  }, result.studio_publish_preflight.created_at || nowIso());
  return result;
}

function listStudioPublishPreflightsForProject(projectId, query = {}) {
  const projectRow = getCampaignProjectRow(projectId);
  if (!projectRow) throw requestError("Campaign project not found", 404);
  assertCampaignProjectInputScope(query, projectRow, "Campaign project");
  const status = cleanString(query.status);
  if (status && !PUBLISH_PREFLIGHT_STATUSES.includes(status)) {
    throw requestError(`status must be one of: ${PUBLISH_PREFLIGHT_STATUSES.join(", ")}`, 400);
  }
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM studio_publish_preflight_results
    WHERE campaign_project_id = ?
      AND (? = '' OR status = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(cleanId(projectId), status, status, limit).map(publicStudioPublishPreflight);
}

function getStudioPublishPreflight(preflightId, scope = null, options = {}) {
  const row = getStudioPublishPreflightRow(preflightId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Studio publish preflight");
  return publicStudioPublishPreflight(row, options);
}

function getContentManifestDraftTransform(transformId, scope = null) {
  const row = getContentManifestDraftTransformRow(transformId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Content manifest draft transform");
  return publicContentManifestDraftTransform(row);
}

function assertStudioC1RouteBoundary(input = {}) {
  try {
    assertStudioC1InputBoundary(input);
  } catch (error) {
    throw requestError(error.message || "Studio Execution C1 input is out of scope", 400);
  }
}

function assertValidPublishPreflightContract(preflight) {
  const validation = validatePublishPreflightContract(preflight);
  if (!validation.valid) {
    throw requestError(`publish preflight contract is invalid: ${validation.errors.map((error) => `${error.field}:${error.code}`).join(", ")}`, 400);
  }
}

function getStudioPublishPreflightRow(preflightId) {
  return db.prepare("SELECT * FROM studio_publish_preflight_results WHERE publish_preflight_id = ?").get(cleanId(preflightId));
}

function getContentManifestDraftTransformRow(transformId) {
  return db.prepare("SELECT * FROM content_manifest_draft_transforms WHERE draft_transform_id = ?").get(cleanId(transformId));
}

function getContentManifestDraftTransformRowForPreflight(preflightId) {
  return db.prepare(`
    SELECT * FROM content_manifest_draft_transforms
    WHERE publish_preflight_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(cleanId(preflightId));
}

function listStudioGenerationProviders() {
  return db.prepare(`
    SELECT * FROM studio_generation_providers
    WHERE status = 'active'
    ORDER BY provider_id ASC
  `).all().map(publicStudioGenerationProvider);
}

function createAiGenerationJob(input = {}, actor = {}) {
  assertStudioB1RouteBoundary(input);
  const result = db.transaction(() => {
    const scope = resolveStudioB1Scope(input);
    const sceneId = cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId);
    if (sceneId) assertStudioB1SceneScope(sceneId, scope.projectRow);
    const jobId = cleanId(input.ai_generation_job_id || input.aiGenerationJobId) ||
      nextEntityId("aigj", `${scope.store_id}-${scope.screen_group_id}`);
    const contract = buildGenerationJobContract(input, {
      ai_generation_job_id: jobId,
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      screen_group_id: scope.screen_group_id,
      campaign_project_id: scope.campaign_project_id,
      campaign_project_revision: scope.campaign_project_revision,
      campaign_project_scene_id: sceneId,
      actor_type: "admin",
      actor_id: actor.actor_id || "admin"
    });
    assertValidGenerationJobContract(contract);
    const existing = db.prepare(`
      SELECT * FROM ai_generation_jobs
      WHERE tenant_id = ?
        AND idempotency_key = ?
      LIMIT 1
    `).get(contract.tenant_id, contract.idempotency_key);
    if (existing) {
      if (existing.input_sha256 !== contract.input_sha256) {
        throw requestError("idempotency_key already exists for different generation input", 409);
      }
      return {
        ai_generation_job: publicAiGenerationJob(existing, { includeProvenance: true }),
        idempotency_reused: true
      };
    }
    const now = nowIso();
    db.prepare(`
      INSERT INTO ai_generation_jobs (
        ai_generation_job_id, tenant_id, store_id, screen_group_id, campaign_project_id,
        campaign_project_revision, campaign_project_scene_id, requested_asset_role,
        provider_id, provider_model, capability, input_snapshot_json, input_sha256,
        prompt_hash, reference_asset_ids_json, idempotency_key, status, error_class,
        error_message, provider_job_id, output_asset_id, cost_estimate_units,
        cost_actual_units, actor_type, actor_id, retry_count, max_retries,
        no_external_provider_call, no_paid_provider_call, no_mcp_runtime_dependency,
        no_secret_material, no_credit_consumption, no_content_manifest_creation,
        no_publish, deleted_at, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '', '', '', ?, 0, NULL, ?, ?, 0, ?, 1, 1, 1, 1, 1, 1, 1, NULL, ?, NULL, NULL, ?)
    `).run(
      contract.ai_generation_job_id,
      contract.tenant_id,
      contract.store_id,
      contract.screen_group_id,
      contract.campaign_project_id,
      contract.campaign_project_revision,
      contract.campaign_project_scene_id,
      contract.requested_asset_role,
      contract.provider_id,
      contract.provider_model,
      contract.capability,
      safeJsonStringify(contract.input_snapshot, 30000),
      contract.input_sha256,
      contract.prompt_hash,
      safeJsonStringify(contract.reference_asset_ids, 20000),
      contract.idempotency_key,
      contract.output_asset_id,
      contract.actor_type,
      contract.actor_id,
      contract.max_retries,
      now,
      now
    );
    if (scope.campaign_project_id) {
      recordCampaignProjectEvent(scope.campaign_project_id, sceneId, "ai_generation_job.created", "admin", actor.actor_id || "admin", {
        ai_generation_job_id: contract.ai_generation_job_id,
        provider_id: contract.provider_id,
        capability: contract.capability,
        requested_asset_role: contract.requested_asset_role,
        no_external_provider_call: true,
        no_secret_material: true,
        no_credit_consumption: true,
        no_content_manifest_creation: true,
        no_publish: true
      }, now);
    }
    return {
      ai_generation_job: getAiGenerationJob(contract.ai_generation_job_id, null, { includeProvenance: true }),
      idempotency_reused: false
    };
  })();
  recordAuditLog("admin", actor.actor_id || "admin", "ai_generation_job.create", "ai_generation_job", result.ai_generation_job.ai_generation_job_id, null, result.ai_generation_job, {
    tenant_id: result.ai_generation_job.tenant_id,
    store_id: result.ai_generation_job.store_id,
    screen_group_id: result.ai_generation_job.screen_group_id,
    provider_id: result.ai_generation_job.provider_id,
    no_external_provider_call: true,
    no_credit_consumption: true,
    no_content_manifest_creation: true,
    no_publish: true
  }, result.ai_generation_job.created_at || nowIso());
  return result;
}

function listAiGenerationJobs(query = {}) {
  const scope = normalizeCampaignProjectScopeQuery(query);
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  const status = cleanString(query.status);
  if (status && !GENERATION_JOB_STATUSES.includes(status)) {
    throw requestError(`status must be one of: ${GENERATION_JOB_STATUSES.join(", ")}`, 400);
  }
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM ai_generation_jobs
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR screen_group_id = ?)
      AND (? = '' OR campaign_project_id = ?)
      AND (? = '' OR campaign_project_scene_id = ?)
      AND (? = '' OR status = ?)
      AND (? = 1 OR deleted_at IS NULL)
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(
    scope.tenant_id, scope.tenant_id,
    scope.store_id, scope.store_id,
    scope.screen_group_id, scope.screen_group_id,
    cleanId(query.campaign_project_id || query.campaignProjectId), cleanId(query.campaign_project_id || query.campaignProjectId),
    cleanId(query.campaign_project_scene_id || query.campaignProjectSceneId), cleanId(query.campaign_project_scene_id || query.campaignProjectSceneId),
    status, status,
    includeDeleted ? 1 : 0,
    limit
  ).map((row) => publicAiGenerationJob(row));
}

function getAiGenerationJob(jobId, scope = null, options = {}) {
  const row = getAiGenerationJobRow(jobId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "AI generation job");
  return publicAiGenerationJob(row, options);
}

function startAiGenerationJob(jobId, input = {}, actor = {}) {
  assertStudioB1RouteBoundary(input);
  return db.transaction(() => {
    const row = getAiGenerationJobRow(jobId);
    if (!row || row.deleted_at) throw requestError("AI generation job not found", 404);
    assertCampaignProjectInputScope(input, row, "AI generation job");
    const transition = normalizeStudioB1JobTransition(row.status, { status: "running" });
    const now = nowIso();
    db.prepare(`
      UPDATE ai_generation_jobs SET
        status = ?,
        error_class = '',
        error_message = '',
        started_at = COALESCE(started_at, ?),
        updated_at = ?
      WHERE ai_generation_job_id = ?
    `).run(transition.status, now, now, row.ai_generation_job_id);
    recordStudioB1Event(row, "ai_generation_job.started", actor, { status: transition.status }, now);
    return getAiGenerationJob(row.ai_generation_job_id, null, { includeProvenance: true });
  })();
}

function completeAiGenerationJob(jobId, input = {}, actor = {}) {
  assertStudioB1RouteBoundary(input);
  const result = db.transaction(() => {
    const row = getAiGenerationJobRow(jobId);
    if (!row || row.deleted_at) throw requestError("AI generation job not found", 404);
    assertCampaignProjectInputScope(input, row, "AI generation job");
    const outputAssetId = cleanId(input.output_asset_id || input.outputAssetId);
    if (!outputAssetId) throw requestError("output_asset_id is required", 400);
    const providerJobId = cleanId(input.provider_job_id || input.providerJobId) || `mock:${row.ai_generation_job_id}`;
    const transition = normalizeStudioB1JobTransition(row.status, {
      status: "asset_review_required",
      provider_job_id: providerJobId,
      output_asset_id: outputAssetId
    });
    const now = nowIso();
    db.prepare(`
      UPDATE ai_generation_jobs SET
        status = ?,
        error_class = '',
        error_message = '',
        provider_job_id = ?,
        output_asset_id = ?,
        cost_actual_units = 0,
        completed_at = ?,
        updated_at = ?
      WHERE ai_generation_job_id = ?
    `).run(
      transition.status,
      transition.provider_job_id,
      transition.output_asset_id,
      now,
      now,
      row.ai_generation_job_id
    );
    const updated = getAiGenerationJobRow(row.ai_generation_job_id);
    const provenance = ensureAssetProvenanceForCompletedJob(updated, input, actor, now);
    recordStudioB1Event(updated, "ai_generation_job.completed", actor, {
      status: transition.status,
      output_asset_id: outputAssetId,
      asset_provenance_id: provenance.asset_provenance_id,
      provider_id: updated.provider_id,
      no_external_provider_call: true,
      no_credit_consumption: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return {
      ai_generation_job: getAiGenerationJob(row.ai_generation_job_id, null, { includeProvenance: true }),
      asset_provenance: provenance
    };
  })();
  return result;
}

function failAiGenerationJob(jobId, input = {}, actor = {}) {
  assertStudioB1RouteBoundary(input);
  return db.transaction(() => {
    const row = getAiGenerationJobRow(jobId);
    if (!row || row.deleted_at) throw requestError("AI generation job not found", 404);
    assertCampaignProjectInputScope(input, row, "AI generation job");
    const nextStatus = cleanString(input.status || input.next_status || input.nextStatus || "failed");
    const errorClass = cleanString(input.error_class || input.errorClass || (nextStatus === "timeout" ? "timeout" : "unknown_provider_error"));
    const transition = normalizeStudioB1JobTransition(row.status, {
      status: nextStatus,
      error_class: errorClass,
      error_message: cleanString(input.error_message || input.errorMessage || "manual failure recorded"),
      retry_increment: true
    });
    const retryCount = Math.min((asInteger(row.retry_count) || 0) + 1, asInteger(row.max_retries) || 0);
    const now = nowIso();
    db.prepare(`
      UPDATE ai_generation_jobs SET
        status = ?,
        error_class = ?,
        error_message = ?,
        retry_count = ?,
        completed_at = CASE WHEN ? IN ('failed_terminal') THEN ? ELSE completed_at END,
        updated_at = ?
      WHERE ai_generation_job_id = ?
    `).run(
      transition.status,
      transition.error_class,
      transition.error_message,
      retryCount,
      transition.status,
      now,
      now,
      row.ai_generation_job_id
    );
    const updated = getAiGenerationJobRow(row.ai_generation_job_id);
    recordStudioB1Event(updated, "ai_generation_job.failed", actor, {
      status: updated.status,
      error_class: updated.error_class,
      retry_count: updated.retry_count,
      no_external_provider_call: true,
      no_credit_consumption: true
    }, now);
    return publicAiGenerationJob(updated, { includeProvenance: true });
  })();
}

function softDeleteAiGenerationJob(jobId, actor = {}) {
  return db.transaction(() => {
    const row = getAiGenerationJobRow(jobId);
    if (!row || row.deleted_at) throw requestError("AI generation job not found", 404);
    const now = nowIso();
    db.prepare(`
      UPDATE ai_generation_jobs SET
        deleted_at = ?,
        updated_at = ?
      WHERE ai_generation_job_id = ?
    `).run(now, now, row.ai_generation_job_id);
    const updated = getAiGenerationJobRow(row.ai_generation_job_id);
    recordStudioB1Event(updated, "ai_generation_job.deleted", actor, { deleted_at: now }, now);
    return publicAiGenerationJob(updated, { includeProvenance: true });
  })();
}

function createAssetProvenance(input = {}, actor = {}) {
  assertStudioB1RouteBoundary(input);
  const provenance = db.transaction(() => {
    const scope = resolveStudioB1Scope(input);
    const existing = getAssetProvenanceRowByAsset(cleanId(input.asset_id || input.assetId));
    if (existing && !existing.deleted_at) throw requestError("asset_id already has provenance", 409);
    const contract = buildAssetProvenanceContract(input, {
      asset_provenance_id: cleanId(input.asset_provenance_id || input.assetProvenanceId) ||
        nextEntityId("apv", `${scope.store_id}-${scope.screen_group_id}`),
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      screen_group_id: scope.screen_group_id,
      campaign_project_id: scope.campaign_project_id,
      created_by_actor_type: "admin",
      created_by_actor_id: actor.actor_id || "admin"
    });
    assertValidAssetProvenanceContract(contract);
    insertAssetProvenanceContract(contract, nowIso());
    return getAssetProvenance(contract.asset_provenance_id);
  })();
  return provenance;
}

function listAssetProvenance(query = {}) {
  const scope = normalizeCampaignProjectScopeQuery(query);
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  const rightsStatus = cleanString(query.rights_review_status || query.rightsReviewStatus);
  if (rightsStatus && !RIGHTS_REVIEW_STATUSES.includes(rightsStatus)) {
    throw requestError(`rights_review_status must be one of: ${RIGHTS_REVIEW_STATUSES.join(", ")}`, 400);
  }
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 200));
  return db.prepare(`
    SELECT * FROM asset_provenance
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR screen_group_id = ?)
      AND (? = '' OR campaign_project_id = ?)
      AND (? = '' OR ai_generation_job_id = ?)
      AND (? = '' OR rights_review_status = ?)
      AND (? = 1 OR deleted_at IS NULL)
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(
    scope.tenant_id, scope.tenant_id,
    scope.store_id, scope.store_id,
    scope.screen_group_id, scope.screen_group_id,
    cleanId(query.campaign_project_id || query.campaignProjectId), cleanId(query.campaign_project_id || query.campaignProjectId),
    cleanId(query.ai_generation_job_id || query.aiGenerationJobId), cleanId(query.ai_generation_job_id || query.aiGenerationJobId),
    rightsStatus, rightsStatus,
    includeDeleted ? 1 : 0,
    limit
  ).map(publicAssetProvenance);
}

function getAssetProvenance(provenanceId, scope = null) {
  const row = getAssetProvenanceRow(provenanceId);
  if (!row) return null;
  if (scope) assertCampaignProjectInputScope(scope, row, "Asset provenance");
  return publicAssetProvenance(row);
}

function updateAssetProvenance(provenanceId, input = {}, actor = {}) {
  assertStudioB1RouteBoundary(input);
  return db.transaction(() => {
    const row = getAssetProvenanceRow(provenanceId);
    if (!row || row.deleted_at) throw requestError("Asset provenance not found", 404);
    assertCampaignProjectInputScope(input, row, "Asset provenance");
    const patch = {
      ...publicAssetProvenance(row),
      license_status: cleanString(input.license_status || input.licenseStatus || row.license_status),
      commercial_use_allowed: normalizeOptionalBoolean(input.commercial_use_allowed ?? input.commercialUseAllowed, row.commercial_use_allowed === 1),
      rights_review_status: cleanString(input.rights_review_status || input.rightsReviewStatus || row.rights_review_status),
      reviewed_by_actor_id: cleanId(input.reviewed_by_actor_id || input.reviewedByActorId || actor.actor_id || row.reviewed_by_actor_id),
      review_notes: cleanString(input.review_notes || input.reviewNotes || row.review_notes).slice(0, 2000)
    };
    const wantsPublishCandidate = input.publish_candidate_allowed !== undefined || input.publishCandidateAllowed !== undefined
      ? normalizeBooleanFlag(input.publish_candidate_allowed ?? input.publishCandidateAllowed)
      : row.publish_candidate_allowed === 1;
    patch.publish_candidate_allowed = wantsPublishCandidate;
    assertValidAssetProvenanceContract(patch);
    const now = nowIso();
    db.prepare(`
      UPDATE asset_provenance SET
        license_status = ?,
        commercial_use_allowed = ?,
        rights_review_status = ?,
        reviewed_by_actor_id = ?,
        review_notes = ?,
        publish_candidate_allowed = ?,
        updated_at = ?
      WHERE asset_provenance_id = ?
    `).run(
      patch.license_status,
      patch.commercial_use_allowed ? 1 : 0,
      patch.rights_review_status,
      patch.reviewed_by_actor_id,
      patch.review_notes,
      patch.publish_candidate_allowed ? 1 : 0,
      now,
      row.asset_provenance_id
    );
    const updated = getAssetProvenanceRow(row.asset_provenance_id);
    let linkedJob = null;
    if (updated.ai_generation_job_id && updated.rights_review_status === "approved" && updated.publish_candidate_allowed === 1) {
      db.prepare(`
        UPDATE ai_generation_jobs SET
          status = CASE WHEN status = 'asset_review_required' THEN 'succeeded' ELSE status END,
          updated_at = ?
        WHERE ai_generation_job_id = ?
      `).run(now, updated.ai_generation_job_id);
      linkedJob = getAiGenerationJob(updated.ai_generation_job_id, null, { includeProvenance: true });
    }
    if (updated.campaign_project_id) {
      recordCampaignProjectEvent(updated.campaign_project_id, "", "asset_provenance.updated", "admin", actor.actor_id || "admin", {
        asset_provenance_id: updated.asset_provenance_id,
        asset_id: updated.asset_id,
        rights_review_status: updated.rights_review_status,
        publish_candidate_allowed: updated.publish_candidate_allowed === 1,
        no_content_manifest_creation: true,
        no_publish: true
      }, now);
    }
    return {
      asset_provenance: publicAssetProvenance(updated),
      ai_generation_job: linkedJob
    };
  })();
}

function softDeleteAssetProvenance(provenanceId, actor = {}) {
  return db.transaction(() => {
    const row = getAssetProvenanceRow(provenanceId);
    if (!row || row.deleted_at) throw requestError("Asset provenance not found", 404);
    const now = nowIso();
    db.prepare(`
      UPDATE asset_provenance SET
        deleted_at = ?,
        updated_at = ?
      WHERE asset_provenance_id = ?
    `).run(now, now, row.asset_provenance_id);
    const updated = getAssetProvenanceRow(row.asset_provenance_id);
    if (updated.campaign_project_id) {
      recordCampaignProjectEvent(updated.campaign_project_id, "", "asset_provenance.deleted", "admin", actor.actor_id || "admin", {
        asset_provenance_id: updated.asset_provenance_id,
        asset_id: updated.asset_id
      }, now);
    }
    return publicAssetProvenance(updated);
  })();
}

function ensureAssetProvenanceForCompletedJob(jobRow, input = {}, actor = {}, createdAt = nowIso()) {
  const existing = getAssetProvenanceRowByAsset(jobRow.output_asset_id);
  if (existing && !existing.deleted_at) return publicAssetProvenance(existing);
  const sourceType = jobRow.provider_id === "manual_upload" ? "manual_upload" : "mock_fixture";
  const contract = buildAssetProvenanceContract(input, {
    asset_provenance_id: nextEntityId("apv", jobRow.output_asset_id),
    asset_id: jobRow.output_asset_id,
    tenant_id: jobRow.tenant_id,
    store_id: jobRow.store_id,
    screen_group_id: jobRow.screen_group_id,
    campaign_project_id: jobRow.campaign_project_id,
    ai_generation_job_id: jobRow.ai_generation_job_id,
    source_type: sourceType,
    generated_by_provider: jobRow.provider_id,
    provider_model: jobRow.provider_model,
    provider_job_id: jobRow.provider_job_id,
    prompt_hash: jobRow.prompt_hash,
    reference_asset_ids: parseJson(jobRow.reference_asset_ids_json || "[]", []),
    created_by_actor_type: "admin",
    created_by_actor_id: actor.actor_id || "admin",
    commercial_use_allowed: false
  });
  assertValidAssetProvenanceContract(contract);
  insertAssetProvenanceContract(contract, createdAt);
  return getAssetProvenance(contract.asset_provenance_id);
}

function insertAssetProvenanceContract(contract, createdAt = nowIso()) {
  db.prepare(`
    INSERT INTO asset_provenance (
      asset_provenance_id, asset_id, tenant_id, store_id, screen_group_id,
      campaign_project_id, ai_generation_job_id, source_type, license_status,
      commercial_use_allowed, rights_review_status, generated_by_provider,
      provider_model, provider_job_id, prompt_hash, reference_asset_ids_json,
      source_asset_ids_json, created_by_actor_type, created_by_actor_id,
      reviewed_by_actor_id, review_notes, publish_candidate_allowed,
      no_external_provider_call, no_secret_material, no_credit_consumption,
      no_content_manifest_creation, no_publish, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, NULL, ?, ?)
  `).run(
    contract.asset_provenance_id,
    contract.asset_id,
    contract.tenant_id,
    contract.store_id,
    contract.screen_group_id,
    contract.campaign_project_id,
    contract.ai_generation_job_id,
    contract.source_type,
    contract.license_status,
    contract.commercial_use_allowed ? 1 : 0,
    contract.rights_review_status,
    contract.generated_by_provider,
    contract.provider_model,
    contract.provider_job_id,
    contract.prompt_hash,
    safeJsonStringify(contract.reference_asset_ids, 20000),
    safeJsonStringify(contract.source_asset_ids, 20000),
    contract.created_by_actor_type,
    contract.created_by_actor_id,
    contract.reviewed_by_actor_id,
    contract.review_notes,
    contract.publish_candidate_allowed ? 1 : 0,
    createdAt,
    createdAt
  );
}

function resolveStudioB1Scope(input = {}) {
  const projectId = cleanId(input.campaign_project_id || input.campaignProjectId);
  if (projectId) {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow || projectRow.status === "deleted") throw requestError("Campaign project not found", 404);
    assertCampaignProjectInputScope(input, projectRow, "Campaign project");
    return {
      tenant_id: cleanId(projectRow.tenant_id),
      store_id: cleanId(projectRow.store_id),
      screen_group_id: cleanId(projectRow.screen_group_id),
      campaign_project_id: cleanId(projectRow.campaign_project_id),
      campaign_project_revision: 1,
      projectRow
    };
  }
  const scope = normalizeCampaignScope(input, { requireStore: true, requireScreenGroup: true });
  return {
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    screen_group_id: scope.screen_group_id,
    campaign_project_id: "",
    campaign_project_revision: 0,
    projectRow: null
  };
}

function assertStudioB1SceneScope(sceneId, projectRow) {
  const scene = getCampaignProjectSceneRow(sceneId);
  if (!scene || scene.status === "deleted") throw requestError("Campaign project scene not found", 404);
  if (!projectRow || cleanId(scene.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
    throw requestError("Campaign project scene is outside project scope", 403);
  }
  collectScopeMismatchErrorsOrThrow(projectRow, scene, "Campaign project scene");
}

function collectScopeMismatchErrorsOrThrow(projectRow, source, sourceName) {
  for (const field of ["tenant_id", "store_id", "screen_group_id"]) {
    if (cleanId(projectRow[field]) !== cleanId(source[field])) {
      throw requestError(`${sourceName} is outside ${field.replace("_id", "")} scope`, 403);
    }
  }
}

function assertStudioB1RouteBoundary(input = {}) {
  try {
    assertStudioB1InputBoundary(input);
  } catch (error) {
    throw requestError(error.message || "Studio Execution B1 input is out of scope", 400);
  }
}

function assertValidGenerationJobContract(contract) {
  const validation = validateGenerationJobContract(contract);
  if (!validation.valid) {
    throw requestError(`generation job contract is invalid: ${validation.errors.map((error) => error.code).join(", ")}`, 400);
  }
}

function assertValidAssetProvenanceContract(contract) {
  const validation = validateAssetProvenanceContract(contract);
  if (!validation.valid) {
    throw requestError(`asset provenance contract is invalid: ${validation.errors.map((error) => `${error.field}:${error.code}`).join(", ")}`, 400);
  }
}

function normalizeStudioB1JobTransition(status, input) {
  try {
    return normalizeJobTransition(status, input);
  } catch (error) {
    throw requestError(error.message || "generation job transition is invalid", 400);
  }
}

function recordStudioB1Event(jobRow, action, actor = {}, metadata = {}, createdAt = nowIso()) {
  if (jobRow.campaign_project_id) {
    recordCampaignProjectEvent(jobRow.campaign_project_id, jobRow.campaign_project_scene_id || "", action, "admin", actor.actor_id || "admin", {
      ai_generation_job_id: jobRow.ai_generation_job_id,
      ...metadata,
      no_external_provider_call: true,
      no_secret_material: true,
      no_credit_consumption: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, createdAt);
  }
}

function getAiGenerationJobRow(jobId) {
  return db.prepare("SELECT * FROM ai_generation_jobs WHERE ai_generation_job_id = ?").get(cleanId(jobId));
}

function getAssetProvenanceRow(provenanceId) {
  return db.prepare("SELECT * FROM asset_provenance WHERE asset_provenance_id = ?").get(cleanId(provenanceId));
}

function getAssetProvenanceRowByAsset(assetId) {
  return db.prepare("SELECT * FROM asset_provenance WHERE asset_id = ?").get(cleanId(assetId));
}

function listAssetProvenanceForJob(jobId) {
  return db.prepare(`
    SELECT * FROM asset_provenance
    WHERE ai_generation_job_id = ?
      AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).all(cleanId(jobId)).map(publicAssetProvenance);
}

function publicStudioGenerationProvider(row) {
  return {
    schema_version: "studio-generation-provider/b1",
    provider_id: cleanId(row.provider_id),
    provider_type: cleanString(row.provider_type),
    display_name: cleanString(row.display_name),
    capabilities: parseJson(row.capabilities_json || "[]", []),
    external_network_allowed: row.external_network_allowed === 1,
    secrets_required: row.secrets_required === 1,
    mcp_runtime_dependency: row.mcp_runtime_dependency === 1,
    status: cleanString(row.status),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    no_external_provider_call: true,
    no_paid_provider_call: true,
    no_mcp_runtime_dependency: true,
    no_secret_material: true,
    no_credit_consumption: true
  };
}

function publicAiGenerationJob(row, options = {}) {
  const job = {
    schema_version: "studio-generation-job/b1",
    provider_contract_version: PROVIDER_CONTRACT_VERSION,
    ai_generation_job_id: cleanId(row.ai_generation_job_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 0,
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    requested_asset_role: cleanString(row.requested_asset_role),
    provider_id: cleanString(row.provider_id),
    provider_model: cleanString(row.provider_model),
    capability: cleanString(row.capability),
    input_snapshot: parseJson(row.input_snapshot_json || "{}", {}),
    input_sha256: cleanString(row.input_sha256),
    prompt_hash: cleanString(row.prompt_hash),
    reference_asset_ids: parseJson(row.reference_asset_ids_json || "[]", []),
    idempotency_key: cleanString(row.idempotency_key),
    status: cleanString(row.status),
    error_class: cleanString(row.error_class),
    error_message: cleanString(row.error_message),
    provider_job_id: cleanString(row.provider_job_id),
    output_asset_id: cleanId(row.output_asset_id),
    cost_estimate_units: asInteger(row.cost_estimate_units) || 0,
    cost_actual_units: asInteger(row.cost_actual_units),
    actor_type: cleanString(row.actor_type),
    actor_id: cleanId(row.actor_id),
    retry_count: asInteger(row.retry_count) || 0,
    max_retries: asInteger(row.max_retries) || 0,
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    started_at: cleanString(row.started_at),
    completed_at: cleanString(row.completed_at),
    updated_at: cleanString(row.updated_at),
    no_external_provider_call: row.no_external_provider_call === 1,
    no_paid_provider_call: row.no_paid_provider_call === 1,
    no_mcp_runtime_dependency: row.no_mcp_runtime_dependency === 1,
    no_secret_material: row.no_secret_material === 1,
    no_credit_consumption: row.no_credit_consumption === 1,
    no_content_manifest_creation: row.no_content_manifest_creation === 1,
    no_publish: row.no_publish === 1
  };
  if (options.includeProvenance) {
    job.asset_provenance = listAssetProvenanceForJob(job.ai_generation_job_id);
  }
  return job;
}

function publicAssetProvenance(row) {
  return {
    schema_version: "studio-asset-provenance/b1",
    asset_provenance_id: cleanId(row.asset_provenance_id),
    asset_id: cleanId(row.asset_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    ai_generation_job_id: cleanId(row.ai_generation_job_id),
    source_type: cleanString(row.source_type),
    license_status: cleanString(row.license_status),
    commercial_use_allowed: row.commercial_use_allowed === 1 || row.commercial_use_allowed === true,
    rights_review_status: cleanString(row.rights_review_status),
    generated_by_provider: cleanString(row.generated_by_provider),
    provider_model: cleanString(row.provider_model),
    provider_job_id: cleanString(row.provider_job_id),
    prompt_hash: cleanString(row.prompt_hash),
    reference_asset_ids: parseJson(row.reference_asset_ids_json || "[]", []),
    source_asset_ids: parseJson(row.source_asset_ids_json || "[]", []),
    created_by_actor_type: cleanString(row.created_by_actor_type),
    created_by_actor_id: cleanId(row.created_by_actor_id),
    reviewed_by_actor_id: cleanId(row.reviewed_by_actor_id),
    review_notes: cleanString(row.review_notes),
    publish_candidate_allowed: row.publish_candidate_allowed === 1 || row.publish_candidate_allowed === true,
    can_enter_publish_candidate: canAssetEnterPublishCandidate({
      source_type: cleanString(row.source_type),
      license_status: cleanString(row.license_status),
      commercial_use_allowed: row.commercial_use_allowed === 1 || row.commercial_use_allowed === true,
      rights_review_status: cleanString(row.rights_review_status)
    }),
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    no_external_provider_call: row.no_external_provider_call === 1,
    no_secret_material: row.no_secret_material === 1,
    no_credit_consumption: row.no_credit_consumption === 1,
    no_content_manifest_creation: row.no_content_manifest_creation === 1,
    no_publish: row.no_publish === 1
  };
}

function normalizeOptionalBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  return normalizeBooleanFlag(value);
}

function getStudioLayoutTemplate(layoutTemplateId = "") {
  const templateId = cleanId(layoutTemplateId) || defaultLayoutTemplate().layout_template_id;
  const row = db.prepare("SELECT * FROM studio_layout_templates WHERE layout_template_id = ? AND status = 'active'").get(templateId);
  if (!row) throw requestError("Studio layout template not found", 404);
  return publicStudioLayoutTemplate(row);
}

function getStudioCutPlanRow(cutPlanId) {
  return db.prepare("SELECT * FROM studio_cut_plans WHERE cut_plan_id = ?").get(cleanId(cutPlanId));
}

function getStudioRenderManifestRow(renderManifestId) {
  return db.prepare("SELECT * FROM studio_render_manifests WHERE render_manifest_id = ?").get(cleanId(renderManifestId));
}

function getCampaignBrief(briefId) {
  const row = db.prepare("SELECT * FROM campaign_briefs WHERE campaign_brief_id = ?").get(cleanId(briefId));
  return row ? publicCampaignBrief(row) : null;
}

function getCampaignProjectRow(projectId) {
  return db.prepare("SELECT * FROM campaign_projects WHERE campaign_project_id = ?").get(cleanId(projectId));
}

function getCampaignProjectSceneRow(sceneId) {
  return db.prepare("SELECT * FROM campaign_project_scenes WHERE campaign_project_scene_id = ?").get(cleanId(sceneId));
}

function insertCampaignProjectScene(projectId, scope, input, createdAt = nowIso()) {
  const normalized = normalizeSceneForStorage(input, {});
  assertCampaignProjectSceneOrderAvailable(projectId, normalized.scene_order);
  const sceneId = cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId) ||
    nextEntityId("cps", `${projectId}-${normalized.scene_order}`);
  db.prepare(`
    INSERT INTO campaign_project_scenes (
      campaign_project_scene_id, campaign_project_id, tenant_id, store_id, screen_group_id,
      scene_order, scene_type, headline, body_text, visual_direction, cta_text,
      duration_seconds, asset_requirements_json, status, validation_status,
      validation_errors_json, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'draft', '[]', NULL, ?, ?)
  `).run(
    sceneId,
    cleanId(projectId),
    cleanId(scope.tenant_id),
    cleanId(scope.store_id),
    cleanId(scope.screen_group_id),
    normalized.scene_order,
    normalized.scene_type,
    normalized.headline,
    normalized.body_text,
    normalized.visual_direction,
    normalized.cta_text,
    normalized.duration_seconds,
    safeJsonStringify(normalized.asset_requirements, 10000),
    createdAt,
    createdAt
  );
  return publicCampaignProjectScene(getCampaignProjectSceneRow(sceneId));
}

function normalizeCampaignProjectSceneInputs(scenes) {
  if (scenes === undefined || scenes === null || scenes === "") return [];
  if (!Array.isArray(scenes)) throw requestError("scenes must be an array", 400);
  return scenes.map((scene, index) => normalizeSceneForStorage(scene, { scene_order: index + 1 }));
}

function resolveCampaignProjectInitialScenes(input = {}, campaignBrief = {}, source = {}) {
  if (hasSuppliedCampaignProjectScenes(input)) {
    if (shouldAutoGenerateCampaignScenes(input)) {
      throw requestError("scenes cannot be supplied together with auto_generate_scenes; choose explicit scenes or deterministic generation", 400);
    }
    return input.scenes;
  }
  if (!shouldAutoGenerateCampaignScenes(input)) return [];
  return buildDeterministicCampaignProjectScenes(campaignBrief, source);
}

function hasSuppliedCampaignProjectScenes(input = {}) {
  return input.scenes !== undefined && input.scenes !== null && input.scenes !== "";
}

function shouldAutoGenerateCampaignScenes(input = {}) {
  return normalizeBooleanFlag(
    input.auto_generate_scenes ??
    input.autoGenerateScenes ??
    input.generate_scenes ??
    input.generateScenes
  );
}

function campaignBriefFromProjectRow(row = {}) {
  const stored = parseJson(row.campaign_brief_json || "{}", {});
  return {
    objective: cleanString(stored.objective || row.objective),
    target_audience: cleanString(stored.target_audience || row.target_audience),
    store_context: cleanString(stored.store_context || row.store_context),
    offer_or_message: cleanString(stored.offer_or_message || row.offer_or_message),
    cta: cleanString(stored.cta || row.cta),
    success_metrics: parseJson(row.success_metrics_json || "[]", stored.success_metrics || []),
    constraints: parseJson(row.constraints_json || "[]", stored.constraints || []),
    source_proposal_id: cleanId(stored.source_proposal_id || row.source_proposal_id),
    source_context_snapshot_id: cleanId(stored.source_context_snapshot_id || row.source_context_snapshot_id),
    created_by_user_id: cleanString(stored.created_by_user_id || row.created_by_user_id)
  };
}

function deterministicCampaignSceneGeneratorMetadata() {
  return {
    generator_type: "deterministic_template",
    generator_version: "campaign-demo-v1",
    external_ai_used: false,
    media_generated: false,
    content_manifest_created: false,
    publish_created: false
  };
}

function buildDeterministicCampaignProjectScenes(campaignBrief = {}, source = {}) {
  const title = campaignSceneText(source.title || campaignBrief.objective || "キャンペーン告知", 80);
  const objective = campaignSceneText(campaignBrief.objective || title, 220);
  const audience = campaignSceneText(campaignBrief.target_audience || "来店中のお客様", 160);
  const storeContext = campaignSceneText(displayableCampaignStoreContext(campaignBrief.store_context), 260);
  const offer = campaignSceneText(campaignBrief.offer_or_message || objective, 260);
  const cta = campaignSceneText(campaignBrief.cta || "QRから詳しく見る", 80);
  const startOrder = Math.max(1, asInteger(source.start_order) || 1);
  const visualConstraint = Array.isArray(campaignBrief.constraints) && campaignBrief.constraints.length
    ? "運用制約は編集時に確認し、表示文には危険表現を入れない"
    : "短いコピーで3秒以内に意味が伝わる構成";
  return [
    {
      scene_order: startOrder,
      scene_type: "intro",
      headline: title,
      body_text: storeContext || objective,
      visual_direction: `入口で視認できる大きな写真と短い見出し。${visualConstraint}`,
      cta_text: cta,
      duration_seconds: 6,
      asset_requirements: ["store_or_context_photo"]
    },
    {
      scene_order: startOrder + 1,
      scene_type: "offer",
      headline: audience,
      body_text: offer,
      visual_direction: "訴求内容を中央に置き、対象者が一目で自分向けと分かる商品・空間写真を添える",
      cta_text: cta,
      duration_seconds: 8,
      asset_requirements: ["offer_photo", "supporting_copy"]
    },
    {
      scene_order: startOrder + 2,
      scene_type: "cta",
      headline: "詳しくはこちら",
      body_text: `${cta}。案内を確認して、必要な情報だけすぐ見られます。`,
      visual_direction: "QRとCTAを大きく配置し、余白を確保して読み取りやすくする",
      cta_text: cta,
      duration_seconds: 6,
      asset_requirements: ["qr_code"]
    }
  ];
}

function campaignSceneText(value, maxLength) {
  return cleanString(value).replace(/\s+/g, " ").slice(0, maxLength);
}

function displayableCampaignStoreContext(value) {
  const text = cleanString(value);
  if (!text || /^context_snapshot:/i.test(text)) return "店舗の前提に合わせた案内";
  return text;
}

function normalizeSceneForStorage(input, defaults = {}) {
  try {
    const scene = normalizeSceneDraftInput(input, defaults);
    if (!scene.scene_order) scene.scene_order = defaults.scene_order || 1;
    if (!CAMPAIGN_PROJECT_SCENE_STATUS.has(scene.validation_status)) scene.validation_status = "draft";
    return scene;
  } catch (error) {
    throw requestError(error.message || "Scene draft is invalid", 400);
  }
}

function nextCampaignProjectSceneOrder(projectId) {
  const row = db.prepare(`
    SELECT MAX(scene_order) AS max_scene_order
    FROM campaign_project_scenes
    WHERE campaign_project_id = ?
  `).get(cleanId(projectId));
  return Math.max(0, asInteger(row?.max_scene_order) || 0) + 1;
}

function assertCampaignProjectSceneOrderAvailable(projectId, sceneOrder, excludeSceneId = "") {
  if (!Number.isSafeInteger(sceneOrder) || sceneOrder < 1) {
    throw requestError("scene_order must be a positive integer", 400);
  }
  const existing = db.prepare(`
    SELECT campaign_project_scene_id, status
    FROM campaign_project_scenes
    WHERE campaign_project_id = ?
      AND scene_order = ?
      AND (? = '' OR campaign_project_scene_id != ?)
    LIMIT 1
  `).get(cleanId(projectId), sceneOrder, cleanId(excludeSceneId), cleanId(excludeSceneId));
  if (existing) {
    throw requestError("scene_order is already used by this campaign project and cannot be reused after soft delete", 409);
  }
}

function normalizeCampaignBriefForProject(input, defaults = {}) {
  let brief;
  try {
    brief = normalizeCampaignBriefInput(input, defaults);
  } catch (error) {
    throw requestError(error.message || "Campaign brief input is invalid", 400);
  }
  for (const field of ["objective", "target_audience", "store_context", "offer_or_message", "cta"]) {
    if (!cleanString(brief[field])) throw requestError(`${field} is required`, 400);
  }
  return brief;
}

function briefDefaultsFromProposal(proposal, brief = {}, actor = {}) {
  const briefPayload = brief?.brief || {};
  return {
    objective: proposal.objective || briefPayload.objective,
    target_audience: proposal.target_audience || briefPayload.target_audience,
    store_context: briefPayload.store_context || `context_snapshot:${proposal.context_snapshot_id}`,
    offer_or_message: briefPayload.offer_or_message || proposal.expected_effect || proposal.title,
    cta: briefPayload.cta || proposal.qr_flow || "QRから詳細を確認",
    success_metrics: briefPayload.success_metrics || ["play_count", "qr_scan_count", "counter_order_count"],
    constraints: briefPayload.constraints || proposal.required_assets || [],
    source_proposal_id: proposal.campaign_proposal_id,
    source_context_snapshot_id: proposal.context_snapshot_id,
    created_by_user_id: briefPayload.created_by_user_id || actor.actor_id || proposal.created_by_user_id || "admin"
  };
}

function validateCampaignProjectSource(projectRow) {
  const errors = [];
  if (projectRow.source_type && !CAMPAIGN_PROJECT_SOURCE_TYPE.has(projectRow.source_type)) {
    errors.push({ field: "source_type", code: "invalid", message: "project source_type is invalid" });
  }
  if (projectRow.source_proposal_id) {
    const proposal = getCampaignProposal(projectRow.source_proposal_id);
    if (!proposal) {
      errors.push({ field: "source_proposal_id", code: "missing", message: "source proposal was not found" });
    } else {
      if (proposal.status !== "selected") {
        errors.push({ field: "source_proposal_id", code: "non_selected_proposal", message: "source proposal must be selected" });
      }
      collectScopeMismatchErrors(errors, projectRow, proposal, "source_proposal");
    }
  }
  if (projectRow.campaign_brief_id) {
    const brief = getCampaignBrief(projectRow.campaign_brief_id);
    if (!brief) {
      errors.push({ field: "campaign_brief_id", code: "missing", message: "campaign brief was not found" });
    } else {
      collectScopeMismatchErrors(errors, projectRow, brief, "campaign_brief");
    }
  }
  const sceneScopeRows = db.prepare(`
    SELECT campaign_project_scene_id, tenant_id, store_id, screen_group_id
    FROM campaign_project_scenes
    WHERE campaign_project_id = ?
      AND status != 'deleted'
  `).all(projectRow.campaign_project_id);
  for (const scene of sceneScopeRows) {
    collectScopeMismatchErrors(errors, projectRow, scene, `scene:${scene.campaign_project_scene_id}`);
  }
  return errors;
}

function collectScopeMismatchErrors(errors, projectRow, source, label) {
  for (const field of ["tenant_id", "store_id", "screen_group_id"]) {
    if (cleanId(projectRow[field]) !== cleanId(source[field])) {
      errors.push({
        field,
        code: "scope_mismatch",
        message: `${label} ${field} does not match project scope`
      });
    }
  }
}

function assertCampaignProjectInputScope(input = {}, source, sourceName) {
  const hasScope = Boolean(input.tenant_id || input.tenantId || input.store_id || input.storeId || input.screen_group_id || input.screenGroupId);
  if (!hasScope) return;
  const scope = normalizeCampaignScope(input, { requireStore: false, allowEmptyTenant: true });
  if (scope.tenant_id && scope.tenant_id !== cleanId(source.tenant_id)) throw requestError(`${sourceName} is outside tenant scope`, 403);
  if (scope.store_id && scope.store_id !== cleanId(source.store_id)) throw requestError(`${sourceName} is outside store scope`, 403);
  if (scope.screen_group_id && scope.screen_group_id !== cleanId(source.screen_group_id)) throw requestError(`${sourceName} is outside screen group scope`, 403);
}

function normalizeCampaignProjectScopeQuery(query = {}) {
  return normalizeCampaignScope(query, { requireStore: false, allowEmptyTenant: true });
}

function touchCampaignProjectDraft(projectId, updatedAt = nowIso()) {
  db.prepare(`
    UPDATE campaign_projects SET
      status = CASE WHEN status = 'validated' THEN 'draft' ELSE status END,
      validation_status = 'draft',
      validation_errors_json = '[]',
      updated_at = ?
    WHERE campaign_project_id = ?
      AND status != 'deleted'
  `).run(updatedAt, cleanId(projectId));
}

function recordCampaignProjectEvent(projectId, sceneId, action, actorType, actorId, metadata = {}, createdAt = nowIso()) {
  const project = getCampaignProjectRow(projectId);
  if (!project) throw requestError("Campaign project not found", 404);
  const eventId = nextEntityId("cge", `${projectId}-${action}`);
  db.prepare(`
    INSERT INTO campaign_project_events (
      campaign_project_event_id, campaign_project_id, campaign_project_scene_id,
      tenant_id, store_id, screen_group_id, action, actor_type, actor_id,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    project.campaign_project_id,
    cleanId(sceneId),
    project.tenant_id,
    project.store_id,
    project.screen_group_id,
    cleanString(action).slice(0, 120),
    cleanString(actorType || "admin").slice(0, 80),
    cleanString(actorId).slice(0, 120),
    safeJsonStringify(metadata || {}, 10000),
    createdAt
  );
  return eventId;
}

function listCampaignProjectEvents(projectId) {
  return db.prepare(`
    SELECT * FROM campaign_project_events
    WHERE campaign_project_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).all(cleanId(projectId)).map(publicCampaignProjectEvent);
}

function listCampaignProjectScenes(projectId, options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  return db.prepare(`
    SELECT * FROM campaign_project_scenes
    WHERE campaign_project_id = ?
      AND (? = 1 OR status != 'deleted')
    ORDER BY scene_order ASC, id ASC
  `).all(cleanId(projectId), includeDeleted ? 1 : 0).map(publicCampaignProjectScene);
}

function assertCampaignGeneratorInput(input) {
  try {
    assertNoOutOfScopeCampaignGeneratorInput(input);
  } catch (error) {
    throw requestError(error.message || "Campaign Generator input is out of scope", 400);
  }
}

function assertStudioA1InputBoundary(input) {
  const forbiddenKeys = new Set([
    "ai_prompt",
    "content_id",
    "content_manifest_id",
    "credit_ledger",
    "external_ai_provider",
    "generated_media",
    "manifest",
    "media_generation",
    "mp4_export",
    "provider_job_id",
    "publish",
    "published_at",
    "render_job_id"
  ]);
  const walk = (value, pathLabel = "") => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${pathLabel}[${index}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = cleanString(key).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      if (normalizedKey === "external_ai_used" && Boolean(child)) {
        throw requestError("external AI is out of scope for Studio Execution A1", 400);
      }
      if (normalizedKey === "output_type" && cleanString(child) && cleanString(child) !== "html_preview") {
        throw requestError("A1 render manifest only supports html_preview output_type", 400);
      }
      if (forbiddenKeys.has(normalizedKey)) {
        throw requestError(`${pathLabel ? `${pathLabel}.` : ""}${key} is out of scope for Studio Execution A1`, 400);
      }
      walk(child, pathLabel ? `${pathLabel}.${key}` : key);
    }
  };
  walk(input);
}

function publicCustomerContextItem(row) {
  return {
    customer_context_item_id: cleanId(row.customer_context_item_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    context_category: cleanString(row.context_category),
    visibility_scope: cleanString(row.visibility_scope),
    source_owner: cleanString(row.source_owner),
    source_type: cleanString(row.source_type),
    confidence: cleanString(row.confidence),
    item_type: cleanId(row.item_type),
    item_key: cleanId(row.item_key),
    value: parseJson(row.value_json || "{}", {}),
    source: cleanString(row.source),
    status: cleanString(row.status),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    deleted_at: cleanString(row.deleted_at)
  };
}

function publicCustomerContextSnapshot(row) {
  return {
    customer_context_snapshot_id: cleanId(row.customer_context_snapshot_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    proposal_month: cleanMonthKey(row.proposal_month),
    snapshot_sha256: cleanString(row.snapshot_sha256),
    item_count: asInteger(row.item_count) || 0,
    source: cleanString(row.source),
    created_at: cleanString(row.created_at),
    snapshot: parseJson(row.snapshot_json || "{}", {})
  };
}

function publicProposalGenerationRun(row) {
  return {
    proposal_generation_run_id: cleanId(row.proposal_generation_run_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    proposal_month: cleanMonthKey(row.proposal_month),
    context_snapshot_id: cleanId(row.context_snapshot_id),
    context_snapshot_sha256: cleanString(row.snapshot_sha256),
    context_item_count: asInteger(row.item_count) || 0,
    generator_type: cleanString(row.generator_type),
    status: cleanString(row.status),
    external_ai_used: row.external_ai_used === 1,
    external_ai_provider: cleanString(row.external_ai_provider),
    external_ai_request_id: cleanString(row.external_ai_request_id),
    requested_by_user_id: cleanString(row.requested_by_user_id),
    proposal_count: asInteger(row.proposal_count) || 0,
    error: cleanString(row.error),
    metadata: parseJson(row.metadata_json || "{}", {}),
    started_at: cleanString(row.started_at),
    completed_at: cleanString(row.completed_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function publicCampaignProposal(row, options = {}) {
  const proposal = {
    campaign_proposal_id: cleanId(row.campaign_proposal_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    proposal_month: cleanMonthKey(row.proposal_month),
    context_snapshot_id: cleanId(row.context_snapshot_id),
    context_snapshot_sha256: cleanString(row.snapshot_sha256),
    context_item_count: asInteger(row.item_count) || 0,
    proposal_generation_run_id: cleanId(row.proposal_generation_run_id),
    campaign_brief_id: cleanId(row.campaign_brief_id),
    campaign_brief_status: cleanString(row.campaign_brief_status),
    title: cleanString(row.title),
    objective: cleanString(row.objective),
    target_audience: cleanString(row.target_audience),
    three_screen_outline: parseJson(row.three_screen_outline_json || "[]", []),
    qr_flow: cleanString(row.qr_flow),
    recommended_time_slots: parseJson(row.recommended_time_slots_json || "[]", []),
    expected_effect: cleanString(row.expected_effect),
    required_assets: parseJson(row.required_assets_json || "[]", []),
    status: cleanString(row.status),
    rejected_reason: cleanString(row.rejected_reason),
    selected_at: cleanString(row.selected_at),
    held_at: cleanString(row.held_at),
    rejected_at: cleanString(row.rejected_at),
    created_by_user_id: cleanString(row.created_by_user_id),
    source: cleanString(row.source),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    no_external_ai: true,
    no_content_manifest_creation: true
  };
  if (options.includeEvents) {
    proposal.events = listCampaignProposalEvents(proposal.campaign_proposal_id);
  }
  return proposal;
}

function publicCampaignProposalEvent(row) {
  return {
    campaign_proposal_event_id: cleanId(row.campaign_proposal_event_id),
    campaign_proposal_id: cleanId(row.campaign_proposal_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    from_status: cleanString(row.from_status),
    to_status: cleanString(row.to_status),
    reason: cleanString(row.reason),
    actor_type: cleanString(row.actor_type),
    actor_id: cleanString(row.actor_id),
    metadata: parseJson(row.metadata_json || "{}", {}),
    created_at: cleanString(row.created_at)
  };
}

function publicCampaignBrief(row) {
  return {
    campaign_brief_id: cleanId(row.campaign_brief_id),
    campaign_proposal_id: cleanId(row.campaign_proposal_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    context_snapshot_id: cleanId(row.context_snapshot_id),
    status: cleanString(row.status),
    brief: parseJson(row.brief_json || "{}", {}),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function publicMeasurementFieldSummary(row = {}) {
  return {
    content_layer: cleanString(row.content_layer),
    item_type: cleanString(row.item_type),
    measurement_goal: cleanString(row.measurement_goal),
    expected_action: cleanString(row.expected_action),
    campaign_id: cleanId(row.campaign_id),
    media_campaign_id: cleanId(row.media_campaign_id),
    creative_id: cleanId(row.creative_id),
    ad_slot_id: cleanId(row.ad_slot_id),
    qr_link_id: cleanId(row.qr_link_id),
    duration_class: cleanString(row.duration_class),
    variation_group: cleanId(row.variation_group),
    improvement_reason: cleanString(row.improvement_reason),
    previous_scene_id: cleanId(row.previous_scene_id),
    measurement_label: cleanString(row.measurement_label),
    data_source_class: cleanString(row.data_source_class),
    next_review_at: cleanString(row.next_review_at)
  };
}

function publicCampaignProject(row, options = {}) {
  const project = {
    campaign_project_id: cleanId(row.campaign_project_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_brief_id: cleanId(row.campaign_brief_id),
    source_type: cleanString(row.source_type),
    source_proposal_id: cleanId(row.source_proposal_id),
    source_context_snapshot_id: cleanId(row.source_context_snapshot_id),
    title: cleanString(row.title),
    objective: cleanString(row.objective),
    target_audience: cleanString(row.target_audience),
    store_context: cleanString(row.store_context),
    offer_or_message: cleanString(row.offer_or_message),
    cta: cleanString(row.cta),
    success_metrics: parseJson(row.success_metrics_json || "[]", []),
    constraints: parseJson(row.constraints_json || "[]", []),
    campaign_brief: parseJson(row.campaign_brief_json || "{}", {}),
    status: cleanString(row.status),
    validation_status: cleanString(row.validation_status),
    validation_errors: parseJson(row.validation_errors_json || "[]", []),
    created_by_user_id: cleanString(row.created_by_user_id),
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    measurement: publicMeasurementFieldSummary(row),
    no_external_ai: true,
    no_media_generation: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
  if (options.includeScenes) {
    project.scenes = listCampaignProjectScenes(project.campaign_project_id, { includeDeleted: options.includeDeletedScenes });
  }
  if (options.includeEvents) {
    project.events = listCampaignProjectEvents(project.campaign_project_id);
  }
  return project;
}

function publicCampaignProjectScene(row) {
  return {
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    scene_order: asInteger(row.scene_order) || 0,
    scene_type: cleanString(row.scene_type),
    headline: cleanString(row.headline),
    body_text: cleanString(row.body_text),
    visual_direction: cleanString(row.visual_direction),
    cta_text: cleanString(row.cta_text),
    duration_seconds: asInteger(row.duration_seconds) || 0,
    asset_requirements: parseJson(row.asset_requirements_json || "[]", []),
    status: cleanString(row.status),
    validation_status: cleanString(row.validation_status),
    validation_errors: parseJson(row.validation_errors_json || "[]", []),
    measurement: publicMeasurementFieldSummary(row),
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function publicCampaignProjectEvent(row) {
  return {
    campaign_project_event_id: cleanId(row.campaign_project_event_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    action: cleanString(row.action),
    actor_type: cleanString(row.actor_type),
    actor_id: cleanString(row.actor_id),
    metadata: parseJson(row.metadata_json || "{}", {}),
    created_at: cleanString(row.created_at)
  };
}

function publicStudioLayoutTemplate(row) {
  return {
    layout_template_id: cleanId(row.layout_template_id),
    template_version: cleanString(row.template_version),
    screen_mode: cleanString(row.screen_mode),
    canvas_width: asInteger(row.canvas_width) || 0,
    canvas_height: asInteger(row.canvas_height) || 0,
    fps: asInteger(row.fps) || 0,
    safe_area_px: parseJson(row.safe_area_json || "{}", {}),
    bezel_policy: cleanString(row.bezel_policy),
    regions: parseJson(row.regions_json || "[]", []),
    min_font_px: asInteger(row.min_font_px) || 0,
    max_line_length_chars: asInteger(row.max_line_length_chars) || 0,
    contrast_policy: cleanString(row.contrast_policy),
    status: cleanString(row.status),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function publicStudioCutPlan(row, options = {}) {
  const cutPlan = {
    schema_version: "studio-cut-plan/a1",
    cut_plan_id: cleanId(row.cut_plan_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 0,
    source_scene_ids: parseJson(row.source_scene_ids_json || "[]", []),
    cut_plan_version: cleanString(row.cut_plan_version),
    status: cleanString(row.status),
    layout_template_id: cleanId(row.layout_template_id),
    scene_order: parseJson(row.scene_order_json || "[]", []),
    screen_bindings: parseJson(row.screen_bindings_json || "{}", {}),
    copy_bindings: parseJson(row.copy_bindings_json || "{}", {}),
    visual_direction: parseJson(row.visual_direction_json || "{}", {}),
    asset_requirements: parseJson(row.asset_requirements_json || "[]", []),
    brand_constraints: parseJson(row.brand_constraints_json || "{}", {}),
    forbidden_elements: parseJson(row.forbidden_elements_json || "[]", []),
    measurement_goal: cleanString(row.measurement_goal),
    expected_action: cleanString(row.expected_action),
    deterministic_identity: parseJson(row.deterministic_identity_json || "{}", {}),
    validation_status: cleanString(row.validation_status),
    validation_errors: parseJson(row.validation_errors_json || "[]", []),
    created_by_actor_id: cleanString(row.created_by_actor_id),
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    no_external_ai: true,
    no_provider_job: true,
    no_media_generation: true,
    no_mp4_export: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
  if (options.includeLayoutTemplate) {
    cutPlan.layout_template = getStudioLayoutTemplate(cutPlan.layout_template_id);
  }
  if (options.includeRenderManifests) {
    cutPlan.render_manifests = listStudioRenderManifestsForCutPlan(cutPlan.cut_plan_id, { include_deleted: options.includeDeletedRenderManifests ? "1" : "" });
  }
  return cutPlan;
}

function publicStudioRenderManifest(row, options = {}) {
  const manifest = {
    schema_version: "studio-render-manifest/a1",
    render_manifest_id: cleanId(row.render_manifest_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 0,
    cut_plan_id: cleanId(row.cut_plan_id),
    cut_plan_version: cleanString(row.cut_plan_version),
    layout_template_id: cleanId(row.layout_template_id),
    template_version: cleanString(row.template_version),
    renderer: cleanString(row.renderer),
    renderer_version: cleanString(row.renderer_version),
    scene_ids: parseJson(row.scene_ids_json || "[]", []),
    source_asset_ids: parseJson(row.source_asset_ids_json || "[]", []),
    generated_asset_ids: parseJson(row.generated_asset_ids_json || "[]", []),
    provider_job_ids: parseJson(row.provider_job_ids_json || "[]", []),
    output_type: cleanString(row.output_type),
    output_ref: cleanString(row.output_ref),
    output_sha256: cleanString(row.output_sha256),
    resolution_width: asInteger(row.resolution_width) || 0,
    resolution_height: asInteger(row.resolution_height) || 0,
    fps: asInteger(row.fps) || 0,
    duration_seconds: asInteger(row.duration_seconds) || 0,
    screen_layout: cleanString(row.screen_layout),
    qa_status: cleanString(row.qa_status),
    qa_errors: parseJson(row.qa_errors_json || "[]", []),
    render_state: parseJson(row.render_state_json || "{}", {}),
    status: cleanString(row.status),
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    source_of_truth: "html_preview_state",
    mp4_is_export_artifact_only: true,
    no_external_ai: true,
    no_provider_job: true,
    no_media_generation: true,
    no_mp4_export: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
  if (options.includeQaResults) {
    manifest.qa_results = listStudioRenderQaResults(manifest.render_manifest_id);
  }
  return manifest;
}

function publicStudioRenderQaResult(row) {
  return {
    render_qa_result_id: cleanId(row.render_qa_result_id),
    render_manifest_id: cleanId(row.render_manifest_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    cut_plan_id: cleanId(row.cut_plan_id),
    qa_suite_version: cleanString(row.qa_suite_version),
    status: cleanString(row.status),
    checks: parseJson(row.checks_json || "[]", []),
    blocked_reasons: parseJson(row.blocked_reasons_json || "[]", []),
    errors: parseJson(row.errors_json || "[]", []),
    created_at: cleanString(row.created_at)
  };
}

function publicStudioPublishPreflight(row, options = {}) {
  const preflight = {
    schema_version: "studio-publish-preflight/c1",
    preflight_version: PUBLISH_PREFLIGHT_VERSION,
    publish_preflight_id: cleanId(row.publish_preflight_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 1,
    render_manifest_id: cleanId(row.render_manifest_id),
    render_manifest_output_sha256: cleanString(row.render_manifest_output_sha256),
    required_asset_ids: parseJson(row.required_asset_ids_json || "[]", []),
    content_type: cleanString(row.content_type),
    publish_mode: cleanString(row.publish_mode),
    status: cleanString(row.status),
    checks: parseJson(row.checks_json || "[]", []),
    blocked_reasons: parseJson(row.blocked_reasons_json || "[]", []),
    docs99_gate_ref: cleanString(row.docs99_gate_ref),
    docs99_gate_verdict: cleanString(row.docs99_gate_verdict),
    approval_gate_ref: cleanString(row.approval_gate_ref),
    request_reason: cleanString(row.request_reason),
    created_by_actor_id: cleanId(row.created_by_actor_id),
    no_active_content_manifest_mutation: row.no_active_content_manifest_mutation === 1,
    no_content_manifest_activation: row.no_content_manifest_activation === 1,
    no_publish: row.no_publish === 1,
    no_player_device_mutation: row.no_player_device_mutation === 1,
    no_schedule_activation: row.no_schedule_activation === 1,
    dry_run_only: row.dry_run_only === 1,
    created_at: cleanString(row.created_at)
  };
  if (options.includeDraftTransform) {
    const transformRow = getContentManifestDraftTransformRowForPreflight(preflight.publish_preflight_id);
    preflight.content_manifest_draft_transform = transformRow ? publicContentManifestDraftTransform(transformRow) : null;
  }
  return preflight;
}

function publicContentManifestDraftTransform(row) {
  return {
    schema_version: "content-manifest-draft-transform/c1",
    transform_version: CONTENT_MANIFEST_DRAFT_TRANSFORM_VERSION,
    draft_transform_id: cleanId(row.draft_transform_id),
    publish_preflight_id: cleanId(row.publish_preflight_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 1,
    render_manifest_id: cleanId(row.render_manifest_id),
    draft_content_manifest_id: cleanId(row.draft_content_manifest_id),
    status: cleanString(row.status),
    transform_errors: parseJson(row.transform_errors_json || "[]", []),
    playlist_item_draft_ids: parseJson(row.playlist_item_draft_ids_json || "[]", []),
    schedule_draft_ids: parseJson(row.schedule_draft_ids_json || "[]", []),
    qr_link_ids: parseJson(row.qr_link_ids_json || "[]", []),
    content_manifest_draft: parseJson(row.content_manifest_draft_json || "{}", {}),
    content_manifest_draft_sha256: cleanString(row.content_manifest_draft_sha256),
    no_active_content_manifest_mutation: row.no_active_content_manifest_mutation === 1,
    no_content_manifest_activation: row.no_content_manifest_activation === 1,
    no_publish: row.no_publish === 1,
    no_player_device_mutation: row.no_player_device_mutation === 1,
    no_schedule_activation: row.no_schedule_activation === 1,
    created_by_actor_id: cleanId(row.created_by_actor_id),
    created_at: cleanString(row.created_at)
  };
}

function listStudioMeasurementBindingsForProject(projectId, query = {}) {
  const projectRow = getCampaignProjectRow(projectId);
  if (!projectRow) throw requestError("Campaign project not found", 404);
  if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
  const scope = normalizeCampaignProjectScopeQuery(query || {});
  if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
    assertCampaignProjectInputScope(scope, projectRow, "Campaign project");
  }
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  return db.prepare(`
    SELECT * FROM studio_measurement_bindings
    WHERE campaign_project_id = ?
      AND (? = 1 OR status != 'deleted')
    ORDER BY updated_at DESC, id DESC
    LIMIT 100
  `).all(cleanId(projectId), includeDeleted ? 1 : 0).map(publicStudioMeasurementBinding);
}

function createStudioMeasurementBinding(projectId, input = {}, actor = {}) {
  assertStudioD1RouteBoundary(input);
  const created = db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    assertCampaignProjectInputScope(input, projectRow, "Campaign project");
    const sceneRow = resolveStudioD1Scene(projectRow, input);
    const renderManifestRow = resolveStudioD1RenderManifest(projectRow, input);
    const now = nowIso();
    const defaults = defaultMeasurementBindingFields(projectRow, sceneRow, renderManifestRow, input);
    const normalized = normalizeStudioD1MeasurementBinding(input, defaults);
    const validation = validateMeasurementBindingContract(normalized, {
      project: projectRow,
      scene: sceneRow,
      render_manifest: renderManifestRow
    });
    assertNoStudioD1HardBlockers(validation);
    const bindingId = normalized.measurement_binding_id || nextEntityId("mb", `${projectRow.campaign_project_id}-${sceneRow?.campaign_project_scene_id || "project"}`);
    db.prepare(`
      INSERT INTO studio_measurement_bindings (
        measurement_binding_id, tenant_id, store_id, screen_group_id,
        campaign_project_id, campaign_project_revision, campaign_project_scene_id,
        render_manifest_id, content_layer, item_type, measurement_goal, expected_action,
        campaign_id, media_campaign_id, creative_id, ad_slot_id, qr_link_id,
        variation_group, improvement_reason, previous_scene_id, duration_class,
        measurement_label, data_source_class, baseline_evidence_ref, holdout_evidence_ref,
        next_review_at, status, validation_status, validation_errors_json,
        validation_checks_json, deleted_at, created_by_actor_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      bindingId,
      normalized.tenant_id,
      normalized.store_id,
      normalized.screen_group_id,
      normalized.campaign_project_id,
      normalized.campaign_project_revision,
      normalized.campaign_project_scene_id,
      normalized.render_manifest_id,
      normalized.content_layer,
      normalized.item_type,
      normalized.measurement_goal,
      normalized.expected_action,
      normalized.campaign_id,
      normalized.media_campaign_id,
      normalized.creative_id,
      normalized.ad_slot_id,
      normalized.qr_link_id,
      normalized.variation_group,
      normalized.improvement_reason,
      normalized.previous_scene_id,
      normalized.duration_class,
      normalized.measurement_label,
      normalized.data_source_class,
      normalized.baseline_evidence_ref,
      normalized.holdout_evidence_ref,
      normalized.next_review_at,
      normalized.status,
      validation.valid ? "valid" : "invalid",
      safeJsonStringify(validation.errors, 10000),
      safeJsonStringify(validation.checks, 20000),
      cleanId(actor.actor_id || "admin"),
      now,
      now
    );
    applyStudioMeasurementFields(normalized, now);
    recordCampaignProjectEvent(projectRow.campaign_project_id, normalized.campaign_project_scene_id, "measurement_binding.created", "admin", actor.actor_id || "admin", {
      measurement_binding_id: bindingId,
      validation_status: validation.valid ? "valid" : "invalid",
      measurement_label: normalized.measurement_label,
      data_source_class: normalized.data_source_class,
      expected_action: normalized.expected_action,
      qr_response_only: true,
      no_roi_fabrication: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_player_device_mutation: true
    }, now);
    return publicStudioMeasurementBinding(getStudioMeasurementBindingRow(bindingId));
  })();
  return created;
}

function getStudioMeasurementBinding(bindingId, scope = null, options = {}) {
  const row = getStudioMeasurementBindingRow(bindingId);
  if (!row || row.status === "deleted") return null;
  if (scope) assertStudioD1RowScope(scope, row, "Studio measurement binding");
  return publicStudioMeasurementBinding(row, options);
}

function validateStudioMeasurementBinding(bindingId, input = {}, actor = {}) {
  assertStudioD1RouteBoundary(input);
  const result = db.transaction(() => {
    const row = getStudioMeasurementBindingRow(bindingId);
    if (!row || row.status === "deleted") throw requestError("Studio measurement binding not found", 404);
    const projectRow = getCampaignProjectRow(row.campaign_project_id);
    if (!projectRow || projectRow.status === "deleted") throw requestError("Campaign project not found", 404);
    assertStudioD1RowScope(input, row, "Studio measurement binding");
    const sceneRow = row.campaign_project_scene_id ? getCampaignProjectSceneRow(row.campaign_project_scene_id) : null;
    const renderManifestRow = row.render_manifest_id ? getStudioRenderManifestRow(row.render_manifest_id) : null;
    const qrBindingRow = row.qr_link_id ? getStudioQrBindingRow(row.qr_link_id) : null;
    const validation = validateMeasurementBindingContract(publicStudioMeasurementBinding(row), {
      project: projectRow,
      scene: sceneRow,
      render_manifest: renderManifestRow,
      qr_binding: qrBindingRow
    });
    assertNoStudioD1HardBlockers(validation);
    const now = nowIso();
    db.prepare(`
      UPDATE studio_measurement_bindings SET
        validation_status = ?,
        validation_errors_json = ?,
        validation_checks_json = ?,
        status = CASE WHEN status = 'deleted' THEN status ELSE ? END,
        updated_at = ?
      WHERE measurement_binding_id = ?
    `).run(
      validation.valid ? "valid" : "invalid",
      safeJsonStringify(validation.errors, 10000),
      safeJsonStringify(validation.checks, 20000),
      validation.valid ? "valid" : "draft",
      now,
      row.measurement_binding_id
    );
    recordCampaignProjectEvent(row.campaign_project_id, row.campaign_project_scene_id, "measurement_binding.validated", "admin", actor.actor_id || "admin", {
      measurement_binding_id: row.measurement_binding_id,
      valid: validation.valid,
      error_count: validation.errors.length,
      no_roi_fabrication: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return {
      valid: validation.valid,
      validation_errors: validation.errors,
      validation_checks: validation.checks,
      studio_measurement_binding: publicStudioMeasurementBinding(getStudioMeasurementBindingRow(row.measurement_binding_id), { includeQrBindings: true })
    };
  })();
  return result;
}

function softDeleteStudioMeasurementBinding(bindingId, actor = {}) {
  return db.transaction(() => {
    const row = getStudioMeasurementBindingRow(bindingId);
    if (!row) throw requestError("Studio measurement binding not found", 404);
    if (row.status === "deleted") return publicStudioMeasurementBinding(row, { includeQrBindings: true });
    const now = nowIso();
    db.prepare(`
      UPDATE studio_measurement_bindings SET
        status = 'deleted',
        validation_status = 'deleted',
        deleted_at = ?,
        updated_at = ?
      WHERE measurement_binding_id = ?
    `).run(now, now, row.measurement_binding_id);
    db.prepare(`
      UPDATE studio_qr_bindings SET
        status = 'deleted',
        deleted_at = COALESCE(NULLIF(deleted_at, ''), ?),
        updated_at = ?
      WHERE measurement_binding_id = ?
        AND status != 'deleted'
    `).run(now, now, row.measurement_binding_id);
    db.prepare(`
      UPDATE qr_links SET
        status = 'revoked',
        updated_at = ?
      WHERE measurement_binding_id = ?
        AND status = 'active'
    `).run(now, row.measurement_binding_id);
    recordCampaignProjectEvent(row.campaign_project_id, row.campaign_project_scene_id, "measurement_binding.deleted", "admin", actor.actor_id || "admin", {
      measurement_binding_id: row.measurement_binding_id,
      qr_links_revoked: true
    }, now);
    return publicStudioMeasurementBinding(getStudioMeasurementBindingRow(row.measurement_binding_id), { includeQrBindings: true });
  })();
}

function listStudioQrBindingsForMeasurement(bindingId, query = {}) {
  const binding = getStudioMeasurementBindingRow(bindingId);
  if (!binding || binding.status === "deleted") throw requestError("Studio measurement binding not found", 404);
  assertStudioD1RowScope(query, binding, "Studio measurement binding");
  const includeDeleted = normalizeBooleanFlag(query.include_deleted || query.includeDeleted);
  return db.prepare(`
    SELECT * FROM studio_qr_bindings
    WHERE measurement_binding_id = ?
      AND (? = 1 OR status != 'deleted')
    ORDER BY updated_at DESC, id DESC
    LIMIT 100
  `).all(cleanId(bindingId), includeDeleted ? 1 : 0).map(publicStudioQrBinding);
}

function createStudioQrBinding(bindingId, input = {}, actor = {}) {
  assertStudioD1RouteBoundary(input);
  return db.transaction(() => {
    const bindingRow = getStudioMeasurementBindingRow(bindingId);
    if (!bindingRow || bindingRow.status === "deleted") throw requestError("Studio measurement binding not found", 404);
    assertStudioD1RowScope(input, bindingRow, "Studio measurement binding");
    const now = nowIso();
    const qrToken = cleanId(input.qr_token || input.qrToken || crypto.randomBytes(12).toString("base64url"));
    const defaults = {
      ...publicStudioMeasurementBinding(bindingRow),
      qr_binding_id: nextEntityId("qrb", bindingRow.measurement_binding_id),
      qr_link_id: cleanId(input.qr_link_id || input.qrLinkId) || nextEntityId("qr", bindingRow.measurement_binding_id),
      qr_token: qrToken,
      target_url: cleanString(input.target_url || input.targetUrl || input.destination_url || input.destinationUrl) || `/q/${qrToken}`,
      status: cleanString(input.status || "draft"),
      attribution_claim: "measured_response_only",
      created_by_actor_id: cleanId(actor.actor_id || "admin")
    };
    const normalized = normalizeStudioD1QrBinding(input, defaults);
    const validation = validateQrBindingContract(normalized, publicStudioMeasurementBinding(bindingRow));
    if (!validation.valid) {
      throw requestError(`QR binding contract is invalid: ${validation.errors.map((error) => `${error.field}:${error.code}`).join(", ")}`, 400);
    }
    const qrLink = createQrLink({
      qr_link_id: normalized.qr_link_id,
      qr_token: normalized.qr_token,
      tenant_id: normalized.tenant_id,
      store_id: normalized.store_id,
      screen_group_id: normalized.screen_group_id,
      campaign_id: normalized.campaign_id,
      label: `Studio QR ${normalized.creative_id}`,
      destination_type: "external_url",
      destination_url: normalized.target_url,
      status: normalized.status === "active" ? "active" : "draft",
      valid_until: normalized.expires_at,
      measurement_binding_id: normalized.measurement_binding_id,
      campaign_project_id: normalized.campaign_project_id,
      campaign_project_scene_id: normalized.campaign_project_scene_id,
      media_campaign_id: normalized.media_campaign_id,
      creative_id: normalized.creative_id,
      ad_slot_id: normalized.ad_slot_id,
      measurement_label: "measured",
      data_source_class: "misell_qr",
      attribution_claim: "measured_response_only"
    });
    db.prepare(`
      INSERT INTO studio_qr_bindings (
        qr_binding_id, qr_link_id, qr_token, measurement_binding_id,
        tenant_id, store_id, screen_group_id, campaign_project_id,
        campaign_project_revision, campaign_project_scene_id, creative_id,
        campaign_id, media_campaign_id, ad_slot_id, target_url, status,
        attribution_claim, expires_at, created_by_actor_id, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      normalized.qr_binding_id,
      normalized.qr_link_id,
      normalized.qr_token,
      normalized.measurement_binding_id,
      normalized.tenant_id,
      normalized.store_id,
      normalized.screen_group_id,
      normalized.campaign_project_id,
      normalized.campaign_project_revision,
      normalized.campaign_project_scene_id,
      normalized.creative_id,
      normalized.campaign_id,
      normalized.media_campaign_id,
      normalized.ad_slot_id,
      normalized.target_url,
      normalized.status,
      normalized.attribution_claim,
      normalized.expires_at,
      normalized.created_by_actor_id,
      now,
      now
    );
    db.prepare(`
      UPDATE studio_measurement_bindings SET
        qr_link_id = ?,
        measurement_label = 'measured',
        data_source_class = 'misell_qr',
        status = 'valid',
        validation_status = 'valid',
        validation_errors_json = '[]',
        validation_checks_json = ?,
        updated_at = ?
      WHERE measurement_binding_id = ?
    `).run(
      normalized.qr_link_id,
      safeJsonStringify(validateMeasurementBindingContract({
        ...publicStudioMeasurementBinding(bindingRow),
        qr_link_id: normalized.qr_link_id,
        measurement_label: "measured",
        data_source_class: "misell_qr"
      }, { qr_binding: normalized }).checks, 20000),
      now,
      bindingRow.measurement_binding_id
    );
    applyStudioMeasurementFields({
      ...publicStudioMeasurementBinding(getStudioMeasurementBindingRow(bindingRow.measurement_binding_id)),
      qr_link_id: normalized.qr_link_id
    }, now);
    recordCampaignProjectEvent(bindingRow.campaign_project_id, bindingRow.campaign_project_scene_id, "qr_binding.created", "admin", actor.actor_id || "admin", {
      measurement_binding_id: bindingRow.measurement_binding_id,
      qr_binding_id: normalized.qr_binding_id,
      qr_link_id: normalized.qr_link_id,
      status: normalized.status,
      attribution_claim: "measured_response_only",
      no_roi_fabrication: true,
      no_content_manifest_creation: true,
      no_publish: true
    }, now);
    return {
      studio_qr_binding: publicStudioQrBinding(getStudioQrBindingRow(normalized.qr_link_id)),
      qr_link: qrLink,
      studio_measurement_binding: publicStudioMeasurementBinding(getStudioMeasurementBindingRow(bindingRow.measurement_binding_id), { includeQrBindings: true })
    };
  })();
}

function getStudioMeasurementBindingRow(bindingId) {
  return db.prepare("SELECT * FROM studio_measurement_bindings WHERE measurement_binding_id = ?").get(cleanId(bindingId));
}

function getStudioQrBindingRow(qrLinkId) {
  return db.prepare("SELECT * FROM studio_qr_bindings WHERE qr_link_id = ?").get(cleanId(qrLinkId));
}

function publicStudioMeasurementBinding(row, options = {}) {
  const binding = {
    schema_version: "studio-measurement-binding/d1",
    binding_version: MEASUREMENT_BINDING_VERSION,
    measurement_binding_id: cleanId(row.measurement_binding_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 1,
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    render_manifest_id: cleanId(row.render_manifest_id),
    content_layer: cleanString(row.content_layer),
    item_type: cleanString(row.item_type),
    measurement_goal: cleanString(row.measurement_goal),
    expected_action: cleanString(row.expected_action),
    campaign_id: cleanId(row.campaign_id),
    media_campaign_id: cleanId(row.media_campaign_id),
    creative_id: cleanId(row.creative_id),
    ad_slot_id: cleanId(row.ad_slot_id),
    qr_link_id: cleanId(row.qr_link_id),
    variation_group: cleanId(row.variation_group),
    improvement_reason: cleanString(row.improvement_reason),
    previous_scene_id: cleanId(row.previous_scene_id),
    duration_class: cleanString(row.duration_class),
    measurement_label: cleanString(row.measurement_label),
    data_source_class: cleanString(row.data_source_class),
    baseline_evidence_ref: cleanString(row.baseline_evidence_ref),
    holdout_evidence_ref: cleanString(row.holdout_evidence_ref),
    next_review_at: cleanString(row.next_review_at),
    status: cleanString(row.status),
    validation_status: cleanString(row.validation_status),
    validation_errors: parseJson(row.validation_errors_json || "[]", []),
    validation_checks: parseJson(row.validation_checks_json || "[]", []),
    deleted_at: cleanString(row.deleted_at),
    created_by_actor_id: cleanId(row.created_by_actor_id),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    qr_scan_is_measured_response_only: true,
    no_roi_fabrication: true,
    no_content_manifest_creation: true,
    no_publish: true,
    no_player_device_mutation: true
  };
  if (options.includeQrBindings) {
    const includeDeleted = options.includeDeletedQrBindings ? 1 : 0;
    binding.qr_bindings = db.prepare(`
      SELECT * FROM studio_qr_bindings
      WHERE measurement_binding_id = ?
        AND (? = 1 OR status != 'deleted')
      ORDER BY updated_at DESC, id DESC
      LIMIT 100
    `).all(binding.measurement_binding_id, includeDeleted).map(publicStudioQrBinding);
  }
  return binding;
}

function publicStudioQrBinding(row) {
  return {
    schema_version: "studio-qr-binding/d1",
    binding_version: QR_BINDING_VERSION,
    qr_binding_id: cleanId(row.qr_binding_id),
    qr_link_id: cleanId(row.qr_link_id),
    qr_token: cleanId(row.qr_token),
    measurement_binding_id: cleanId(row.measurement_binding_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_revision: asInteger(row.campaign_project_revision) || 1,
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    creative_id: cleanId(row.creative_id),
    campaign_id: cleanId(row.campaign_id),
    media_campaign_id: cleanId(row.media_campaign_id),
    ad_slot_id: cleanId(row.ad_slot_id),
    target_url: cleanString(row.target_url),
    status: cleanString(row.status),
    attribution_claim: cleanString(row.attribution_claim || "measured_response_only"),
    expires_at: cleanString(row.expires_at),
    created_by_actor_id: cleanId(row.created_by_actor_id),
    deleted_at: cleanString(row.deleted_at),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    qr_scan_is_measured_response_only: true,
    no_roi_fabrication: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
}

function normalizeStudioD1MeasurementBinding(input, defaults) {
  try {
    return normalizeMeasurementBindingInput(input, defaults);
  } catch (error) {
    throw requestError(error.message || "Studio measurement binding input is invalid", 400);
  }
}

function normalizeStudioD1QrBinding(input, defaults) {
  try {
    return normalizeQrBindingInput(input, defaults);
  } catch (error) {
    throw requestError(error.message || "Studio QR binding input is invalid", 400);
  }
}

function assertStudioD1RouteBoundary(input = {}) {
  try {
    assertStudioD1InputBoundary(input);
  } catch (error) {
    throw requestError(error.message || "Studio Execution D1 input is out of scope", 400);
  }
}

function assertNoStudioD1HardBlockers(validation) {
  const hardCodes = new Set(["incremental_requires_baseline_or_holdout", "measured_source_mismatch"]);
  const hardError = validation.errors.find((error) => hardCodes.has(error.code));
  if (hardError) {
    throw requestError(`${hardError.field}: ${hardError.message}`, 400);
  }
}

function resolveStudioD1Scene(projectRow, input = {}) {
  const sceneId = cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId || input.scene_id || input.sceneId);
  if (!sceneId) return null;
  const sceneRow = getCampaignProjectSceneRow(sceneId);
  if (!sceneRow || sceneRow.status === "deleted") throw requestError("Campaign project scene not found", 404);
  if (cleanId(sceneRow.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
    throw requestError("Campaign project scene is outside project scope", 403);
  }
  collectScopeMismatchErrorsOrThrow(projectRow, sceneRow, "Campaign project scene");
  return sceneRow;
}

function resolveStudioD1RenderManifest(projectRow, input = {}) {
  const renderManifestId = cleanId(input.render_manifest_id || input.renderManifestId);
  if (!renderManifestId) return null;
  const row = getStudioRenderManifestRow(renderManifestId);
  if (!row || row.status === "deleted") throw requestError("Studio render manifest not found", 404);
  if (cleanId(row.campaign_project_id) !== cleanId(projectRow.campaign_project_id)) {
    throw requestError("Studio render manifest is outside project scope", 403);
  }
  collectScopeMismatchErrorsOrThrow(projectRow, row, "Studio render manifest");
  return row;
}

function defaultMeasurementBindingFields(projectRow, sceneRow = null, renderManifestRow = null, input = {}) {
  const successMetrics = parseJson(projectRow.success_metrics_json || "[]", []);
  const measurementGoal = cleanString(input.measurement_goal || input.measurementGoal) ||
    cleanString(successMetrics[0]) ||
    "qr_scan_count";
  const sceneId = cleanId(sceneRow?.campaign_project_scene_id);
  const projectId = cleanId(projectRow.campaign_project_id);
  return {
    tenant_id: cleanId(projectRow.tenant_id),
    store_id: cleanId(projectRow.store_id),
    screen_group_id: cleanId(projectRow.screen_group_id),
    campaign_project_id: projectId,
    campaign_project_revision: 1,
    campaign_project_scene_id: sceneId,
    render_manifest_id: cleanId(renderManifestRow?.render_manifest_id),
    content_layer: cleanString(input.content_layer || input.contentLayer || projectRow.content_layer) || "campaign_refresh",
    item_type: cleanString(input.item_type || input.itemType || projectRow.item_type) || "content",
    measurement_goal: measurementGoal,
    expected_action: cleanString(input.expected_action || input.expectedAction) || expectedActionFromCta(sceneRow?.cta_text || projectRow.cta),
    campaign_id: cleanId(input.campaign_id || input.campaignId || projectRow.campaign_id),
    media_campaign_id: cleanId(input.media_campaign_id || input.mediaCampaignId || projectRow.media_campaign_id),
    creative_id: cleanId(input.creative_id || input.creativeId || sceneRow?.creative_id) || cleanId(`creative-${sceneId || projectId}`),
    ad_slot_id: cleanId(input.ad_slot_id || input.adSlotId || projectRow.ad_slot_id),
    qr_link_id: cleanId(input.qr_link_id || input.qrLinkId || sceneRow?.qr_link_id || projectRow.qr_link_id),
    duration_class: cleanString(input.duration_class || input.durationClass || sceneRow?.duration_class) || durationClassForSeconds(sceneRow?.duration_seconds),
    measurement_label: cleanString(input.measurement_label || input.measurementLabel) || "measured",
    data_source_class: cleanString(input.data_source_class || input.dataSourceClass) || "misell_qr",
    status: "draft"
  };
}

function expectedActionFromCta(ctaText) {
  const text = cleanString(ctaText);
  return /qr/i.test(text) || /QR/.test(text) ? "qr_scan" : "awareness";
}

function durationClassForSeconds(seconds) {
  const value = asInteger(seconds) || 0;
  if (value <= 3) return "glance_3s";
  if (value <= 7) return "visual_5_7s";
  if (value <= 10) return "text_7_10s";
  if (value <= 15) return "standard_8_15s";
  return "detail_15_20s";
}

function applyStudioMeasurementFields(binding, updatedAt = nowIso()) {
  const values = [
    cleanString(binding.content_layer),
    cleanString(binding.item_type),
    cleanString(binding.measurement_goal),
    cleanString(binding.expected_action),
    cleanId(binding.campaign_id),
    cleanId(binding.media_campaign_id),
    cleanId(binding.creative_id),
    cleanId(binding.ad_slot_id),
    cleanId(binding.qr_link_id),
    cleanString(binding.duration_class),
    cleanId(binding.variation_group),
    cleanString(binding.improvement_reason),
    cleanId(binding.previous_scene_id),
    cleanString(binding.measurement_label),
    cleanString(binding.data_source_class),
    cleanString(binding.next_review_at),
    updatedAt
  ];
  if (cleanId(binding.campaign_project_scene_id)) {
    db.prepare(`
      UPDATE campaign_project_scenes SET
        content_layer = ?,
        item_type = ?,
        measurement_goal = ?,
        expected_action = ?,
        campaign_id = ?,
        media_campaign_id = ?,
        creative_id = ?,
        ad_slot_id = ?,
        qr_link_id = ?,
        duration_class = ?,
        variation_group = ?,
        improvement_reason = ?,
        previous_scene_id = ?,
        measurement_label = ?,
        data_source_class = ?,
        next_review_at = ?,
        updated_at = ?
      WHERE campaign_project_scene_id = ?
    `).run(...values, cleanId(binding.campaign_project_scene_id));
    return;
  }
  db.prepare(`
    UPDATE campaign_projects SET
      content_layer = ?,
      item_type = ?,
      measurement_goal = ?,
      expected_action = ?,
      campaign_id = ?,
      media_campaign_id = ?,
      creative_id = ?,
      ad_slot_id = ?,
      qr_link_id = ?,
      duration_class = ?,
      variation_group = ?,
      improvement_reason = ?,
      previous_scene_id = ?,
      measurement_label = ?,
      data_source_class = ?,
      next_review_at = ?,
      updated_at = ?
    WHERE campaign_project_id = ?
  `).run(...values, cleanId(binding.campaign_project_id));
}

function assertStudioD1RowScope(input = {}, row = {}, label = "Record") {
  const scope = normalizeCampaignProjectScopeQuery(input || {});
  if (scope.tenant_id && scope.tenant_id !== cleanId(row.tenant_id)) throw requestError(`${label} is outside tenant scope`, 403);
  if (scope.store_id && scope.store_id !== cleanId(row.store_id)) throw requestError(`${label} is outside store scope`, 403);
  if (scope.screen_group_id && scope.screen_group_id !== cleanId(row.screen_group_id)) throw requestError(`${label} is outside screen group scope`, 403);
}

function listStudioProofOfPlayForProject(projectId, query = {}) {
  assertStudioD3RouteBoundary(query);
  const projectRow = getCampaignProjectRow(projectId);
  if (!projectRow) throw requestError("Campaign project not found", 404);
  if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
  const scope = normalizeCampaignProjectScopeQuery(query || {});
  if (scope.tenant_id || scope.store_id || scope.screen_group_id) {
    assertCampaignProjectInputScope(scope, projectRow, "Campaign project");
  }
  const sourceSystem = cleanString(query.source_system || query.sourceSystem);
  const evidenceLabel = cleanString(query.evidence_label || query.evidenceLabel);
  const includeInvalid = normalizeBooleanFlag(query.include_invalid || query.includeInvalid);
  const conditions = ["campaign_project_id = ?"];
  const params = [cleanId(projectId)];
  if (sourceSystem) {
    conditions.push("source_system = ?");
    params.push(sourceSystem);
  }
  if (evidenceLabel) {
    conditions.push("evidence_label = ?");
    params.push(evidenceLabel);
  }
  if (!includeInvalid) {
    conditions.push("validation_status = 'valid'");
  }
  const limit = Math.max(1, Math.min(asInteger(query.limit) || 100, 500));
  const rows = db.prepare(`
    SELECT * FROM studio_proof_of_play_bindings
    WHERE ${conditions.join(" AND ")}
    ORDER BY source_event_at DESC, id DESC
    LIMIT ?
  `).all(...params, limit);
  return rows.map(publicStudioProofOfPlayBinding);
}

function rebuildStudioProofOfPlayForProject(projectId, input = {}, actor = {}) {
  assertStudioD3RouteBoundary(input);
  return db.transaction(() => {
    const projectRow = getCampaignProjectRow(projectId);
    if (!projectRow) throw requestError("Campaign project not found", 404);
    if (projectRow.status === "deleted") throw requestError("Campaign project is deleted", 400);
    assertCampaignProjectInputScope(input, projectRow, "Campaign project");
    const now = nowIso();
    const bindingRows = db.prepare(`
      SELECT * FROM studio_measurement_bindings
      WHERE campaign_project_id = ?
        AND status != 'deleted'
        AND validation_status = 'valid'
      ORDER BY id ASC
      LIMIT 500
    `).all(projectRow.campaign_project_id);
    let playlogCount = 0;
    let qrScanCount = 0;
    let skippedCount = 0;

    for (const bindingRow of bindingRows) {
      const playlogRows = listStudioProofPlaylogSourceRows(bindingRow);
      const qrScanRows = listStudioProofQrScanSourceRows(bindingRow);
      if (playlogRows.length === 0 && qrScanRows.length === 0) skippedCount += 1;
      for (const sourceRow of playlogRows) {
        upsertStudioProofOfPlayRow(buildStudioProofOfPlayFromPlaylog(bindingRow, sourceRow), projectRow, bindingRow, now);
        playlogCount += 1;
      }
      for (const sourceRow of qrScanRows) {
        upsertStudioProofOfPlayRow(buildStudioProofOfPlayFromQrScan(bindingRow, sourceRow), projectRow, bindingRow, now);
        qrScanCount += 1;
      }
    }

    const summary = summarizeStudioProofOfPlay(projectRow.campaign_project_id);
    recordCampaignProjectEvent(projectRow.campaign_project_id, "", "proof_of_play.rebuilt", "admin", actor.actor_id || "admin", {
      binding_count: bindingRows.length,
      playlog_count: playlogCount,
      qr_scan_count: qrScanCount,
      skipped_binding_count: skippedCount,
      evidence_counts: summary.evidence_counts,
      no_roi_fabrication: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_player_device_mutation: true
    }, now);

    return {
      studio_proof_of_play_summary: summary,
      rebuild_result: {
        project_id: projectRow.campaign_project_id,
        binding_count: bindingRows.length,
        playlog_count: playlogCount,
        qr_scan_count: qrScanCount,
        skipped_binding_count: skippedCount,
        no_roi_fabrication: true,
        no_content_manifest_creation: true,
        no_publish: true,
        no_player_device_mutation: true
      }
    };
  })();
}

function getStudioProofOfPlayBinding(proofBindingId, scope = null) {
  const row = getStudioProofOfPlayBindingRow(proofBindingId);
  if (!row) return null;
  if (scope) assertStudioD1RowScope(scope, row, "Studio proof-of-play binding");
  return publicStudioProofOfPlayBinding(row);
}

function getStudioProofOfPlayBindingRow(proofBindingId) {
  return db.prepare("SELECT * FROM studio_proof_of_play_bindings WHERE proof_binding_id = ?").get(cleanId(proofBindingId));
}

function listStudioProofPlaylogSourceRows(bindingRow) {
  const matchClauses = [];
  const matchParams = [];
  for (const [column, value] of [
    ["qr_link_id", bindingRow.qr_link_id],
    ["creative_id", bindingRow.creative_id],
    ["ad_slot_id", bindingRow.ad_slot_id],
    ["campaign_id", bindingRow.campaign_id]
  ]) {
    const cleanValue = cleanId(value);
    if (!cleanValue) continue;
    matchClauses.push(`${column} = ?`);
    matchParams.push(cleanValue);
  }
  if (matchClauses.length === 0) return [];
  return db.prepare(`
    SELECT * FROM playlogs
    WHERE tenant_id = ?
      AND store_id = ?
      AND COALESCE(screen_group_id, '') = ?
      AND (${matchClauses.join(" OR ")})
    ORDER BY occurred_at ASC, id ASC
    LIMIT 1000
  `).all(
    cleanId(bindingRow.tenant_id),
    cleanId(bindingRow.store_id),
    cleanId(bindingRow.screen_group_id),
    ...matchParams
  );
}

function listStudioProofQrScanSourceRows(bindingRow) {
  const matchClauses = ["measurement_binding_id = ?"];
  const matchParams = [cleanId(bindingRow.measurement_binding_id)];
  for (const [column, value] of [
    ["qr_link_id", bindingRow.qr_link_id],
    ["creative_id", bindingRow.creative_id],
    ["ad_slot_id", bindingRow.ad_slot_id]
  ]) {
    const cleanValue = cleanId(value);
    if (!cleanValue) continue;
    matchClauses.push(`${column} = ?`);
    matchParams.push(cleanValue);
  }
  return db.prepare(`
    SELECT * FROM qr_scans
    WHERE tenant_id = ?
      AND store_id = ?
      AND COALESCE(screen_group_id, '') = ?
      AND (${matchClauses.join(" OR ")})
    ORDER BY scanned_at ASC, id ASC
    LIMIT 1000
  `).all(
    cleanId(bindingRow.tenant_id),
    cleanId(bindingRow.store_id),
    cleanId(bindingRow.screen_group_id),
    ...matchParams
  );
}

function buildStudioProofOfPlayFromPlaylog(bindingRow, sourceRow) {
  const sourceEventId = cleanString(sourceRow.event_id) || `playlog:${asInteger(sourceRow.id)}`;
  return {
    proof_binding_id: nextEntityId("pop", `${bindingRow.measurement_binding_id}-playlog-${sourceEventId}`),
    tenant_id: bindingRow.tenant_id,
    store_id: bindingRow.store_id,
    screen_group_id: bindingRow.screen_group_id,
    measurement_binding_id: bindingRow.measurement_binding_id,
    campaign_project_id: bindingRow.campaign_project_id,
    campaign_project_scene_id: bindingRow.campaign_project_scene_id,
    campaign_id: cleanId(sourceRow.campaign_id) || cleanId(bindingRow.campaign_id),
    media_campaign_id: bindingRow.media_campaign_id,
    creative_id: cleanId(sourceRow.creative_id) || cleanId(bindingRow.creative_id),
    ad_slot_id: cleanId(sourceRow.ad_slot_id) || cleanId(bindingRow.ad_slot_id),
    qr_link_id: cleanId(sourceRow.qr_link_id) || cleanId(bindingRow.qr_link_id),
    source_system: "playlog",
    source_event_id: sourceEventId,
    source_row_id: asInteger(sourceRow.id),
    source_event_at: cleanString(sourceRow.occurred_at || sourceRow.played_at || sourceRow.received_at),
    evidence_label: "measured_play_evidence",
    measurement_label: cleanString(bindingRow.measurement_label),
    data_source_class: cleanString(bindingRow.data_source_class),
    source_data_class: "misell_playlog",
    attribution_claim: "",
    baseline_evidence_ref: cleanString(bindingRow.baseline_evidence_ref),
    holdout_evidence_ref: cleanString(bindingRow.holdout_evidence_ref),
    manifest_hash: cleanString(sourceRow.manifest_hash),
    playlist_item_id: cleanId(sourceRow.playlist_item_id),
    play_result: cleanString(sourceRow.result),
    planned_duration_seconds: asInteger(sourceRow.planned_duration_seconds),
    played_duration_seconds: asInteger(sourceRow.played_duration_seconds),
    qr_scan_id: "",
    rebuild_key: `d3:${bindingRow.measurement_binding_id}`,
    source_ref: {
      table: "playlogs",
      id: asInteger(sourceRow.id),
      event_id: sourceEventId,
      device_id: cleanId(sourceRow.device_id),
      playback_id: cleanId(sourceRow.playback_id)
    }
  };
}

function buildStudioProofOfPlayFromQrScan(bindingRow, sourceRow) {
  const qrScanId = cleanId(sourceRow.qr_scan_id) || `qr-scan-${asInteger(sourceRow.id)}`;
  return {
    proof_binding_id: nextEntityId("pop", `${bindingRow.measurement_binding_id}-qr-${qrScanId}`),
    tenant_id: bindingRow.tenant_id,
    store_id: bindingRow.store_id,
    screen_group_id: bindingRow.screen_group_id,
    measurement_binding_id: bindingRow.measurement_binding_id,
    campaign_project_id: bindingRow.campaign_project_id,
    campaign_project_scene_id: cleanId(sourceRow.campaign_project_scene_id) || cleanId(bindingRow.campaign_project_scene_id),
    campaign_id: cleanId(sourceRow.campaign_id) || cleanId(bindingRow.campaign_id),
    media_campaign_id: cleanId(sourceRow.media_campaign_id) || cleanId(bindingRow.media_campaign_id),
    creative_id: cleanId(sourceRow.creative_id) || cleanId(bindingRow.creative_id),
    ad_slot_id: cleanId(sourceRow.ad_slot_id) || cleanId(bindingRow.ad_slot_id),
    qr_link_id: cleanId(sourceRow.qr_link_id) || cleanId(bindingRow.qr_link_id),
    source_system: "qr_scan",
    source_event_id: qrScanId,
    source_row_id: asInteger(sourceRow.id),
    source_event_at: cleanString(sourceRow.scanned_at),
    evidence_label: "measured_response_only",
    measurement_label: cleanString(sourceRow.measurement_label || bindingRow.measurement_label),
    data_source_class: cleanString(sourceRow.data_source_class || bindingRow.data_source_class),
    source_data_class: "misell_qr",
    attribution_claim: "measured_response_only",
    baseline_evidence_ref: cleanString(bindingRow.baseline_evidence_ref),
    holdout_evidence_ref: cleanString(bindingRow.holdout_evidence_ref),
    manifest_hash: "",
    playlist_item_id: "",
    play_result: "",
    planned_duration_seconds: 0,
    played_duration_seconds: 0,
    qr_scan_id: qrScanId,
    rebuild_key: `d3:${bindingRow.measurement_binding_id}`,
    source_ref: {
      table: "qr_scans",
      id: asInteger(sourceRow.id),
      qr_scan_id: qrScanId,
      qr_link_id: cleanId(sourceRow.qr_link_id),
      visit_id: cleanId(sourceRow.visit_id)
    }
  };
}

function upsertStudioProofOfPlayRow(input, projectRow, measurementBindingRow, now = nowIso()) {
  const normalized = normalizeStudioD3ProofOfPlayBinding(input, {});
  const validation = validateProofOfPlayBindingContract(normalized, {
    project: projectRow,
    measurement_binding: measurementBindingRow
  });
  assertNoStudioD3HardBlockers(validation);
  const proofBindingId = normalized.proof_binding_id || nextEntityId("pop", `${normalized.measurement_binding_id}-${normalized.source_system}-${normalized.source_event_id}`);
  db.prepare(`
    INSERT INTO studio_proof_of_play_bindings (
      proof_binding_id, tenant_id, store_id, screen_group_id, measurement_binding_id,
      campaign_project_id, campaign_project_scene_id, campaign_id, media_campaign_id,
      creative_id, ad_slot_id, qr_link_id, source_system, source_event_id,
      source_row_id, source_event_at, evidence_label, measurement_label,
      data_source_class, source_data_class, attribution_claim, baseline_evidence_ref,
      holdout_evidence_ref, manifest_hash, playlist_item_id, play_result,
      planned_duration_seconds, played_duration_seconds, qr_scan_id, source_ref_json,
      rebuild_key, validation_status, validation_errors_json, validation_checks_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(measurement_binding_id, source_system, source_event_id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      store_id = excluded.store_id,
      screen_group_id = excluded.screen_group_id,
      campaign_project_id = excluded.campaign_project_id,
      campaign_project_scene_id = excluded.campaign_project_scene_id,
      campaign_id = excluded.campaign_id,
      media_campaign_id = excluded.media_campaign_id,
      creative_id = excluded.creative_id,
      ad_slot_id = excluded.ad_slot_id,
      qr_link_id = excluded.qr_link_id,
      source_row_id = excluded.source_row_id,
      source_event_at = excluded.source_event_at,
      evidence_label = excluded.evidence_label,
      measurement_label = excluded.measurement_label,
      data_source_class = excluded.data_source_class,
      source_data_class = excluded.source_data_class,
      attribution_claim = excluded.attribution_claim,
      baseline_evidence_ref = excluded.baseline_evidence_ref,
      holdout_evidence_ref = excluded.holdout_evidence_ref,
      manifest_hash = excluded.manifest_hash,
      playlist_item_id = excluded.playlist_item_id,
      play_result = excluded.play_result,
      planned_duration_seconds = excluded.planned_duration_seconds,
      played_duration_seconds = excluded.played_duration_seconds,
      qr_scan_id = excluded.qr_scan_id,
      source_ref_json = excluded.source_ref_json,
      rebuild_key = excluded.rebuild_key,
      validation_status = excluded.validation_status,
      validation_errors_json = excluded.validation_errors_json,
      validation_checks_json = excluded.validation_checks_json,
      updated_at = excluded.updated_at
  `).run(
    proofBindingId,
    normalized.tenant_id,
    normalized.store_id,
    normalized.screen_group_id,
    normalized.measurement_binding_id,
    normalized.campaign_project_id,
    normalized.campaign_project_scene_id,
    normalized.campaign_id,
    normalized.media_campaign_id,
    normalized.creative_id,
    normalized.ad_slot_id,
    normalized.qr_link_id,
    normalized.source_system,
    normalized.source_event_id,
    normalized.source_row_id,
    normalized.source_event_at,
    normalized.evidence_label,
    normalized.measurement_label,
    normalized.data_source_class,
    normalized.source_data_class,
    normalized.attribution_claim,
    normalized.baseline_evidence_ref,
    normalized.holdout_evidence_ref,
    normalized.manifest_hash,
    normalized.playlist_item_id,
    normalized.play_result,
    normalized.planned_duration_seconds,
    normalized.played_duration_seconds,
    normalized.qr_scan_id,
    safeJsonStringify(normalized.source_ref, 10000),
    normalized.rebuild_key,
    validation.valid ? "valid" : "invalid",
    safeJsonStringify(validation.errors, 10000),
    safeJsonStringify(validation.checks, 20000),
    now,
    now
  );
}

function summarizeStudioProofOfPlay(projectId) {
  const rows = db.prepare(`
    SELECT source_system, evidence_label, COUNT(*) AS count
    FROM studio_proof_of_play_bindings
    WHERE campaign_project_id = ?
      AND validation_status = 'valid'
    GROUP BY source_system, evidence_label
    ORDER BY source_system ASC, evidence_label ASC
  `).all(cleanId(projectId));
  const evidenceCounts = {
    measured_play_evidence: 0,
    measured_response_only: 0
  };
  for (const row of rows) {
    evidenceCounts[cleanString(row.evidence_label)] = asInteger(row.count);
  }
  return {
    schema_version: "studio-proof-of-play-summary/d3",
    proof_binding_version: PROOF_OF_PLAY_BINDING_VERSION,
    campaign_project_id: cleanId(projectId),
    evidence_counts: evidenceCounts,
    source_breakdown: rows.map((row) => ({
      source_system: cleanString(row.source_system),
      evidence_label: cleanString(row.evidence_label),
      count: asInteger(row.count)
    })),
    qr_scan_is_measured_response_only: true,
    playlog_is_measured_play_evidence_only: true,
    no_roi_fabrication: true,
    no_content_manifest_creation: true,
    no_publish: true,
    no_player_device_mutation: true
  };
}

function publicStudioProofOfPlayBinding(row) {
  return {
    schema_version: "studio-proof-of-play-binding/d3",
    binding_version: PROOF_OF_PLAY_BINDING_VERSION,
    proof_binding_id: cleanId(row.proof_binding_id),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    measurement_binding_id: cleanId(row.measurement_binding_id),
    campaign_project_id: cleanId(row.campaign_project_id),
    campaign_project_scene_id: cleanId(row.campaign_project_scene_id),
    campaign_id: cleanId(row.campaign_id),
    media_campaign_id: cleanId(row.media_campaign_id),
    creative_id: cleanId(row.creative_id),
    ad_slot_id: cleanId(row.ad_slot_id),
    qr_link_id: cleanId(row.qr_link_id),
    source_system: cleanString(row.source_system),
    source_event_id: cleanString(row.source_event_id),
    source_row_id: asInteger(row.source_row_id),
    source_event_at: cleanString(row.source_event_at),
    evidence_label: cleanString(row.evidence_label),
    measurement_label: cleanString(row.measurement_label),
    data_source_class: cleanString(row.data_source_class),
    source_data_class: cleanString(row.source_data_class),
    attribution_claim: cleanString(row.attribution_claim),
    baseline_evidence_ref: cleanString(row.baseline_evidence_ref),
    holdout_evidence_ref: cleanString(row.holdout_evidence_ref),
    manifest_hash: cleanString(row.manifest_hash),
    playlist_item_id: cleanId(row.playlist_item_id),
    play_result: cleanString(row.play_result),
    planned_duration_seconds: asInteger(row.planned_duration_seconds),
    played_duration_seconds: asInteger(row.played_duration_seconds),
    qr_scan_id: cleanId(row.qr_scan_id),
    source_ref: parseJson(row.source_ref_json || "{}", {}),
    rebuild_key: cleanString(row.rebuild_key),
    validation_status: cleanString(row.validation_status),
    validation_errors: parseJson(row.validation_errors_json || "[]", []),
    validation_checks: parseJson(row.validation_checks_json || "[]", []),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at),
    qr_scan_is_measured_response_only: row.evidence_label === "measured_response_only",
    playlog_is_measured_play_evidence_only: row.evidence_label === "measured_play_evidence",
    no_roi_fabrication: true,
    no_content_manifest_creation: true,
    no_publish: true,
    no_player_device_mutation: true
  };
}

function normalizeStudioD3ProofOfPlayBinding(input, defaults) {
  try {
    return normalizeProofOfPlayBindingInput(input, defaults);
  } catch (error) {
    throw requestError(error.message || "Studio proof-of-play binding input is invalid", 400);
  }
}

function assertStudioD3RouteBoundary(input = {}) {
  try {
    assertStudioD3InputBoundary(input);
  } catch (error) {
    throw requestError(error.message || "Studio Execution D3 input is out of scope", 400);
  }
}

function assertNoStudioD3HardBlockers(validation) {
  if (!validation.valid) {
    throw requestError(`Proof-of-play contract is invalid: ${validation.errors.map((error) => `${error.field}:${error.code}`).join(", ")}`, 400);
  }
}

function listStudioRenderQaResults(renderManifestId) {
  return db.prepare(`
    SELECT * FROM studio_render_qa_results
    WHERE render_manifest_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 20
  `).all(cleanId(renderManifestId)).map(publicStudioRenderQaResult);
}

function normalizeStructuredJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    const parsed = parseJson(value, null);
    return parsed === null ? { text: cleanText(value).slice(0, 5000) } : parsed;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;
  return fallback;
}

function safeJsonStringify(value, maxBytes) {
  const json = JSON.stringify(value ?? {});
  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    throw requestError(`JSON payload must be ${maxBytes} bytes or less`, 413);
  }
  return json;
}

function recordCustomerLoginAudit(access, action, req, metadata = {}, createdAt = nowIso()) {
  recordAuditLog("customer", access.customer_access_token_id, action, "customer_access_token", access.customer_access_token_id, null, null, {
    tenant_id: access.tenant_id,
    role: access.role,
    store_ids: access.store_ids || [],
    ip_hash: hashToken(`${req.ip || ""}:${DEVICE_TOKEN_PEPPER}`),
    user_agent: cleanString(req.get("user-agent")).slice(0, 500),
    ...metadata
  }, createdAt);
}

function generateCustomerAccessToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashCustomerAccessToken(token) {
  return hashCustomerSecret("customer-access-token", token);
}

function hashCustomerPin(customerAccessTokenId, pin) {
  return hashCustomerSecret(`customer-pin:${customerAccessTokenId}`, pin);
}

function hashCustomerSessionToken(token) {
  return hashCustomerSecret("customer-session", token);
}

function hashCustomerSecret(scope, value) {
  return crypto
    .createHmac("sha256", CUSTOMER_ACCESS_TOKEN_PEPPER)
    .update(`${scope}:${value}`)
    .digest("hex");
}

function generateStoreAccessToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashStoreAccessToken(token) {
  return hashStoreSecret("store-access-token", token);
}

function hashStoreStaffPin(storeAccessTokenId, pin) {
  return hashStoreSecret(`store-staff-pin:${storeAccessTokenId}`, pin);
}

function hashStoreStaffSessionToken(token) {
  return hashStoreSecret("store-staff-session", token);
}

function hashStoreSecret(scope, value) {
  return crypto
    .createHmac("sha256", STORE_ACCESS_TOKEN_PEPPER)
    .update(`${scope}:${value}`)
    .digest("hex");
}

function normalizeReportCriteria(input = {}) {
  const month = cleanMonthKey(input.month || input.period_month || input.periodMonth);
  let from = cleanDateKey(input.from || input.period_start || input.start_date || input.startDate);
  let to = cleanDateKey(input.to || input.period_end || input.end_date || input.endDate);

  if (month && (!from || !to)) {
    const bounds = monthBounds(month);
    from = from || bounds.from;
    to = to || bounds.to;
  }

  if (!from && !to) {
    const bounds = monthBounds(nowIso().slice(0, 7));
    from = bounds.from;
    to = bounds.to;
  } else if (!from) {
    from = to;
  } else if (!to) {
    to = from;
  }

  if (!from || !to) throw requestError("from/to or month is required", 400);
  if (to < from) throw requestError("to must be on or after from", 400);
  const toExclusive = addDaysToDateKey(to, 1);
  const days = dateKeysBetween(from, toExclusive);
  if (days.length > 370) throw requestError("report period must be 370 days or less", 400);

  return {
    from,
    to,
    to_exclusive: toExclusive,
    month: month || (from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : ""),
    days,
    tenant_id: cleanId(input.tenant_id || input.tenantId),
    store_id: cleanId(input.store_id || input.storeId || input.site_id || input.siteId),
    campaign_id: cleanId(input.campaign_id || input.campaignId),
    content_id: cleanId(input.content_id || input.contentId),
    item_type: normalizeReportItemTypeFilter(input.item_type || input.itemType || input.type),
    ad_slot_id: cleanId(input.ad_slot_id || input.adSlotId),
    creative_id: cleanId(input.creative_id || input.creativeId),
    qr_link_id: cleanId(input.qr_link_id || input.qrLinkId),
    manifest_hash: cleanString(input.manifest_hash || input.content_manifest_hash || input.contentManifestHash).slice(0, 160),
    heartbeat_interval_minutes: REPORT_HEARTBEAT_INTERVAL_MINUTES
  };
}

function normalizeReportSnapshotListFilters(input = {}) {
  return {
    month: cleanMonthKey(input.month || input.period_month || input.periodMonth),
    tenant_id: cleanId(input.tenant_id || input.tenantId),
    store_id: cleanId(input.store_id || input.storeId || input.site_id || input.siteId),
    campaign_id: cleanId(input.campaign_id || input.campaignId),
    content_id: cleanId(input.content_id || input.contentId),
    status: cleanString(input.status),
    report_type: cleanString(input.report_type || input.reportType || "monthly_summary"),
    limit: Math.max(1, Math.min(asInteger(input.limit) || 50, 200))
  };
}

function normalizeContentFreshnessCriteria(input = {}) {
  const releaseChannel = cleanString(input.release_channel || input.releaseChannel);
  if (releaseChannel && !RELEASE_CHANNELS.has(releaseChannel)) {
    throw requestError(`release_channel must be one of: ${Array.from(RELEASE_CHANNELS).join(", ")}`, 400);
  }
  const status = cleanString(input.status);
  if (status && !CONTENT_MANIFEST_STATUS.has(status)) {
    throw requestError(`status must be one of: ${Array.from(CONTENT_MANIFEST_STATUS).join(", ")}`, 400);
  }
  return {
    tenant_id: cleanId(input.tenant_id || input.tenantId),
    store_id: cleanId(input.store_id || input.storeId || input.site_id || input.siteId),
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId || input.display_wall_id || input.displayWallId),
    release_channel: releaseChannel,
    status,
    now: requestNowIso(input),
    review_due_days: CONTENT_FRESHNESS_REVIEW_DUE_DAYS,
    stale_days: CONTENT_FRESHNESS_STALE_DAYS,
    limit: Math.max(1, Math.min(asInteger(input.limit) || CONTENT_FRESHNESS_REPORT_LIMIT, CONTENT_FRESHNESS_REPORT_LIMIT))
  };
}

function normalizeAdvertiserReportPreviewCriteria(input = {}) {
  const criteria = normalizeReportCriteria(input);
  if (!criteria.tenant_id) throw requestError("tenant_id is required for advertiser preview", 400);
  if (!criteria.campaign_id) throw requestError("campaign_id is required for advertiser preview", 400);
  return criteria;
}

function normalizeAdInventoryReportCriteria(input = {}) {
  const criteria = normalizeReportCriteria(input);
  if (!criteria.tenant_id) throw requestError("tenant_id is required for ad inventory report", 400);
  const releaseChannel = cleanString(input.release_channel || input.releaseChannel);
  if (releaseChannel && !RELEASE_CHANNELS.has(releaseChannel)) {
    throw requestError(`release_channel must be one of: ${Array.from(RELEASE_CHANNELS).join(", ")}`, 400);
  }
  const status = cleanString(input.status || "active");
  if (!CONTENT_MANIFEST_STATUS.has(status)) {
    throw requestError(`status must be one of: ${Array.from(CONTENT_MANIFEST_STATUS).join(", ")}`, 400);
  }
  return {
    ...criteria,
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId || input.display_wall_id || input.displayWallId),
    release_channel: releaseChannel,
    status,
    limit: Math.max(1, Math.min(asInteger(input.limit) || AD_INVENTORY_REPORT_LIMIT, AD_INVENTORY_REPORT_LIMIT))
  };
}

function normalizeHostRoiPreviewCriteria(input = {}) {
  const criteria = normalizeAdInventoryReportCriteria(input);
  if (!criteria.store_id) throw requestError("store_id is required for host ROI preview", 400);
  return criteria;
}

function buildReportSummary(criteria, options = {}) {
  const generatedAt = cleanString(options.generatedAt) || nowIso();
  const rows = (options.dailyRows || aggregateReportDailyStoreMetrics(criteria).rows).map(publicReportDailyStoreMetric);
  const daily = summarizeReportRowsByDate(criteria, rows);
  const totals = summarizeReportMetricRows(rows);
  return {
    report_type: "summary",
    generated_at: generatedAt,
    source: options.dailyRows ? "report_daily_store_metrics" : "live_events",
    period: {
      from: criteria.from,
      to: criteria.to,
      to_exclusive: criteria.to_exclusive,
      days: criteria.days.length
    },
    filters: reportCriteriaFilters(criteria),
    totals,
    daily,
    content: buildReportContentBreakdown(criteria),
    ad_measurement: buildReportAdMeasurementBreakdown(criteria),
    qr_links: buildReportQrBreakdown(criteria),
    counter_orders: buildReportOrderBreakdown(criteria)
  };
}

function buildContentFreshnessReport(criteria) {
  const rows = listContentFreshnessManifestRows(criteria)
    .map((row) => buildContentFreshnessRow(row, criteria));
  return {
    report_type: "content_freshness",
    generated_at: criteria.now,
    filters: {
      tenant_id: criteria.tenant_id,
      store_id: criteria.store_id,
      screen_group_id: criteria.screen_group_id,
      release_channel: criteria.release_channel,
      status: criteria.status,
      limit: criteria.limit
    },
    thresholds: {
      review_due_days: criteria.review_due_days,
      stale_days: criteria.stale_days
    },
    summary: summarizeContentFreshnessRows(rows),
    content: rows
  };
}

function listContentFreshnessManifestRows(criteria) {
  return db.prepare(`
    SELECT * FROM content_manifests
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR screen_group_id = ?)
      AND (? = '' OR release_channel = ?)
      AND (? = '' OR status = ?)
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      updated_at DESC,
      id DESC
    LIMIT ?
  `).all(
    criteria.tenant_id,
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id,
    criteria.screen_group_id,
    criteria.screen_group_id,
    criteria.release_channel,
    criteria.release_channel,
    criteria.status,
    criteria.status,
    criteria.limit
  );
}

function buildContentFreshnessRow(row, criteria) {
  const playlist = parseJson(row.playlist_json, {});
  const playlistStats = summarizeFreshnessPlaylist(playlist);
  const lastPlay = latestPlaylogForContent(row);
  const updatedAt = cleanString(row.updated_at || row.published_at || row.created_at);
  const daysSinceUpdate = daysSinceIso(criteria.now, updatedAt);
  const freshnessStatus = contentFreshnessStatus(row.status, daysSinceUpdate, criteria);
  const playSignalStatus = lastPlay.playlog_count > 0 ? "played" : "not_played";
  const reasons = contentFreshnessReasons({
    row,
    daysSinceUpdate,
    freshnessStatus,
    playSignalStatus,
    playlistStats,
    criteria
  });
  return {
    content_id: cleanString(row.content_id),
    playlist_version: cleanString(row.playlist_version),
    release_channel: cleanString(row.release_channel),
    status: cleanString(row.status),
    title: cleanString(row.title),
    tenant_id: cleanString(row.tenant_id),
    store_id: cleanString(row.store_id),
    screen_group_id: cleanString(row.screen_group_id),
    screen_slot_id: cleanString(row.screen_slot_id),
    manifest_version: asInteger(row.manifest_version) || 1,
    content_hash: cleanString(row.content_hash),
    created_at: cleanString(row.created_at),
    updated_at: updatedAt,
    published_at: cleanString(row.published_at),
    next_review_at: updatedAt ? addDaysToIso(updatedAt, criteria.review_due_days) : "",
    days_since_update: daysSinceUpdate,
    freshness_status: freshnessStatus,
    freshness_score: contentFreshnessScore(row.status, daysSinceUpdate, criteria.stale_days),
    play_signal_status: playSignalStatus,
    last_played_at: lastPlay.last_played_at,
    playlog_count: lastPlay.playlog_count,
    stale_reasons: reasons,
    playlist: playlistStats
  };
}

function summarizeFreshnessPlaylist(playlist) {
  const items = Array.isArray(playlist?.items) ? playlist.items : [];
  const stats = {
    item_count: items.length,
    content_item_count: 0,
    ad_item_count: 0,
    sponsor_item_count: 0,
    unknown_item_count: 0,
    campaign_linked_item_count: 0,
    qr_linked_item_count: 0,
    always_on_count: 0,
    campaign_refresh_count: 0,
    realtime_context_count: 0
  };
  for (const item of items) {
    const itemType = normalizeFreshnessItemType(item?.item_type || item?.type);
    if (itemType === "ad") stats.ad_item_count += 1;
    else if (itemType === "sponsor") stats.sponsor_item_count += 1;
    else if (itemType === "content") stats.content_item_count += 1;
    else stats.unknown_item_count += 1;
    if (cleanId(item?.campaign_id || item?.campaignId)) stats.campaign_linked_item_count += 1;
    if (cleanId(item?.qr_link_id || item?.qrLinkId)) stats.qr_linked_item_count += 1;
    const layer = cleanString(item?.content_layer || item?.contentLayer);
    if (layer === "always_on") stats.always_on_count += 1;
    if (layer === "campaign_refresh") stats.campaign_refresh_count += 1;
    if (layer === "realtime_context") stats.realtime_context_count += 1;
  }
  return stats;
}

function normalizeFreshnessItemType(value) {
  const itemType = cleanString(value).toLowerCase();
  return ["content", "ad", "sponsor"].includes(itemType) ? itemType : "content";
}

function latestPlaylogForContent(manifest) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS playlog_count,
      MAX(COALESCE(NULLIF(occurred_at, ''), NULLIF(played_at, ''), received_at)) AS last_played_at
    FROM playlogs
    WHERE content_id = ?
      AND tenant_id = ?
      AND store_id = ?
      AND (? = '' OR screen_group_id = ?)
  `).get(
    cleanId(manifest.content_id),
    cleanId(manifest.tenant_id),
    cleanId(manifest.store_id),
    cleanId(manifest.screen_group_id),
    cleanId(manifest.screen_group_id)
  ) || {};
  return {
    playlog_count: asInteger(row.playlog_count) || 0,
    last_played_at: cleanString(row.last_played_at)
  };
}

function contentFreshnessStatus(status, daysSinceUpdate, criteria) {
  const manifestStatus = cleanString(status);
  if (manifestStatus === "retired") return "inactive";
  if (daysSinceUpdate === null) return "review_due";
  if (daysSinceUpdate >= criteria.stale_days) return "stale";
  if (daysSinceUpdate >= criteria.review_due_days) return "review_due";
  return "fresh";
}

function contentFreshnessScore(status, daysSinceUpdate, staleDays) {
  if (cleanString(status) === "retired") return 0;
  if (daysSinceUpdate === null) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - ((daysSinceUpdate / staleDays) * 100))));
}

function contentFreshnessReasons({ row, daysSinceUpdate, freshnessStatus, playSignalStatus, playlistStats, criteria }) {
  const reasons = [];
  if (freshnessStatus === "stale") reasons.push("unchanged_over_stale_threshold");
  else if (freshnessStatus === "review_due") reasons.push("review_due");
  if (playSignalStatus === "not_played" && cleanString(row.status) === "active") reasons.push("no_play_signal");
  if (playlistStats.item_count === 0) reasons.push("empty_playlist");
  if (playlistStats.campaign_refresh_count === 0 && playlistStats.ad_item_count + playlistStats.sponsor_item_count > 0) {
    reasons.push("ad_or_sponsor_without_campaign_refresh_layer");
  }
  if (daysSinceUpdate !== null && daysSinceUpdate >= criteria.review_due_days) {
    reasons.push(`unchanged_days:${daysSinceUpdate}`);
  }
  return reasons;
}

function summarizeContentFreshnessRows(rows) {
  const summary = {
    total: rows.length,
    fresh: 0,
    review_due: 0,
    stale: 0,
    inactive: 0,
    active: 0,
    draft: 0,
    retired: 0,
    not_played: 0,
    ad_or_sponsor_items: 0,
    campaign_refresh_items: 0
  };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.freshness_status)) summary[row.freshness_status] += 1;
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) summary[row.status] += 1;
    if (row.play_signal_status === "not_played") summary.not_played += 1;
    summary.ad_or_sponsor_items += row.playlist.ad_item_count + row.playlist.sponsor_item_count;
    summary.campaign_refresh_items += row.playlist.campaign_refresh_count;
  }
  return summary;
}

function buildAdvertiserReportPreview(criteria) {
  const summary = buildReportSummary(criteria);
  const totals = summary.totals;
  const proofOfPlay = {
    measurement_label: "measured",
    play_started_count: totals.play_started_count,
    play_completed_count: totals.play_completed_count,
    play_failed_count: totals.play_failed_count,
    play_duration_seconds: totals.play_duration_seconds,
    completion_rate: measuredRatio(totals.play_completed_count, totals.play_started_count)
  };
  const response = {
    measurement_label: "measured",
    qr_scan_count: totals.qr_scan_count,
    qr_scans_per_play_started: measuredRatio(totals.qr_scan_count, totals.play_started_count),
    denominator: "play_started_count"
  };
  const conversion = {
    measurement_label: "measured",
    counter_orders_issued_count: totals.counter_orders_issued_count,
    counter_orders_redeemed_count: totals.counter_orders_redeemed_count,
    counter_order_total_amount: totals.counter_order_total_amount,
    counter_order_redeemed_amount: totals.counter_order_redeemed_amount,
    order_issue_per_qr_scan: measuredRatio(totals.counter_orders_issued_count, totals.qr_scan_count),
    order_to_redeem_rate: measuredRatio(totals.counter_orders_redeemed_count, totals.counter_orders_issued_count)
  };
  const report = {
    report_type: "advertiser_campaign_preview",
    surface: "admin_internal_preview",
    generated_at: summary.generated_at,
    source: summary.source,
    period: summary.period,
    filters: summary.filters,
    measurement_policy: {
      proof_of_play: "measured",
      qr_response: "measured",
      counter_order: "measured",
      roi_attribution: "not_reported",
      roas_guarantee: "not_reported",
      incremental_lift: "not_reported",
      claim_boundary: "Misell rail evidence only; no incremental ROI, sales, visit, ROAS, or performance guarantee claim."
    },
    proof_of_play: proofOfPlay,
    response,
    conversion,
    breakdowns: {
      ad_measurement: summary.ad_measurement.map(publicAdvertiserPreviewAdMeasurement),
      qr_links: summary.qr_links.map(publicAdvertiserPreviewQrLink),
      counter_orders: summary.counter_orders.map(publicAdvertiserPreviewCounterOrder)
    },
    daily: summary.daily,
    decision_prompts: []
  };
  report.decision_prompts = buildAdvertiserPreviewDecisionPrompts(report);
  return report;
}

function publicAdvertiserPreviewAdMeasurement(item) {
  return {
    measurement_label: "measured",
    store_id: cleanId(item.store_id),
    campaign_id: cleanId(item.campaign_id),
    content_id: cleanId(item.content_id),
    item_type: cleanString(item.item_type),
    ad_slot_id: cleanId(item.ad_slot_id),
    creative_id: cleanId(item.creative_id),
    qr_link_id: cleanId(item.qr_link_id),
    manifest_hash: cleanString(item.manifest_hash),
    playlist_version: cleanString(item.playlist_version),
    playlist_item_id: cleanString(item.playlist_item_id),
    play_started_count: asInteger(item.play_started_count) || 0,
    play_completed_count: asInteger(item.play_completed_count) || 0,
    play_failed_count: asInteger(item.play_failed_count) || 0,
    planned_duration_seconds: asInteger(item.planned_duration_seconds) || 0,
    played_duration_seconds: asInteger(item.played_duration_seconds) || 0,
    qr_scan_count: asInteger(item.qr_scan_count) || 0,
    qr_response_rate: Number(item.qr_response_rate) || 0
  };
}

function publicAdvertiserPreviewQrLink(item) {
  return {
    measurement_label: "measured",
    store_id: cleanId(item.store_id),
    qr_link_id: cleanId(item.qr_link_id),
    label: cleanString(item.label),
    destination_type: cleanString(item.destination_type),
    campaign_id: cleanId(item.campaign_id),
    content_id: cleanId(item.content_id),
    offer_id: cleanId(item.offer_id),
    offer_revision_id: cleanId(item.offer_revision_id),
    qr_scan_count: asInteger(item.qr_scan_count) || 0
  };
}

function publicAdvertiserPreviewCounterOrder(item) {
  return {
    measurement_label: "measured",
    store_id: cleanId(item.store_id),
    campaign_id: cleanId(item.campaign_id),
    content_id: cleanId(item.content_id),
    offer_id: cleanId(item.offer_id),
    offer_revision_id: cleanId(item.offer_revision_id),
    issued_count: asInteger(item.issued_count) || 0,
    redeemed_count: asInteger(item.redeemed_count) || 0,
    cancelled_count: asInteger(item.cancelled_count) || 0,
    expired_count: asInteger(item.expired_count) || 0,
    total_amount: asInteger(item.total_amount) || 0,
    redeemed_amount: asInteger(item.redeemed_amount) || 0
  };
}

function buildAdvertiserPreviewDecisionPrompts(report) {
  const prompts = [];
  const proof = report.proof_of_play;
  const response = report.response;
  const conversion = report.conversion;
  if (proof.play_started_count <= 0) {
    prompts.push(advertiserPreviewDecisionPrompt("check_delivery", "high", "No measured play_started events for this campaign scope."));
  }
  if (proof.play_failed_count > 0) {
    prompts.push(advertiserPreviewDecisionPrompt("check_playback_failures", "high", "Measured playback failures exist for this campaign scope."));
  }
  if (proof.play_started_count > 0 && response.qr_scan_count <= 0) {
    prompts.push(advertiserPreviewDecisionPrompt("review_qr_cta", "medium", "Measured plays exist but QR response is zero."));
  }
  if (response.qr_scan_count > 0 && conversion.counter_orders_issued_count <= 0) {
    prompts.push(advertiserPreviewDecisionPrompt("review_offer_or_landing", "medium", "Measured QR response exists but no Misell counter order was issued."));
  }
  if (conversion.counter_orders_issued_count > 0 && conversion.counter_orders_redeemed_count <= 0) {
    prompts.push(advertiserPreviewDecisionPrompt("review_redemption_flow", "medium", "Measured orders were issued but none were redeemed."));
  }
  if (report.breakdowns.ad_measurement.length === 0) {
    prompts.push(advertiserPreviewDecisionPrompt("confirm_ad_measurement_fields", "medium", "No ad measurement breakdown rows were found for this campaign scope."));
  }
  if (prompts.length === 0) {
    prompts.push(advertiserPreviewDecisionPrompt("continue_with_refresh_hypothesis", "low", "Measured play, response, and order signals exist; review creative, CTA, slot, and period as the next operator decision."));
  }
  return prompts;
}

function advertiserPreviewDecisionPrompt(decisionKey, priority, reason) {
  return {
    decision_key: decisionKey,
    priority,
    reason,
    authority: "operator_decision_required",
    claim_boundary: "guidance_only_no_performance_guarantee"
  };
}

function buildAdInventoryReport(criteria) {
  const generatedAt = nowIso();
  const entries = listAdInventoryManifestRows(criteria).flatMap((row) => adInventoryEntriesFromManifest(row, criteria));
  const groups = buildAdInventorySlotGroups(entries);
  applyAdInventoryMeasurements(groups, buildReportAdMeasurementBreakdown(criteria));
  const allSlots = Array.from(groups.values())
    .map(finalizeAdInventorySlot)
    .sort((a, b) => {
      const byStore = a.store_id.localeCompare(b.store_id);
      if (byStore !== 0) return byStore;
      const byGroup = a.screen_group_id.localeCompare(b.screen_group_id);
      if (byGroup !== 0) return byGroup;
      return a.ad_slot_id.localeCompare(b.ad_slot_id);
    });
  const slots = allSlots.slice(0, criteria.limit);
  return {
    report_type: "ad_inventory",
    surface: "admin_internal_read_model",
    generated_at: generatedAt,
    source: {
      inventory: "content_manifests.playlist_json",
      proof_of_play: "playlogs",
      qr_response: "qr_scans"
    },
    period: {
      from: criteria.from,
      to: criteria.to,
      to_exclusive: criteria.to_exclusive,
      days: criteria.days.length
    },
    filters: {
      ...reportCriteriaFilters(criteria),
      screen_group_id: criteria.screen_group_id,
      release_channel: criteria.release_channel,
      status: criteria.status,
      limit: criteria.limit
    },
    measurement_policy: {
      inventory: "manifest_derived",
      fill_rate: "manifest_derived",
      proof_of_play: "measured",
      qr_response: "measured",
      ad_revenue: "not_reported",
      pricing: "not_reported",
      roi_attribution: "not_reported",
      incremental_lift: "not_reported",
      roas_guarantee: "not_reported",
      claim_boundary: "Ad inventory is derived from configured playlist ad slots; revenue, ROI attribution, lift, and guarantees are not reported."
    },
    summary: summarizeAdInventory(entries, allSlots),
    slots
  };
}

function listAdInventoryManifestRows(criteria) {
  return db.prepare(`
    SELECT * FROM content_manifests
    WHERE tenant_id = ?
      AND (? = '' OR store_id = ?)
      AND (? = '' OR screen_group_id = ?)
      AND (? = '' OR release_channel = ?)
      AND status = ?
      AND (? = '' OR content_id = ?)
      AND (? = '' OR content_hash = ?)
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id,
    criteria.screen_group_id,
    criteria.screen_group_id,
    criteria.release_channel,
    criteria.release_channel,
    criteria.status,
    criteria.content_id,
    criteria.content_id,
    criteria.manifest_hash,
    criteria.manifest_hash,
    criteria.limit * 5
  );
}

function adInventoryEntriesFromManifest(row, criteria) {
  const playlist = parseJson(row.playlist_json, {});
  const items = Array.isArray(playlist?.items) ? playlist.items : [];
  const entries = [];
  for (const [index, item] of items.entries()) {
    const itemType = normalizeFreshnessItemType(item?.item_type || item?.type);
    if (itemType !== "ad" && itemType !== "sponsor") continue;
    const entry = {
      tenant_id: cleanId(row.tenant_id),
      store_id: cleanId(row.store_id),
      screen_group_id: cleanId(row.screen_group_id),
      screen_slot_id: cleanId(row.screen_slot_id),
      release_channel: cleanString(row.release_channel),
      status: cleanString(row.status),
      content_id: cleanId(item?.content_id || item?.contentId || row.content_id),
      manifest_content_id: cleanId(row.content_id),
      manifest_hash: cleanString(item?.manifest_hash || item?.manifestHash || playlist?.manifest_hash || playlist?.content_manifest_hash || row.content_hash),
      playlist_version: cleanString(row.playlist_version || playlist?.playlist_version),
      playlist_item_id: cleanId(item?.item_id || item?.itemId || item?.id || `item-${index + 1}`),
      item_type: itemType,
      ad_slot_id: cleanId(item?.ad_slot_id || item?.adSlotId),
      campaign_id: cleanId(item?.campaign_id || item?.campaignId),
      creative_id: cleanId(item?.creative_id || item?.creativeId),
      qr_link_id: cleanId(item?.qr_link_id || item?.qrLinkId),
      planned_duration_seconds: Math.max(0, asInteger(item?.duration_seconds ?? item?.duration) || 0)
    };
    if (criteria.campaign_id && entry.campaign_id !== criteria.campaign_id) continue;
    if (criteria.content_id && entry.content_id !== criteria.content_id && entry.manifest_content_id !== criteria.content_id) continue;
    if (criteria.item_type && entry.item_type !== criteria.item_type) continue;
    if (criteria.ad_slot_id && entry.ad_slot_id !== criteria.ad_slot_id) continue;
    if (criteria.creative_id && entry.creative_id !== criteria.creative_id) continue;
    if (criteria.qr_link_id && entry.qr_link_id !== criteria.qr_link_id) continue;
    if (criteria.manifest_hash && entry.manifest_hash !== criteria.manifest_hash) continue;
    entries.push(entry);
  }
  return entries;
}

function buildAdInventorySlotGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.ad_slot_id) continue;
    const key = [
      entry.tenant_id,
      entry.store_id,
      entry.screen_group_id,
      entry.release_channel,
      entry.ad_slot_id
    ].join("|");
    const target = groups.get(key) || {
      inventory_label: "manifest_derived",
      measurement_label: "measured",
      tenant_id: entry.tenant_id,
      store_id: entry.store_id,
      screen_group_id: entry.screen_group_id,
      release_channel: entry.release_channel,
      status: entry.status,
      ad_slot_id: entry.ad_slot_id,
      slot_position_count: 0,
      filled_position_count: 0,
      empty_position_count: 0,
      planned_duration_seconds: 0,
      play_event_count: 0,
      play_started_count: 0,
      play_completed_count: 0,
      play_failed_count: 0,
      played_duration_seconds: 0,
      qr_scan_count: 0,
      _item_types: new Set(),
      _manifest_content_ids: new Set(),
      _content_ids: new Set(),
      _manifest_hashes: new Set(),
      _campaign_ids: new Set(),
      _creative_ids: new Set(),
      _qr_link_ids: new Set()
    };
    target.slot_position_count += 1;
    if (adInventoryEntryIsFilled(entry)) target.filled_position_count += 1;
    else target.empty_position_count += 1;
    target.planned_duration_seconds += entry.planned_duration_seconds;
    addNonEmpty(target._item_types, entry.item_type);
    addNonEmpty(target._manifest_content_ids, entry.manifest_content_id);
    addNonEmpty(target._content_ids, entry.content_id);
    addNonEmpty(target._manifest_hashes, entry.manifest_hash);
    addNonEmpty(target._campaign_ids, entry.campaign_id);
    addNonEmpty(target._creative_ids, entry.creative_id);
    addNonEmpty(target._qr_link_ids, entry.qr_link_id);
    groups.set(key, target);
  }
  return groups;
}

function adInventoryEntryIsFilled(entry) {
  return Boolean(entry.campaign_id || entry.creative_id);
}

function applyAdInventoryMeasurements(groups, measurementRows) {
  for (const row of measurementRows) {
    const adSlotId = cleanId(row.ad_slot_id);
    const storeId = cleanId(row.store_id);
    if (!adSlotId || !storeId) continue;
    for (const slot of groups.values()) {
      if (slot.ad_slot_id !== adSlotId || slot.store_id !== storeId) continue;
      const manifestHash = cleanString(row.manifest_hash);
      const contentId = cleanId(row.content_id);
      const contentMatches = !contentId ||
        slot._content_ids.has(contentId) ||
        slot._manifest_content_ids.has(contentId);
      const manifestMatches = !manifestHash ||
        slot._manifest_hashes.size <= 0 ||
        slot._manifest_hashes.has(manifestHash);
      if (!contentMatches) continue;
      if (!manifestMatches && !contentId) continue;
      slot.play_event_count += asInteger(row.play_event_count) || 0;
      slot.play_started_count += asInteger(row.play_started_count) || 0;
      slot.play_completed_count += asInteger(row.play_completed_count) || 0;
      slot.play_failed_count += asInteger(row.play_failed_count) || 0;
      slot.played_duration_seconds += asInteger(row.played_duration_seconds) || 0;
      slot.qr_scan_count += asInteger(row.qr_scan_count) || 0;
    }
  }
}

function finalizeAdInventorySlot(slot) {
  return {
    inventory_label: slot.inventory_label,
    measurement_label: slot.measurement_label,
    tenant_id: slot.tenant_id,
    store_id: slot.store_id,
    screen_group_id: slot.screen_group_id,
    release_channel: slot.release_channel,
    status: slot.status,
    ad_slot_id: slot.ad_slot_id,
    slot_position_count: slot.slot_position_count,
    filled_position_count: slot.filled_position_count,
    empty_position_count: slot.empty_position_count,
    fill_rate: measuredRatio(slot.filled_position_count, slot.slot_position_count),
    planned_duration_seconds: slot.planned_duration_seconds,
    manifest_count: slot._manifest_content_ids.size,
    item_types: sortedSet(slot._item_types),
    content_ids: sortedSet(slot._content_ids),
    campaign_ids: sortedSet(slot._campaign_ids),
    creative_ids: sortedSet(slot._creative_ids),
    qr_link_ids: sortedSet(slot._qr_link_ids),
    measured: {
      measurement_label: "measured",
      play_event_count: slot.play_event_count,
      play_started_count: slot.play_started_count,
      play_completed_count: slot.play_completed_count,
      play_failed_count: slot.play_failed_count,
      played_duration_seconds: slot.played_duration_seconds,
      qr_scan_count: slot.qr_scan_count,
      qr_response_rate: measuredRatio(slot.qr_scan_count, slot.play_started_count)
    }
  };
}

function summarizeAdInventory(entries, slots) {
  const campaigns = new Set();
  const creatives = new Set();
  const qrLinks = new Set();
  const manifestIds = new Set();
  let slotPositionCount = 0;
  let filledPositionCount = 0;
  let emptyPositionCount = 0;
  let unclassifiedPositionCount = 0;
  let plannedDurationSeconds = 0;
  for (const entry of entries) {
    slotPositionCount += 1;
    plannedDurationSeconds += entry.planned_duration_seconds;
    if (!entry.ad_slot_id) unclassifiedPositionCount += 1;
    if (entry.ad_slot_id && adInventoryEntryIsFilled(entry)) filledPositionCount += 1;
    if (entry.ad_slot_id && !adInventoryEntryIsFilled(entry)) emptyPositionCount += 1;
    addNonEmpty(campaigns, entry.campaign_id);
    addNonEmpty(creatives, entry.creative_id);
    addNonEmpty(qrLinks, entry.qr_link_id);
    addNonEmpty(manifestIds, entry.manifest_content_id);
  }
  const measured = slots.reduce((summary, slot) => {
    summary.play_event_count += slot.measured.play_event_count;
    summary.play_started_count += slot.measured.play_started_count;
    summary.play_completed_count += slot.measured.play_completed_count;
    summary.play_failed_count += slot.measured.play_failed_count;
    summary.played_duration_seconds += slot.measured.played_duration_seconds;
    summary.qr_scan_count += slot.measured.qr_scan_count;
    return summary;
  }, {
    play_event_count: 0,
    play_started_count: 0,
    play_completed_count: 0,
    play_failed_count: 0,
    played_duration_seconds: 0,
    qr_scan_count: 0
  });
  measured.qr_response_rate = measuredRatio(measured.qr_scan_count, measured.play_started_count);
  return {
    inventory_label: "manifest_derived",
    measurement_label: "measured",
    manifest_count: manifestIds.size,
    slot_position_count: slotPositionCount,
    sellable_slot_count: slots.length,
    filled_slot_count: slots.filter((slot) => slot.filled_position_count > 0).length,
    empty_slot_count: slots.filter((slot) => slot.filled_position_count <= 0).length,
    filled_position_count: filledPositionCount,
    empty_position_count: emptyPositionCount,
    unclassified_position_count: unclassifiedPositionCount,
    fill_rate: measuredRatio(slots.filter((slot) => slot.filled_position_count > 0).length, slots.length),
    position_fill_rate: measuredRatio(filledPositionCount, filledPositionCount + emptyPositionCount),
    planned_duration_seconds: plannedDurationSeconds,
    active_campaign_count: campaigns.size,
    creative_count: creatives.size,
    qr_link_count: qrLinks.size,
    measured
  };
}

function buildHostRoiPreview(criteria) {
  const summary = buildReportSummary(criteria);
  const inventory = buildAdInventoryReport(criteria);
  const freshness = buildContentFreshnessReport({
    tenant_id: criteria.tenant_id,
    store_id: criteria.store_id,
    screen_group_id: criteria.screen_group_id,
    release_channel: criteria.release_channel,
    status: criteria.status,
    now: nowIso(),
    review_due_days: CONTENT_FRESHNESS_REVIEW_DUE_DAYS,
    stale_days: CONTENT_FRESHNESS_STALE_DAYS,
    limit: criteria.limit
  });
  const proofOfPlay = hostRoiProofOfPlay(summary.totals);
  const response = hostRoiResponse(summary.totals);
  const conversion = hostRoiConversion(summary.totals);
  const operations = hostRoiOperations(freshness);
  const report = {
    report_type: "host_roi_preview",
    surface: "admin_internal_read_model",
    generated_at: summary.generated_at,
    source: {
      reporting_summary: summary.source,
      ad_inventory: inventory.source.inventory,
      content_freshness: "content_manifests_and_playlogs"
    },
    period: summary.period,
    filters: {
      ...summary.filters,
      screen_group_id: criteria.screen_group_id,
      release_channel: criteria.release_channel,
      status: criteria.status,
      limit: criteria.limit
    },
    measurement_policy: {
      proof_of_play: "measured",
      qr_response: "measured",
      counter_order_value: "measured",
      ad_inventory: "manifest_derived",
      fill_rate: "manifest_derived",
      content_freshness: "manifest_derived",
      ad_revenue: "not_reported",
      slot_unit_price: "not_reported",
      payback_period: "not_reported",
      labor_savings: "not_reported",
      roi_attribution: "not_reported",
      incremental_lift: "not_reported",
      roas: "not_reported",
      performance_guarantee: "not_reported",
      claim_boundary: "Host ROI preview separates measured Misell rail signals from manifest-derived inventory. It does not report ad revenue, payback, labor savings, lift, ROAS, or guarantees."
    },
    proof_of_play: proofOfPlay,
    host_response: response,
    host_conversion: conversion,
    ad_inventory: hostRoiInventory(inventory.summary),
    operations,
    unavailable_financials: hostRoiUnavailableFinancials(),
    decision_prompts: []
  };
  report.decision_prompts = buildHostRoiDecisionPrompts(report);
  return report;
}

function hostRoiProofOfPlay(totals) {
  return {
    measurement_label: "measured",
    play_started_count: asInteger(totals.play_started_count) || 0,
    play_completed_count: asInteger(totals.play_completed_count) || 0,
    play_failed_count: asInteger(totals.play_failed_count) || 0,
    play_duration_seconds: asInteger(totals.play_duration_seconds) || 0,
    completion_rate: measuredRatio(totals.play_completed_count, totals.play_started_count)
  };
}

function hostRoiResponse(totals) {
  return {
    measurement_label: "measured",
    qr_scan_count: asInteger(totals.qr_scan_count) || 0,
    qr_scans_per_play_started: measuredRatio(totals.qr_scan_count, totals.play_started_count),
    denominator: "play_started_count"
  };
}

function hostRoiConversion(totals) {
  return {
    measurement_label: "measured",
    counter_orders_issued_count: asInteger(totals.counter_orders_issued_count) || 0,
    counter_orders_redeemed_count: asInteger(totals.counter_orders_redeemed_count) || 0,
    counter_orders_cancelled_count: asInteger(totals.counter_orders_cancelled_count) || 0,
    counter_orders_expired_count: asInteger(totals.counter_orders_expired_count) || 0,
    counter_order_total_amount: asInteger(totals.counter_order_total_amount) || 0,
    counter_order_redeemed_amount: asInteger(totals.counter_order_redeemed_amount) || 0,
    counter_order_value_label: "measured_misell_rail",
    order_issue_per_qr_scan: measuredRatio(totals.counter_orders_issued_count, totals.qr_scan_count),
    order_to_redeem_rate: measuredRatio(totals.counter_orders_redeemed_count, totals.counter_orders_issued_count)
  };
}

function hostRoiInventory(summary) {
  return {
    inventory_label: "manifest_derived",
    fill_rate_label: "manifest_derived",
    position_fill_rate_label: "manifest_derived",
    manifest_count: asInteger(summary.manifest_count) || 0,
    sellable_slot_count: asInteger(summary.sellable_slot_count) || 0,
    filled_slot_count: asInteger(summary.filled_slot_count) || 0,
    empty_slot_count: asInteger(summary.empty_slot_count) || 0,
    slot_position_count: asInteger(summary.slot_position_count) || 0,
    filled_position_count: asInteger(summary.filled_position_count) || 0,
    empty_position_count: asInteger(summary.empty_position_count) || 0,
    fill_rate: Number(summary.fill_rate) || 0,
    position_fill_rate: Number(summary.position_fill_rate) || 0,
    planned_duration_seconds: asInteger(summary.planned_duration_seconds) || 0,
    active_campaign_count: asInteger(summary.active_campaign_count) || 0,
    creative_count: asInteger(summary.creative_count) || 0,
    qr_link_count: asInteger(summary.qr_link_count) || 0,
    measured: {
      measurement_label: "measured",
      play_started_count: asInteger(summary.measured?.play_started_count) || 0,
      play_completed_count: asInteger(summary.measured?.play_completed_count) || 0,
      play_failed_count: asInteger(summary.measured?.play_failed_count) || 0,
      played_duration_seconds: asInteger(summary.measured?.played_duration_seconds) || 0,
      qr_scan_count: asInteger(summary.measured?.qr_scan_count) || 0,
      qr_response_rate: Number(summary.measured?.qr_response_rate) || 0
    }
  };
}

function hostRoiOperations(freshness) {
  return {
    freshness_label: "manifest_derived",
    play_signal_label: "measured",
    thresholds: freshness.thresholds,
    content_count: asInteger(freshness.summary?.total) || 0,
    fresh_count: asInteger(freshness.summary?.fresh) || 0,
    review_due_count: asInteger(freshness.summary?.review_due) || 0,
    stale_count: asInteger(freshness.summary?.stale) || 0,
    inactive_count: asInteger(freshness.summary?.inactive) || 0,
    not_played_count: asInteger(freshness.summary?.not_played) || 0,
    ad_or_sponsor_items: asInteger(freshness.summary?.ad_or_sponsor_items) || 0,
    campaign_refresh_items: asInteger(freshness.summary?.campaign_refresh_items) || 0
  };
}

function hostRoiUnavailableFinancials() {
  return {
    measurement_label: "not_reported",
    ad_revenue: "not_reported",
    slot_unit_price: "not_reported",
    booked_period_revenue: "not_reported",
    payback_period: "not_reported",
    labor_savings: "not_reported",
    roi_attribution: "not_reported",
    incremental_lift: "not_reported",
    roas: "not_reported",
    performance_guarantee: "not_reported",
    reason: "Billing, slot pricing, contract cost, labor baseline, and holdout/baseline data are outside this cell."
  };
}

function buildHostRoiDecisionPrompts(report) {
  const prompts = [];
  if (report.proof_of_play.play_started_count <= 0) {
    prompts.push(hostRoiDecisionPrompt("check_delivery", "high", "No measured play_started events were found for this host scope."));
  }
  if (report.proof_of_play.play_failed_count > 0) {
    prompts.push(hostRoiDecisionPrompt("check_playback_failures", "high", "Measured playback failures exist for this host scope."));
  }
  if (report.ad_inventory.sellable_slot_count <= 0) {
    prompts.push(hostRoiDecisionPrompt("define_sellable_ad_slots", "medium", "No manifest-derived sellable ad slots were found."));
  } else if (report.ad_inventory.empty_slot_count > 0) {
    prompts.push(hostRoiDecisionPrompt("fill_empty_ad_slots", "medium", "Manifest-derived ad inventory includes empty slots."));
  }
  if (report.operations.stale_count > 0 || report.operations.review_due_count > 0) {
    prompts.push(hostRoiDecisionPrompt("refresh_content", "medium", "Content freshness shows stale or review-due content."));
  }
  if (report.proof_of_play.play_started_count > 0 && report.host_response.qr_scan_count <= 0) {
    prompts.push(hostRoiDecisionPrompt("review_qr_cta", "medium", "Measured plays exist but QR response is zero."));
  }
  if (report.host_conversion.counter_orders_issued_count > 0 && report.host_conversion.counter_orders_redeemed_count <= 0) {
    prompts.push(hostRoiDecisionPrompt("review_redemption_flow", "medium", "Measured orders were issued but none were redeemed."));
  }
  if (prompts.length === 0) {
    prompts.push(hostRoiDecisionPrompt("continue_monthly_optimization", "low", "Measured delivery, response, conversion, inventory, and freshness signals exist; continue monthly operator review."));
  }
  return prompts;
}

function hostRoiDecisionPrompt(decisionKey, priority, reason) {
  return {
    decision_key: decisionKey,
    priority,
    reason,
    authority: "operator_decision_required",
    claim_boundary: "guidance_only_no_performance_guarantee"
  };
}

function addNonEmpty(target, value) {
  const cleaned = cleanString(value);
  if (cleaned) target.add(cleaned);
}

function sortedSet(value) {
  return Array.from(value).sort();
}

function measuredRatio(numerator, denominator) {
  const value = Math.max(0, Number(numerator) || 0);
  const base = Math.max(0, Number(denominator) || 0);
  return base > 0 ? value / base : 0;
}

function rebuildReportDailyStoreMetrics(criteria) {
  const result = aggregateReportDailyStoreMetrics(criteria);
  const persistRows = db.transaction((rows) => {
    db.prepare(`
      DELETE FROM report_daily_store_metrics
      WHERE period_start = ?
        AND period_end = ?
        AND campaign_id = ?
        AND content_id = ?
        AND (? = '' OR tenant_id = ?)
        AND (? = '' OR store_id = ?)
    `).run(
      criteria.from,
      criteria.to,
      criteria.campaign_id,
      criteria.content_id,
      criteria.tenant_id,
      criteria.tenant_id,
      criteria.store_id,
      criteria.store_id
    );

    const insert = db.prepare(`
      INSERT INTO report_daily_store_metrics (
        metric_key, metric_date, period_start, period_end, timezone,
        tenant_id, store_id, campaign_id, content_id, device_count,
        active_device_count, heartbeat_count, expected_heartbeat_count,
        uptime_sample_rate, play_event_count, play_started_count,
        play_completed_count, play_failed_count, play_duration_seconds,
        qr_scan_count, counter_orders_issued_count, counter_orders_redeemed_count,
        counter_orders_cancelled_count, counter_orders_expired_count,
        counter_order_total_amount, counter_order_redeemed_amount, error_count,
        generated_at, updated_at, source_from, source_to
      ) VALUES (
        @metric_key, @metric_date, @period_start, @period_end, @timezone,
        @tenant_id, @store_id, @campaign_id, @content_id, @device_count,
        @active_device_count, @heartbeat_count, @expected_heartbeat_count,
        @uptime_sample_rate, @play_event_count, @play_started_count,
        @play_completed_count, @play_failed_count, @play_duration_seconds,
        @qr_scan_count, @counter_orders_issued_count, @counter_orders_redeemed_count,
        @counter_orders_cancelled_count, @counter_orders_expired_count,
        @counter_order_total_amount, @counter_order_redeemed_amount, @error_count,
        @generated_at, @updated_at, @source_from, @source_to
      )
    `);
    for (const row of rows.map(publicReportDailyStoreMetric)) {
      insert.run(row);
    }
  });
  persistRows(result.rows);
  return result;
}

function listReportDailyStoreMetrics(criteria) {
  return db.prepare(`
    SELECT * FROM report_daily_store_metrics
    WHERE period_start = ?
      AND period_end = ?
      AND campaign_id = ?
      AND content_id = ?
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
    ORDER BY metric_date ASC, store_id ASC
  `).all(
    criteria.from,
    criteria.to,
    criteria.campaign_id,
    criteria.content_id,
    criteria.tenant_id,
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id
  ).map(publicReportDailyStoreMetric);
}

function aggregateReportDailyStoreMetrics(criteria) {
  const generatedAt = nowIso();
  const settingsCache = new Map();
  const rowsByKey = new Map();
  for (const store of listReportStores(criteria)) {
    for (const metricDate of criteria.days) {
      const row = createReportDailyMetricRow(criteria, store, metricDate, settingsCache, generatedAt);
      rowsByKey.set(row.metric_key, row);
    }
  }

  for (const count of listReportDeviceCounts(criteria)) {
    for (const metricDate of criteria.days) {
      const row = getOrCreateReportDailyMetricRow(criteria, {
        tenant_id: count.tenant_id,
        store_id: count.store_id
      }, metricDate, rowsByKey, settingsCache, generatedAt);
      row.device_count = asInteger(count.device_count) || 0;
    }
  }

  addHeartbeatMetrics(criteria, rowsByKey, settingsCache, generatedAt);
  addPlaylogMetrics(criteria, rowsByKey, settingsCache, generatedAt);
  addQrScanMetrics(criteria, rowsByKey, settingsCache, generatedAt);
  addCounterOrderMetrics(criteria, rowsByKey, settingsCache, generatedAt);
  addErrorMetrics(criteria, rowsByKey, settingsCache, generatedAt);

  const rows = Array.from(rowsByKey.values())
    .sort((a, b) => `${a.metric_date}:${a.store_id}`.localeCompare(`${b.metric_date}:${b.store_id}`))
    .map((row) => finalizeReportDailyMetricRow(row, criteria));
  return { generated_at: generatedAt, rows };
}

function listReportStores(criteria) {
  return db.prepare(`
    SELECT tenant_id, store_id, name AS store_name
    FROM stores
    WHERE (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
    ORDER BY tenant_id, store_id
  `).all(criteria.tenant_id, criteria.tenant_id, criteria.store_id, criteria.store_id).map((row) => ({
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    store_name: cleanString(row.store_name)
  }));
}

function listReportDeviceCounts(criteria) {
  return db.prepare(`
    SELECT tenant_id, store_id, COUNT(*) AS device_count
    FROM devices
    WHERE status NOT IN ('retired', 'lost')
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
    GROUP BY tenant_id, store_id
  `).all(criteria.tenant_id, criteria.tenant_id, criteria.store_id, criteria.store_id);
}

function createReportDailyMetricRow(criteria, store, metricDate, settingsCache, generatedAt) {
  const settings = cachedReportStoreSettings(store.store_id, store.tenant_id, settingsCache);
  return {
    metric_key: reportDailyMetricKey(criteria, metricDate, store.tenant_id, store.store_id),
    metric_date: metricDate,
    period_start: criteria.from,
    period_end: criteria.to,
    timezone: settings.timezone,
    tenant_id: cleanId(store.tenant_id),
    store_id: cleanId(store.store_id),
    campaign_id: criteria.campaign_id,
    content_id: criteria.content_id,
    device_count: 0,
    active_device_count: 0,
    heartbeat_count: 0,
    expected_heartbeat_count: 0,
    uptime_sample_rate: 0,
    play_event_count: 0,
    play_started_count: 0,
    play_completed_count: 0,
    play_failed_count: 0,
    play_duration_seconds: 0,
    qr_scan_count: 0,
    counter_orders_issued_count: 0,
    counter_orders_redeemed_count: 0,
    counter_orders_cancelled_count: 0,
    counter_orders_expired_count: 0,
    counter_order_total_amount: 0,
    counter_order_redeemed_amount: 0,
    error_count: 0,
    generated_at: generatedAt,
    updated_at: generatedAt,
    source_from: criteria.from,
    source_to: criteria.to,
    _active_devices: new Set()
  };
}

function getOrCreateReportDailyMetricRow(criteria, store, metricDate, rowsByKey, settingsCache, generatedAt) {
  const tenantId = cleanId(store.tenant_id);
  const storeId = cleanId(store.store_id);
  const key = reportDailyMetricKey(criteria, metricDate, tenantId, storeId);
  let row = rowsByKey.get(key);
  if (!row) {
    row = createReportDailyMetricRow(criteria, { tenant_id: tenantId, store_id: storeId }, metricDate, settingsCache, generatedAt);
    rowsByKey.set(key, row);
  }
  return row;
}

function addHeartbeatMetrics(criteria, rowsByKey, settingsCache, generatedAt) {
  const range = reportBroadIsoRange(criteria);
  const rows = db.prepare(`
    SELECT tenant_id, store_id, device_id, received_at
    FROM heartbeats
    WHERE received_at >= ?
      AND received_at < ?
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
  `).all(range.from, range.to, criteria.tenant_id, criteria.tenant_id, criteria.store_id, criteria.store_id);
  for (const item of rows) {
    const metricDate = reportBusinessDateFor(item.store_id, item.tenant_id, item.received_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const row = getOrCreateReportDailyMetricRow(criteria, item, metricDate, rowsByKey, settingsCache, generatedAt);
    row.heartbeat_count += 1;
    if (item.device_id) row._active_devices.add(item.device_id);
  }
}

function addPlaylogMetrics(criteria, rowsByKey, settingsCache, generatedAt) {
  const rows = listReportPlaylogRows(criteria, `
    tenant_id, store_id, device_id, campaign_id, content_id,
    event_type, result, duration
  `);
  for (const item of rows) {
    const metricDate = reportBusinessDateFor(item.store_id, item.tenant_id, item.event_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const row = getOrCreateReportDailyMetricRow(criteria, item, metricDate, rowsByKey, settingsCache, generatedAt);
    row.play_event_count += 1;
    if (isReportPlayStarted(item)) row.play_started_count += 1;
    if (isReportPlayCompleted(item)) row.play_completed_count += 1;
    if (isReportPlayFailed(item)) row.play_failed_count += 1;
    row.play_duration_seconds += Math.max(0, asInteger(item.duration) || 0);
  }
}

function listReportPlaylogRows(criteria, selectColumns) {
  const range = reportBroadIsoRange(criteria);
  const eventAt = "COALESCE(NULLIF(occurred_at, ''), NULLIF(played_at, ''), received_at)";
  return db.prepare(`
    SELECT
      ${selectColumns},
      ${eventAt} AS event_at
    FROM playlogs
    WHERE ${eventAt} >= ?
      AND ${eventAt} < ?
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR campaign_id = ?)
      AND (? = '' OR content_id = ?)
      AND (? = '' OR COALESCE(NULLIF(item_type, ''), 'content') = ?)
      AND (? = '' OR ad_slot_id = ?)
      AND (? = '' OR creative_id = ?)
      AND (? = '' OR qr_link_id = ?)
      AND (? = '' OR manifest_hash = ?)
  `).all(
    range.from,
    range.to,
    criteria.tenant_id,
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id,
    criteria.campaign_id,
    criteria.campaign_id,
    criteria.content_id,
    criteria.content_id,
    criteria.item_type,
    criteria.item_type,
    criteria.ad_slot_id,
    criteria.ad_slot_id,
    criteria.creative_id,
    criteria.creative_id,
    criteria.qr_link_id,
    criteria.qr_link_id,
    criteria.manifest_hash,
    criteria.manifest_hash
  );
}

function addQrScanMetrics(criteria, rowsByKey, settingsCache, generatedAt) {
  for (const item of listReportQrScanRows(criteria)) {
    const metricDate = reportBusinessDateFor(item.store_id, item.tenant_id, item.scanned_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const row = getOrCreateReportDailyMetricRow(criteria, item, metricDate, rowsByKey, settingsCache, generatedAt);
    row.qr_scan_count += 1;
  }
}

function addCounterOrderMetrics(criteria, rowsByKey, settingsCache, generatedAt) {
  const rows = listReportCounterOrderRows(criteria, "tenant_id, store_id, campaign_id, content_id, business_date, status, total_amount");
  for (const item of rows) {
    if (!reportDateInRange(item.business_date, criteria)) continue;
    const row = getOrCreateReportDailyMetricRow(criteria, item, item.business_date, rowsByKey, settingsCache, generatedAt);
    const amount = Math.max(0, asInteger(item.total_amount) || 0);
    row.counter_orders_issued_count += 1;
    row.counter_order_total_amount += amount;
    if (item.status === "redeemed") {
      row.counter_orders_redeemed_count += 1;
      row.counter_order_redeemed_amount += amount;
    } else if (item.status === "cancelled") {
      row.counter_orders_cancelled_count += 1;
    } else if (item.status === "expired") {
      row.counter_orders_expired_count += 1;
    }
  }
}

function listReportCounterOrderRows(criteria, selectColumns) {
  const allowedQrLinkIds = reportAdFilteredQrLinkIds(criteria);
  const bridgeByQrLink = allowedQrLinkIds ? 1 : 0;
  const rows = db.prepare(`
    SELECT ${selectColumns}, qr_link_id AS report_filter_qr_link_id
    FROM counter_orders
    WHERE business_date >= ?
      AND business_date <= ?
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR ? = 1 OR campaign_id = ?)
      AND (? = '' OR ? = 1 OR content_id = ?)
  `).all(
    criteria.from,
    criteria.to,
    criteria.tenant_id,
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id,
    criteria.campaign_id,
    bridgeByQrLink,
    criteria.campaign_id,
    criteria.content_id,
    bridgeByQrLink,
    criteria.content_id
  );
  return rows.filter((row) => {
    const qrLinkId = cleanId(row.report_filter_qr_link_id || row.qr_link_id);
    return !allowedQrLinkIds || allowedQrLinkIds.has(qrLinkId);
  });
}

function addErrorMetrics(criteria, rowsByKey, settingsCache, generatedAt) {
  const range = reportBroadIsoRange(criteria);
  const rows = db.prepare(`
    SELECT
      tenant_id, store_id,
      COALESCE(NULLIF(occurred_at, ''), received_at) AS event_at
    FROM error_logs
    WHERE COALESCE(NULLIF(occurred_at, ''), received_at) >= ?
      AND COALESCE(NULLIF(occurred_at, ''), received_at) < ?
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
  `).all(range.from, range.to, criteria.tenant_id, criteria.tenant_id, criteria.store_id, criteria.store_id);
  for (const item of rows) {
    const metricDate = reportBusinessDateFor(item.store_id, item.tenant_id, item.event_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const row = getOrCreateReportDailyMetricRow(criteria, item, metricDate, rowsByKey, settingsCache, generatedAt);
    row.error_count += 1;
  }
}

function finalizeReportDailyMetricRow(row, criteria) {
  row.active_device_count = row._active_devices?.size || row.active_device_count || 0;
  row.expected_heartbeat_count = Math.max(
    0,
    Math.round((row.device_count || 0) * (24 * 60 / criteria.heartbeat_interval_minutes))
  );
  row.uptime_sample_rate = row.expected_heartbeat_count > 0
    ? Math.min(1, row.heartbeat_count / row.expected_heartbeat_count)
    : 0;
  delete row._active_devices;
  return row;
}

function publicReportDailyStoreMetric(row) {
  return {
    metric_key: cleanString(row.metric_key),
    metric_date: cleanDateKey(row.metric_date),
    period_start: cleanDateKey(row.period_start),
    period_end: cleanDateKey(row.period_end),
    timezone: cleanString(row.timezone) || DEFAULT_TIMEZONE,
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    campaign_id: cleanId(row.campaign_id),
    content_id: cleanId(row.content_id),
    device_count: asInteger(row.device_count) || 0,
    active_device_count: asInteger(row.active_device_count) || 0,
    heartbeat_count: asInteger(row.heartbeat_count) || 0,
    expected_heartbeat_count: asInteger(row.expected_heartbeat_count) || 0,
    uptime_sample_rate: Number(row.uptime_sample_rate || 0),
    play_event_count: asInteger(row.play_event_count) || 0,
    play_started_count: asInteger(row.play_started_count) || 0,
    play_completed_count: asInteger(row.play_completed_count) || 0,
    play_failed_count: asInteger(row.play_failed_count) || 0,
    play_duration_seconds: asInteger(row.play_duration_seconds) || 0,
    qr_scan_count: asInteger(row.qr_scan_count) || 0,
    counter_orders_issued_count: asInteger(row.counter_orders_issued_count) || 0,
    counter_orders_redeemed_count: asInteger(row.counter_orders_redeemed_count) || 0,
    counter_orders_cancelled_count: asInteger(row.counter_orders_cancelled_count) || 0,
    counter_orders_expired_count: asInteger(row.counter_orders_expired_count) || 0,
    counter_order_total_amount: asInteger(row.counter_order_total_amount) || 0,
    counter_order_redeemed_amount: asInteger(row.counter_order_redeemed_amount) || 0,
    error_count: asInteger(row.error_count) || 0,
    generated_at: cleanString(row.generated_at),
    updated_at: cleanString(row.updated_at),
    source_from: cleanDateKey(row.source_from),
    source_to: cleanDateKey(row.source_to)
  };
}

function summarizeReportRowsByDate(criteria, rows) {
  const byDate = new Map(criteria.days.map((date) => [date, emptyReportMetricSummary(date)]));
  for (const row of rows) {
    const target = byDate.get(row.metric_date) || emptyReportMetricSummary(row.metric_date);
    addReportMetricToSummary(target, row);
    byDate.set(row.metric_date, target);
  }
  return Array.from(byDate.values()).map(finalizeReportMetricSummary);
}

function summarizeReportMetricRows(rows) {
  const summary = emptyReportMetricSummary("");
  const deviceCountByDate = new Map();
  for (const row of rows) {
    addReportMetricToSummary(summary, row);
    deviceCountByDate.set(row.metric_date, (deviceCountByDate.get(row.metric_date) || 0) + row.device_count);
  }
  summary.device_count = Math.max(0, ...deviceCountByDate.values());
  return finalizeReportMetricSummary(summary);
}

function emptyReportMetricSummary(metricDate) {
  return {
    date: metricDate,
    device_count: 0,
    active_device_count: 0,
    heartbeat_count: 0,
    expected_heartbeat_count: 0,
    uptime_sample_rate: 0,
    play_event_count: 0,
    play_started_count: 0,
    play_completed_count: 0,
    play_failed_count: 0,
    play_duration_seconds: 0,
    qr_scan_count: 0,
    qr_response_rate: 0,
    counter_orders_issued_count: 0,
    counter_orders_redeemed_count: 0,
    counter_orders_cancelled_count: 0,
    counter_orders_expired_count: 0,
    counter_order_total_amount: 0,
    counter_order_redeemed_amount: 0,
    error_count: 0
  };
}

function addReportMetricToSummary(summary, row) {
  summary.device_count += row.device_count;
  summary.active_device_count += row.active_device_count;
  summary.heartbeat_count += row.heartbeat_count;
  summary.expected_heartbeat_count += row.expected_heartbeat_count;
  summary.play_event_count += row.play_event_count;
  summary.play_started_count += row.play_started_count;
  summary.play_completed_count += row.play_completed_count;
  summary.play_failed_count += row.play_failed_count;
  summary.play_duration_seconds += row.play_duration_seconds;
  summary.qr_scan_count += row.qr_scan_count;
  summary.counter_orders_issued_count += row.counter_orders_issued_count;
  summary.counter_orders_redeemed_count += row.counter_orders_redeemed_count;
  summary.counter_orders_cancelled_count += row.counter_orders_cancelled_count;
  summary.counter_orders_expired_count += row.counter_orders_expired_count;
  summary.counter_order_total_amount += row.counter_order_total_amount;
  summary.counter_order_redeemed_amount += row.counter_order_redeemed_amount;
  summary.error_count += row.error_count;
}

function finalizeReportMetricSummary(summary) {
  summary.uptime_sample_rate = summary.expected_heartbeat_count > 0
    ? Math.min(1, summary.heartbeat_count / summary.expected_heartbeat_count)
    : 0;
  summary.qr_response_rate = summary.play_started_count > 0
    ? summary.qr_scan_count / summary.play_started_count
    : 0;
  if (!summary.date) delete summary.date;
  return summary;
}

function buildReportContentBreakdown(criteria) {
  const rows = listReportPlaylogRows(criteria, `
    store_id, campaign_id, content_id, playlist_version, playlist_item_id,
    COALESCE(NULLIF(item_type, ''), 'content') AS item_type,
    ad_slot_id, creative_id, qr_link_id, manifest_hash,
    asset_id, layout, event_type, result, duration
  `);
  const settingsCache = new Map();
  const groups = new Map();
  for (const row of rows) {
    const metricDate = reportBusinessDateFor(row.store_id, "", row.event_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const key = [
      row.store_id,
      cleanId(row.campaign_id),
      cleanId(row.content_id),
      cleanString(row.item_type),
      cleanString(row.playlist_version),
      cleanString(row.playlist_item_id),
      cleanId(row.ad_slot_id),
      cleanId(row.creative_id),
      cleanId(row.qr_link_id),
      cleanString(row.manifest_hash),
      cleanString(row.asset_id),
      cleanString(row.layout)
    ].join("|");
    const target = groups.get(key) || {
      store_id: cleanId(row.store_id),
      campaign_id: cleanId(row.campaign_id),
      content_id: cleanId(row.content_id),
      item_type: cleanString(row.item_type) || "content",
      playlist_version: cleanString(row.playlist_version),
      playlist_item_id: cleanString(row.playlist_item_id),
      ad_slot_id: cleanId(row.ad_slot_id),
      creative_id: cleanId(row.creative_id),
      qr_link_id: cleanId(row.qr_link_id),
      manifest_hash: cleanString(row.manifest_hash),
      asset_id: cleanString(row.asset_id),
      layout: cleanString(row.layout),
      play_event_count: 0,
      play_started_count: 0,
      play_completed_count: 0,
      play_failed_count: 0,
      play_duration_seconds: 0
    };
    target.play_event_count += 1;
    if (isReportPlayStarted(row)) target.play_started_count += 1;
    if (isReportPlayCompleted(row)) target.play_completed_count += 1;
    if (isReportPlayFailed(row)) target.play_failed_count += 1;
    target.play_duration_seconds += Math.max(0, asInteger(row.duration) || 0);
    groups.set(key, target);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.play_event_count - a.play_event_count)
    .slice(0, 50);
}

function buildReportAdMeasurementBreakdown(criteria) {
  const settingsCache = new Map();
  const qrScanCounts = buildReportQrScanCountMap(criteria, settingsCache);
  const rows = listReportPlaylogRows(criteria, `
    tenant_id, store_id, campaign_id, content_id, playlist_version, playlist_item_id,
    COALESCE(NULLIF(item_type, ''), 'content') AS item_type,
    ad_slot_id, creative_id, qr_link_id, manifest_hash,
    asset_id, layout, event_type, result,
    duration, planned_duration_seconds, played_duration_seconds
  `);
  const groups = new Map();
  for (const row of rows) {
    if (!isAdMeasurementRow(row) && !criteria.item_type && !criteria.ad_slot_id && !criteria.creative_id && !criteria.qr_link_id && !criteria.manifest_hash) {
      continue;
    }
    const metricDate = reportBusinessDateFor(row.store_id, row.tenant_id, row.event_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const key = [
      cleanId(row.store_id),
      cleanId(row.campaign_id),
      cleanId(row.content_id),
      cleanString(row.item_type) || "content",
      cleanId(row.ad_slot_id),
      cleanId(row.creative_id),
      cleanId(row.qr_link_id),
      cleanString(row.manifest_hash)
    ].join("|");
    const qrKey = reportQrMeasurementKey(row);
    const target = groups.get(key) || {
      measurement_label: "measured",
      store_id: cleanId(row.store_id),
      campaign_id: cleanId(row.campaign_id),
      content_id: cleanId(row.content_id),
      item_type: cleanString(row.item_type) || "content",
      ad_slot_id: cleanId(row.ad_slot_id),
      creative_id: cleanId(row.creative_id),
      qr_link_id: cleanId(row.qr_link_id),
      manifest_hash: cleanString(row.manifest_hash),
      playlist_version: cleanString(row.playlist_version),
      playlist_item_id: cleanString(row.playlist_item_id),
      asset_id: cleanString(row.asset_id),
      layout: cleanString(row.layout),
      play_event_count: 0,
      play_started_count: 0,
      play_completed_count: 0,
      play_failed_count: 0,
      planned_duration_seconds: 0,
      played_duration_seconds: 0,
      qr_scan_count: cleanId(row.qr_link_id) ? (qrScanCounts.get(qrKey) || 0) : 0,
      qr_response_rate: 0
    };
    target.play_event_count += 1;
    if (isReportPlayStarted(row)) target.play_started_count += 1;
    if (isReportPlayCompleted(row)) target.play_completed_count += 1;
    if (isReportPlayFailed(row)) target.play_failed_count += 1;
    target.planned_duration_seconds += Math.max(0, asInteger(row.planned_duration_seconds ?? row.duration) || 0);
    target.played_duration_seconds += Math.max(0, asInteger(row.played_duration_seconds ?? row.duration) || 0);
    target.qr_response_rate = target.play_started_count > 0
      ? target.qr_scan_count / target.play_started_count
      : 0;
    groups.set(key, target);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.play_event_count - a.play_event_count)
    .slice(0, 100);
}

function isAdMeasurementRow(row) {
  return (
    (cleanString(row.item_type) && cleanString(row.item_type) !== "content") ||
    Boolean(cleanId(row.ad_slot_id)) ||
    Boolean(cleanId(row.creative_id)) ||
    Boolean(cleanId(row.qr_link_id)) ||
    Boolean(cleanString(row.manifest_hash))
  );
}

function buildReportQrScanCountMap(criteria, settingsCache = new Map()) {
  const counts = new Map();
  for (const row of listReportQrScanRows(criteria)) {
    const metricDate = reportBusinessDateFor(row.store_id, row.tenant_id, row.scanned_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const key = reportQrMeasurementKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function listReportQrScanRows(criteria) {
  const range = reportBroadIsoRange(criteria);
  const allowedQrLinkIds = reportAdFilteredQrLinkIds(criteria);
  const bridgeByQrLink = allowedQrLinkIds ? 1 : 0;
  const rows = db.prepare(`
    SELECT tenant_id, store_id, campaign_id, content_id, qr_link_id, scanned_at
    FROM qr_scans
    WHERE scanned_at >= ?
      AND scanned_at < ?
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR ? = 1 OR campaign_id = ?)
      AND (? = '' OR ? = 1 OR content_id = ?)
      AND (? = '' OR qr_link_id = ?)
  `).all(
    range.from,
    range.to,
    criteria.tenant_id,
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id,
    criteria.campaign_id,
    bridgeByQrLink,
    criteria.campaign_id,
    criteria.content_id,
    bridgeByQrLink,
    criteria.content_id,
    criteria.qr_link_id,
    criteria.qr_link_id
  );
  return rows.filter((row) => {
    const qrLinkId = cleanId(row.qr_link_id);
    return !allowedQrLinkIds || allowedQrLinkIds.has(qrLinkId);
  });
}

function reportQrMeasurementKey(row) {
  return [
    cleanId(row.store_id),
    cleanId(row.content_id),
    cleanId(row.qr_link_id)
  ].join("|");
}

function reportAdFilteredQrLinkIds(criteria) {
  if (!criteria.campaign_id && !criteria.item_type && !criteria.ad_slot_id && !criteria.creative_id && !criteria.manifest_hash) return null;
  const rows = listReportPlaylogRows(criteria, "qr_link_id");
  return new Set(rows.map((row) => cleanId(row.qr_link_id)).filter(Boolean));
}

function buildReportQrBreakdown(criteria) {
  const range = reportBroadIsoRange(criteria);
  const allowedQrLinkIds = reportAdFilteredQrLinkIds(criteria);
  const bridgeByQrLink = allowedQrLinkIds ? 1 : 0;
  const rows = db.prepare(`
    SELECT
      qs.store_id, qs.campaign_id, qs.content_id, qs.offer_id,
      qs.offer_revision_id, qs.qr_link_id, qs.scanned_at,
      ql.label, ql.destination_type
    FROM qr_scans qs
    LEFT JOIN qr_links ql ON ql.qr_link_id = qs.qr_link_id
    WHERE qs.scanned_at >= ?
      AND qs.scanned_at < ?
      AND (? = '' OR qs.tenant_id = ?)
      AND (? = '' OR qs.store_id = ?)
      AND (? = '' OR ? = 1 OR qs.campaign_id = ?)
      AND (? = '' OR ? = 1 OR qs.content_id = ?)
      AND (? = '' OR qs.qr_link_id = ?)
  `).all(
    range.from,
    range.to,
    criteria.tenant_id,
    criteria.tenant_id,
    criteria.store_id,
    criteria.store_id,
    criteria.campaign_id,
    bridgeByQrLink,
    criteria.campaign_id,
    criteria.content_id,
    bridgeByQrLink,
    criteria.content_id,
    criteria.qr_link_id,
    criteria.qr_link_id
  );
  const settingsCache = new Map();
  const groups = new Map();
  for (const row of rows) {
    const qrLinkId = cleanId(row.qr_link_id);
    if (allowedQrLinkIds && !allowedQrLinkIds.has(qrLinkId)) continue;
    const metricDate = reportBusinessDateFor(row.store_id, "", row.scanned_at, settingsCache);
    if (!reportDateInRange(metricDate, criteria)) continue;
    const key = [
      cleanId(row.store_id),
      cleanId(row.qr_link_id),
      cleanId(row.campaign_id),
      cleanId(row.content_id),
      cleanId(row.offer_revision_id)
    ].join("|");
    const target = groups.get(key) || {
      store_id: cleanId(row.store_id),
      qr_link_id: cleanId(row.qr_link_id),
      label: cleanString(row.label),
      destination_type: cleanString(row.destination_type),
      campaign_id: cleanId(row.campaign_id),
      content_id: cleanId(row.content_id),
      offer_id: cleanId(row.offer_id),
      offer_revision_id: cleanId(row.offer_revision_id),
      qr_scan_count: 0
    };
    target.qr_scan_count += 1;
    groups.set(key, target);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.qr_scan_count - a.qr_scan_count)
    .slice(0, 50);
}

function buildReportOrderBreakdown(criteria) {
  const rows = listReportCounterOrderRows(criteria, `
    store_id, campaign_id, content_id, offer_id, offer_revision_id,
    status, business_date, total_amount
  `);
  const groups = new Map();
  for (const row of rows) {
    const key = [
      cleanId(row.store_id),
      cleanId(row.campaign_id),
      cleanId(row.content_id),
      cleanId(row.offer_revision_id)
    ].join("|");
    const target = groups.get(key) || {
      store_id: cleanId(row.store_id),
      campaign_id: cleanId(row.campaign_id),
      content_id: cleanId(row.content_id),
      offer_id: cleanId(row.offer_id),
      offer_revision_id: cleanId(row.offer_revision_id),
      issued_count: 0,
      redeemed_count: 0,
      cancelled_count: 0,
      expired_count: 0,
      total_amount: 0,
      redeemed_amount: 0
    };
    const amount = Math.max(0, asInteger(row.total_amount) || 0);
    target.issued_count += 1;
    target.total_amount += amount;
    if (row.status === "redeemed") {
      target.redeemed_count += 1;
      target.redeemed_amount += amount;
    } else if (row.status === "cancelled") {
      target.cancelled_count += 1;
    } else if (row.status === "expired") {
      target.expired_count += 1;
    }
    groups.set(key, target);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.issued_count - a.issued_count)
    .slice(0, 50);
}

function createMonthlyReportSnapshot(input = {}) {
  const criteria = normalizeReportCriteria(input);
  assertReportReadModelScope(criteria);
  if (!criteria.month || criteria.from !== monthBounds(criteria.month).from || criteria.to !== monthBounds(criteria.month).to) {
    throw requestError("monthly snapshot requires a full month; pass month as YYYY-MM", 400);
  }

  const status = cleanString(input.status || "draft");
  if (!REPORT_SNAPSHOT_STATUS.has(status)) {
    throw requestError(`status must be one of: ${Array.from(REPORT_SNAPSHOT_STATUS).join(", ")}`, 400);
  }
  const snapshotKey = reportSnapshotKey(criteria, "monthly_summary");
  const existing = db.prepare("SELECT * FROM report_snapshots WHERE snapshot_key = ?").get(snapshotKey);
  if (existing && !normalizeBooleanFlag(input.replace || input.overwrite)) {
    throw requestError("Monthly report snapshot already exists for this scope", 409);
  }

  const rebuilt = rebuildReportDailyStoreMetrics(criteria);
  const report = buildReportSummary(criteria, { dailyRows: rebuilt.rows, generatedAt: rebuilt.generated_at });
  const summaryJson = JSON.stringify(report);
  const metricsSha256 = reportMetricsSha256(report);
  const now = nowIso();
  const title = cleanString(input.title || `Misell monthly report ${criteria.month}`).slice(0, 160);
  const notes = cleanString(input.notes).slice(0, 1000);
  const createdBy = cleanString(input.created_by || input.createdBy || "admin").slice(0, 120);

  const saveSnapshot = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE report_snapshots SET
          campaign_id = ?,
          content_id = ?,
          period_start = ?,
          period_end = ?,
          snapshot_type = 'monthly_summary',
          metrics_json = ?,
          notes = ?,
          created_by = ?,
          tenant_id = ?,
          store_id = ?,
          screen_group_id = '',
          report_type = 'monthly_summary',
          status = ?,
          title = ?,
          summary_json = ?,
          generated_at = ?,
          published_at = ?,
          metrics_sha256 = ?
        WHERE snapshot_id = ?
      `).run(
        criteria.campaign_id || null,
        criteria.content_id || null,
        criteria.from,
        criteria.to,
        summaryJson,
        notes,
        createdBy,
        criteria.tenant_id || null,
        criteria.store_id || null,
        status,
        title,
        summaryJson,
        rebuilt.generated_at,
        status === "published" ? now : null,
        metricsSha256,
        existing.snapshot_id
      );
      recordAuditLog("admin", createdBy, "report_snapshot.replace", "report_snapshot", existing.snapshot_id, existing, getReportSnapshot(existing.snapshot_id), { snapshot_key: snapshotKey }, now);
      return existing.snapshot_id;
    }

    const snapshotId = nextEntityId("rpts", `${criteria.month}-${criteria.store_id || criteria.tenant_id || "all"}`);
    db.prepare(`
      INSERT INTO report_snapshots (
        snapshot_id, campaign_id, advertiser_id, period_start, period_end,
        snapshot_type, metrics_json, notes, created_by, created_at,
        tenant_id, store_id, screen_group_id, content_id, report_type, status, title,
        summary_json, generated_at, published_at, snapshot_key, metrics_sha256
      ) VALUES (?, ?, NULL, ?, ?, 'monthly_summary', ?, ?, ?, ?, ?, ?, '', ?, 'monthly_summary', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      criteria.campaign_id || null,
      criteria.from,
      criteria.to,
      summaryJson,
      notes,
      createdBy,
      now,
      criteria.tenant_id || null,
      criteria.store_id || null,
      criteria.content_id || null,
      status,
      title,
      summaryJson,
      rebuilt.generated_at,
      status === "published" ? now : null,
      snapshotKey,
      metricsSha256
    );
    recordAuditLog("admin", createdBy, "report_snapshot.create", "report_snapshot", snapshotId, null, getReportSnapshot(snapshotId), { snapshot_key: snapshotKey }, now);
    return snapshotId;
  });

  return getReportSnapshot(saveSnapshot());
}

function listReportSnapshots(filters = {}) {
  const params = [
    filters.report_type,
    filters.report_type,
    filters.tenant_id,
    filters.tenant_id,
    filters.store_id,
    filters.store_id,
    filters.campaign_id,
    filters.campaign_id,
    filters.content_id,
    filters.content_id,
    filters.status,
    filters.status,
    filters.limit
  ];
  const monthWhere = filters.month ? "AND period_start = ? AND period_end = ?" : "";
  if (filters.month) {
    const bounds = monthBounds(filters.month);
    params.splice(params.length - 1, 0, bounds.from, bounds.to);
  }
  return db.prepare(`
    SELECT * FROM report_snapshots
    WHERE (? = '' OR COALESCE(report_type, snapshot_type) = ?)
      AND (? = '' OR tenant_id = ?)
      AND (? = '' OR store_id = ?)
      AND (? = '' OR campaign_id = ?)
      AND (? = '' OR content_id = ?)
      AND (? = '' OR status = ?)
      ${monthWhere}
    ORDER BY period_start DESC, created_at DESC, id DESC
    LIMIT ?
  `).all(...params).map(publicReportSnapshot);
}

function getReportSnapshot(snapshotId) {
  const row = db.prepare("SELECT * FROM report_snapshots WHERE snapshot_id = ?").get(cleanId(snapshotId));
  return row ? publicReportSnapshot(row, { includeSummary: true }) : null;
}

function publicReportSnapshot(row, options = {}) {
  const summary = parseJson(row.summary_json || row.metrics_json || "{}", {});
  const snapshot = {
    snapshot_id: cleanId(row.snapshot_id),
    snapshot_key: cleanString(row.snapshot_key),
    report_type: cleanString(row.report_type || row.snapshot_type || "monthly_summary"),
    snapshot_type: cleanString(row.snapshot_type || row.report_type || "monthly_summary"),
    status: cleanString(row.status || "draft"),
    title: cleanString(row.title),
    tenant_id: cleanId(row.tenant_id),
    store_id: cleanId(row.store_id),
    screen_group_id: cleanId(row.screen_group_id),
    campaign_id: cleanId(row.campaign_id),
    content_id: cleanId(row.content_id),
    advertiser_id: cleanId(row.advertiser_id),
    period_start: cleanDateKey(row.period_start),
    period_end: cleanDateKey(row.period_end),
    metrics_sha256: cleanString(row.metrics_sha256),
    notes: cleanString(row.notes),
    created_by: cleanString(row.created_by),
    generated_at: cleanString(row.generated_at),
    published_at: cleanString(row.published_at),
    created_at: cleanString(row.created_at)
  };
  if (options.includeSummary) {
    snapshot.summary = summary;
  } else {
    snapshot.totals = summary?.totals || {};
  }
  return snapshot;
}

function reportMetricsSha256(report) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableReportPayloadForHash(report)))
    .digest("hex");
}

function stableReportPayloadForHash(value) {
  if (Array.isArray(value)) {
    return value.map(stableReportPayloadForHash);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "generated_at") continue;
    result[key] = stableReportPayloadForHash(value[key]);
  }
  return result;
}

function reportCriteriaFilters(criteria) {
  return {
    tenant_id: criteria.tenant_id,
    store_id: criteria.store_id,
    campaign_id: criteria.campaign_id,
    content_id: criteria.content_id,
    item_type: criteria.item_type,
    ad_slot_id: criteria.ad_slot_id,
    creative_id: criteria.creative_id,
    qr_link_id: criteria.qr_link_id,
    manifest_hash: criteria.manifest_hash
  };
}

function normalizeReportItemTypeFilter(value) {
  const itemType = cleanString(value).toLowerCase();
  if (!itemType) return "";
  if (!["content", "ad", "sponsor"].includes(itemType)) {
    throw requestError("item_type must be content, ad, or sponsor", 400);
  }
  return itemType;
}

function assertReportReadModelScope(criteria) {
  const unsupported = [
    ["item_type", criteria.item_type],
    ["ad_slot_id", criteria.ad_slot_id],
    ["creative_id", criteria.creative_id],
    ["qr_link_id", criteria.qr_link_id],
    ["manifest_hash", criteria.manifest_hash]
  ].filter(([, value]) => cleanString(value));
  if (unsupported.length > 0) {
    throw requestError(
      `report read model does not support ad-granular filters: ${unsupported.map(([key]) => key).join(", ")}`,
      400
    );
  }
}

function cachedReportStoreSettings(storeId, tenantId, settingsCache) {
  const normalizedStoreId = cleanId(storeId);
  if (settingsCache.has(normalizedStoreId)) return settingsCache.get(normalizedStoreId);
  const settings = getStoreSettings(normalizedStoreId, { withDefaults: true }) || {
    tenant_id: cleanId(tenantId),
    store_id: normalizedStoreId,
    timezone: DEFAULT_TIMEZONE,
    business_day_start_time: "00:00"
  };
  settingsCache.set(normalizedStoreId, settings);
  return settings;
}

function reportBusinessDateFor(storeId, tenantId, isoValue, settingsCache) {
  const settings = cachedReportStoreSettings(storeId, tenantId, settingsCache);
  return businessDateFor(isoValue, settings.timezone, settings.business_day_start_time);
}

function reportBroadIsoRange(criteria) {
  return {
    from: `${addDaysToDateKey(criteria.from, -2)}T00:00:00.000Z`,
    to: `${addDaysToDateKey(criteria.to_exclusive, 2)}T00:00:00.000Z`
  };
}

function reportDateInRange(dateKey, criteria) {
  return Boolean(dateKey && dateKey >= criteria.from && dateKey < criteria.to_exclusive);
}

function reportDailyMetricKey(criteria, metricDate, tenantId, storeId) {
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    metric_date: metricDate,
    period_start: criteria.from,
    period_end: criteria.to,
    tenant_id: cleanId(tenantId),
    store_id: cleanId(storeId),
    campaign_id: criteria.campaign_id,
    content_id: criteria.content_id
  })).digest("hex").slice(0, 40);
  return `rdm-${hash}`;
}

function reportSnapshotKey(criteria, reportType) {
  const hash = crypto.createHash("sha256").update(JSON.stringify({
    report_type: reportType,
    period_start: criteria.from,
    period_end: criteria.to,
    tenant_id: criteria.tenant_id,
    store_id: criteria.store_id,
    campaign_id: criteria.campaign_id,
    content_id: criteria.content_id
  })).digest("hex").slice(0, 40);
  return `rps-${hash}`;
}

function isReportPlayStarted(row) {
  const eventType = cleanString(row.event_type).toLowerCase();
  const result = cleanString(row.result).toLowerCase();
  if (!eventType && !result) return true;
  return eventType.includes("started") || result === "started" || result === "playback" || result === "played";
}

function isReportPlayCompleted(row) {
  const eventType = cleanString(row.event_type).toLowerCase();
  const result = cleanString(row.result).toLowerCase();
  return eventType.includes("completed") || eventType.includes("ended") || ["completed", "success", "ended", "done"].includes(result);
}

function isReportPlayFailed(row) {
  const eventType = cleanString(row.event_type).toLowerCase();
  const result = cleanString(row.result).toLowerCase();
  return eventType.includes("failed") || eventType.includes("error") || ["failed", "error"].includes(result);
}

function cleanDateKey(value) {
  const text = cleanString(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? "" : text;
}

function cleanMonthKey(value) {
  const text = cleanString(value).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 7) !== text ? "" : text;
}

function monthBounds(monthKey) {
  const month = cleanMonthKey(monthKey);
  if (!month) throw requestError("month must be YYYY-MM", 400);
  const from = `${month}-01`;
  const start = new Date(`${from}T00:00:00.000Z`);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const to = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
  return { from, to, to_exclusive: next.toISOString().slice(0, 10) };
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${cleanDateKey(dateKey)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeysBetween(fromDate, toExclusiveDate) {
  const dates = [];
  let current = cleanDateKey(fromDate);
  const end = cleanDateKey(toExclusiveDate);
  while (current && end && current < end) {
    dates.push(current);
    current = addDaysToDateKey(current, 1);
  }
  return dates;
}

function daysSinceIso(nowValue, pastValue) {
  const nowMs = Date.parse(cleanString(nowValue));
  const pastMs = Date.parse(cleanString(pastValue));
  if (!Number.isFinite(nowMs) || !Number.isFinite(pastMs)) return null;
  return Math.max(0, Math.floor((nowMs - pastMs) / 86400000));
}

function addDaysToIso(value, days) {
  const sourceMs = Date.parse(cleanString(value));
  if (!Number.isFinite(sourceMs)) return "";
  const dayCount = Math.max(0, asInteger(days) || 0);
  return new Date(sourceMs + (dayCount * 86400000)).toISOString();
}

function resolveCounterOrderOfferRevision(input) {
  const offerRevisionId = cleanId(input.offer_revision_id || input.offerRevisionId);
  if (offerRevisionId) {
    const revision = getOfferRevision(offerRevisionId);
    if (!revision) throw requestError("offer_revision_id was not found", 404);
    return revision;
  }
  const offerId = cleanId(input.offer_id || input.offerId);
  if (!offerId) throw requestError("offer_revision_id or offer_id is required", 400);
  const revision = resolveActiveOfferRevision(offerId);
  if (!revision) throw requestError("Offer has no active revision", 400);
  return revision;
}

function resolveActiveOfferRevision(offerId) {
  const offer = db.prepare("SELECT * FROM offers WHERE offer_id = ?").get(cleanId(offerId));
  if (!offer?.current_offer_revision_id) return null;
  return getOfferRevision(offer.current_offer_revision_id);
}

function validateCounterOrderIssuance(revision, input, now) {
  if (revision.status !== "active") throw requestError("Offer revision is not active", 409);
  if (revision.valid_from && now < revision.valid_from) throw requestError("Offer revision is not valid yet", 409);
  if (revision.valid_until && now > revision.valid_until) throw requestError("Offer revision has expired", 409);
  const storeSettings = getStoreSettings(revision.store_id, { withDefaults: true });
  if (storeSettings?.order_issue_cutoff_time && isAfterBusinessCutoff(now, storeSettings.timezone, storeSettings.business_day_start_time, storeSettings.order_issue_cutoff_time)) {
    throw requestError("Store order issue cutoff time has passed", 409);
  }
  if (revision.order_issue_cutoff_time && isAfterBusinessCutoff(now, storeSettings.timezone, storeSettings.business_day_start_time, revision.order_issue_cutoff_time)) {
    throw requestError("Offer order issue cutoff time has passed", 409);
  }
  const activeStatuses = ["issued", "redeemed"];
  if (revision.max_orders_total !== null && revision.max_orders_total !== undefined) {
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM counter_orders
      WHERE offer_revision_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")})
    `).get(revision.offer_revision_id, ...activeStatuses).count;
    if (count >= revision.max_orders_total) throw requestError("Offer total order limit reached", 409);
  }
  if (revision.max_orders_per_day !== null && revision.max_orders_per_day !== undefined) {
    const businessDate = businessDateFor(now, storeSettings.timezone, storeSettings.business_day_start_time);
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM counter_orders
      WHERE offer_revision_id = ? AND business_date = ? AND status IN (${activeStatuses.map(() => "?").join(",")})
    `).get(revision.offer_revision_id, businessDate, ...activeStatuses).count;
    if (count >= revision.max_orders_per_day) throw requestError("Offer daily order limit reached", 409);
  }
  const visitId = cleanId(input.visit_id || input.visitId);
  if (revision.max_orders_per_visit !== null && revision.max_orders_per_visit !== undefined && !visitId) {
    throw requestError("visit_id is required when max_orders_per_visit is set", 400);
  }
  if (revision.max_orders_per_visit !== null && revision.max_orders_per_visit !== undefined) {
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM counter_orders
      WHERE offer_revision_id = ? AND visit_id = ? AND status IN (${activeStatuses.map(() => "?").join(",")})
    `).get(revision.offer_revision_id, visitId, ...activeStatuses).count;
    if (count >= revision.max_orders_per_visit) throw requestError("Offer visit order limit reached", 409);
  }
}

function nextOrderNumber(storeId, businessDate) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM counter_orders
    WHERE store_id = ? AND business_date = ?
  `).get(cleanId(storeId), cleanString(businessDate));
  return String((asInteger(row?.count) || 0) + 1).padStart(3, "0");
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
  const storeId = cleanId(input.store_id ?? input.storeId ?? input.site_id ?? input.siteId ?? existing.store_id ?? existing.site_id);
  const screenGroupId = cleanId(input.screen_group_id ?? input.screenGroupId ?? input.display_wall_id ?? input.displayWallId ?? existing.screen_group_id ?? existing.display_wall_id);
  const screenSlotId = cleanId(input.screen_slot_id ?? input.screenSlotId ?? input.screen_id ?? input.screenId ?? existing.screen_slot_id ?? existing.screen_id);
  const manifestSchemaVersion = Math.max(1, asInteger(input.manifest_schema_version ?? input.manifestSchemaVersion ?? existing.manifest_schema_version) || 1);
  const manifestVersion = Math.max(1, asInteger(input.manifest_version ?? input.manifestVersion ?? existing.manifest_version) || 1);
  const lifecycleStatus = cleanString(input.lifecycle_status ?? input.lifecycleStatus ?? existing.lifecycle_status ?? status) || status;
  const manifestContract = buildManifestContract({
    tenant_id: tenantId,
    store_id: storeId,
    screen_group_id: screenGroupId,
    screen_slot_id: screenSlotId,
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
    store_id: storeId,
    screen_group_id: screenGroupId,
    screen_slot_id: screenSlotId,
    manifest_schema_version: manifestSchemaVersion,
    manifest_version: manifestVersion,
    content_hash: cleanString(input.content_hash ?? input.contentHash) || manifestContract.content_hash,
    lifecycle_status: lifecycleStatus,
    playlist,
    assets,
    assets_supplied: assetsSupplied
  };
}

function assertActiveContentPatchAllowed(existing, input) {
  if (existing.status !== "active") return;
  const supplied = (field) => Object.prototype.hasOwnProperty.call(input, field);
  const forbiddenFields = [
    "playlist",
    "playlist_json",
    "assets",
    "asset_ids",
    "assetIds"
  ];
  const touchedForbidden = forbiddenFields.find((field) => supplied(field));
  if (touchedForbidden) {
    throw requestError("ACTIVE_CONTENT_IMMUTABLE: clone active content to a new draft before changing playlist or assets", 409);
  }
  if (supplied("playlist_version") && cleanString(input.playlist_version) !== cleanString(existing.playlist_version)) {
    throw requestError("ACTIVE_CONTENT_IMMUTABLE: playlist_version cannot change on active content", 409);
  }
  if (supplied("release_channel") && cleanString(input.release_channel) !== cleanString(existing.release_channel)) {
    throw requestError("ACTIVE_CONTENT_IMMUTABLE: release_channel cannot change on active content", 409);
  }
  if (supplied("status")) {
    const nextStatus = cleanString(input.status);
    if (nextStatus !== "active" && nextStatus !== "retired") {
      throw requestError("ACTIVE_CONTENT_IMMUTABLE: active content can only remain active or be retired", 409);
    }
  }
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
  const itemType = normalizePlaylogItemType(value.item_type || value.itemType || value.type);
  const durationSeconds = normalizedLimit(value.duration ?? value.duration_seconds ?? value.durationSeconds, 10, 1, 300);
  const normalized = {
    id,
    item_id: id,
    item_type: itemType,
    type: itemType,
    name: cleanString(value.name || id).slice(0, 160),
    enabled: value.enabled !== false,
    layout,
    duration: durationSeconds,
    duration_seconds: durationSeconds,
    start: cleanString(value.start),
    end: cleanString(value.end),
    days_of_week: normalizeDaysOfWeek(value.days_of_week),
    campaign_id: cleanString(value.campaign_id).slice(0, 120),
    content_id: cleanId(value.content_id || value.contentId),
    ad_slot_id: cleanId(value.ad_slot_id || value.adSlotId),
    creative_id: cleanId(value.creative_id || value.creativeId),
    qr_link_id: cleanId(value.qr_link_id || value.qrLinkId),
    content_layer: normalizeContentLayer(value.content_layer || value.contentLayer),
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

function normalizeContentLayer(value) {
  const layer = cleanString(value).toLowerCase();
  if (!layer) return "";
  if (!CONTENT_LAYER_TYPES.has(layer)) {
    throw new Error(`content_layer must be one of: ${Array.from(CONTENT_LAYER_TYPES).join(", ")}`);
  }
  return layer;
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
    device_commands: listDeviceCommands({ device_id: deviceId, limit: 20 }),
    token_events: db.prepare("SELECT * FROM device_token_events WHERE device_id = ? ORDER BY created_at DESC LIMIT 50").all(deviceId),
    log_bundles: listDeviceLogBundles(deviceId, 20),
    asset_states: listDeviceAssetStates(deviceId, 50),
    heartbeats: db.prepare("SELECT * FROM heartbeats WHERE device_id = ? ORDER BY received_at DESC LIMIT 100").all(deviceId),
    playlogs: db.prepare("SELECT * FROM playlogs WHERE device_id = ? ORDER BY received_at DESC LIMIT 50").all(deviceId),
    error_logs: db.prepare("SELECT * FROM error_logs WHERE device_id = ? ORDER BY received_at DESC LIMIT 50").all(deviceId),
    alerts: db.prepare("SELECT * FROM alerts WHERE device_id = ? AND status = 'open' ORDER BY last_seen DESC").all(deviceId)
  };
}

function listDeviceCommands(filters = {}) {
  const conditions = [];
  const params = {};
  const tenantId = cleanId(filters.tenant_id);
  if (tenantId) {
    conditions.push("tenant_id = @tenant_id");
    params.tenant_id = tenantId;
  }
  const storeId = cleanId(filters.store_id);
  if (storeId) {
    conditions.push("store_id = @store_id");
    params.store_id = storeId;
  }
  const screenGroupId = cleanId(filters.screen_group_id);
  if (screenGroupId) {
    conditions.push("screen_group_id = @screen_group_id");
    params.screen_group_id = screenGroupId;
  }
  const deviceId = cleanId(filters.device_id);
  if (deviceId) {
    conditions.push("device_id = @device_id");
    params.device_id = deviceId;
  }
  const status = cleanString(filters.status);
  if (status) {
    if (!DEVICE_COMMAND_STATUS.has(status)) {
      throw requestError(`status must be one of: ${Array.from(DEVICE_COMMAND_STATUS).join(", ")}`, 400);
    }
    conditions.push("status = @status");
    params.status = status;
  }
  const limit = normalizedLimit(filters.limit, 100, 1, 500);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`
    SELECT * FROM device_commands
    ${where}
    ORDER BY requested_at DESC, id DESC
    LIMIT @limit
  `).all({ ...params, limit }).map(publicDeviceCommand);
}

function listPendingDeviceCommands(device, limit = 5) {
  return db.prepare(`
    SELECT * FROM device_commands
    WHERE device_id = ?
      AND status = 'queued'
      AND ttl_expires_at > ?
    ORDER BY requested_at ASC, id ASC
    LIMIT ?
  `).all(device.device_id, nowIso(), normalizedLimit(limit, 5, 1, 20)).map(publicDeviceCommand);
}

function createDeviceCommand(deviceId, body, actor) {
  const device = db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId);
  if (!device) throw requestError("Device not found", 404);
  if (device.token_status === "revoked") throw requestError("Device token is revoked", 409);
  if (device.status === "retired" || device.status === "lost") {
    throw requestError("Device is not allowed to receive commands", 409);
  }

  const input = normalizeDeviceCommandCreateInput(body);
  const now = nowIso();
  const commandId = nextEntityId("dcmd", `${deviceId}-${input.command_type}`);
  const expiresAt = new Date(Date.parse(now) + input.ttl_seconds * 1000).toISOString();
  const paramsJson = JSON.stringify(input.params);
  const actorId = cleanString(actor?.actor_id || "admin").slice(0, 120) || "admin";

  const createCommand = db.transaction(() => {
    db.prepare(`
      INSERT INTO device_commands (
        device_command_id, tenant_id, store_id, screen_group_id, device_id,
        command_type, params_json, status, requested_by_user_id, requested_at,
        ttl_expires_at, result_json, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, '{}', '', ?)
    `).run(
      commandId,
      device.tenant_id,
      device.store_id,
      device.screen_group_id,
      device.device_id,
      input.command_type,
      paramsJson,
      actorId,
      now,
      expiresAt,
      now
    );
    const after = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
    const auditLogId = recordAuditLog(
      "admin",
      actorId,
      "device_command.create",
      "device_command",
      commandId,
      null,
      publicDeviceCommand(after),
      { role: actor?.role || "", device_id: device.device_id },
      now
    );
    if (auditLogId) {
      db.prepare("UPDATE device_commands SET audit_log_id = ? WHERE device_command_id = ?").run(auditLogId, commandId);
    }
  });
  createCommand();

  return publicDeviceCommand(db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId));
}

function cancelDeviceCommand(commandId, body, actor) {
  const now = nowIso();
  const actorId = cleanString(actor?.actor_id || "admin").slice(0, 120) || "admin";
  const reason = cleanText(body.reason || "cancelled by admin").slice(0, 500);
  const payload = {
    status: "cancelled",
    reason,
    actor_role: cleanString(actor?.role),
    at: now
  };
  let after = null;
  const cancel = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
    if (!existing) throw requestError("Device command not found", 404);
    if (DEVICE_COMMAND_TERMINAL_STATUS.has(existing.status)) {
      throw requestError("Device command is already terminal", 409);
    }
    if (existing.status !== "queued") {
      throw requestError("Device command has already been claimed", 409);
    }

    const result = db.prepare(`
      UPDATE device_commands SET
        status = 'cancelled',
        cancelled_at = ?,
        cancelled_by_user_id = ?,
        completed_at = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
      WHERE device_command_id = ?
        AND status = 'queued'
    `).run(now, actorId, now, JSON.stringify(payload), reason, now, commandId);
    if (result.changes !== 1) {
      throw requestError("Device command could not be cancelled", 409);
    }

    after = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
    recordAuditLog(
      "admin",
      actorId,
      "device_command.cancel",
      "device_command",
      commandId,
      publicDeviceCommand(existing),
      publicDeviceCommand(after),
      { role: actor?.role || "", reason },
      now
    );
  });
  cancel();
  return publicDeviceCommand(after);
}

function forceCancelDeviceCommand(commandId, body, actor) {
  const now = nowIso();
  const actorId = cleanString(actor?.actor_id || "admin").slice(0, 120) || "admin";
  const reason = cleanText(body.reason || "force-cancelled by admin").slice(0, 500);
  let after = null;
  const forceCancel = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
    if (!existing) throw requestError("Device command not found", 404);
    if (DEVICE_COMMAND_TERMINAL_STATUS.has(existing.status)) {
      throw requestError("Device command is already terminal", 409);
    }

    const payload = {
      status: "force_cancelled",
      previous_status: existing.status,
      reason,
      actor_role: cleanString(actor?.role),
      at: now
    };
    const result = db.prepare(`
      UPDATE device_commands SET
        status = 'force_cancelled',
        cancelled_at = ?,
        cancelled_by_user_id = ?,
        completed_at = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
      WHERE device_command_id = ?
        AND status NOT IN (${sqlPlaceholders(Array.from(DEVICE_COMMAND_TERMINAL_STATUS).length)})
    `).run(
      now,
      actorId,
      now,
      JSON.stringify(payload),
      reason,
      now,
      commandId,
      ...Array.from(DEVICE_COMMAND_TERMINAL_STATUS)
    );
    if (result.changes !== 1) {
      throw requestError("Device command could not be force-cancelled", 409);
    }

    after = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
    recordAuditLog(
      "admin",
      actorId,
      "device_command.force_cancel",
      "device_command",
      commandId,
      publicDeviceCommand(existing),
      publicDeviceCommand(after),
      { role: actor?.role || "", reason, previous_status: existing.status },
      now
    );
  });
  forceCancel();
  return publicDeviceCommand(after);
}

function claimDeviceCommand(device, commandId, body) {
  maintainDeviceCommands();
  const existing = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ? AND device_id = ?").get(commandId, device.device_id);
  if (!existing) throw requestError("Device command not found", 404);
  if (existing.status !== "queued") throw requestError("Device command is not queued", 409);

  const now = requestNowIso(body);
  if (existing.ttl_expires_at <= now) {
    expireQueuedDeviceCommands(now);
    throw requestError("Device command has expired", 409);
  }

  const claimToken = crypto.randomBytes(24).toString("base64url");
  const runnerId = cleanString(body.runner_id || body.runnerId || "").slice(0, 120);
  const result = db.prepare(`
    UPDATE device_commands SET
      status = 'claimed',
      claimed_at = ?,
      claim_token = ?,
      claimed_by_runner_id = ?,
      updated_at = ?
    WHERE device_command_id = ?
      AND device_id = ?
      AND status = 'queued'
      AND ttl_expires_at > ?
  `).run(now, claimToken, runnerId, now, commandId, device.device_id, now);
  if (result.changes !== 1) {
    throw requestError("Device command could not be claimed", 409);
  }

  const after = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
  recordAuditLog(
    "device",
    device.device_id,
    "device_command.claim",
    "device_command",
    commandId,
    publicDeviceCommand(existing),
    publicDeviceCommand(after),
    { runner_id: runnerId },
    now
  );
  return publicDeviceCommand(after, { include_claim_token: true });
}

function completeDeviceCommand(device, commandId, body) {
  maintainDeviceCommands();
  const now = requestNowIso(body);
  const existing = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ? AND device_id = ?").get(commandId, device.device_id);
  if (!existing) throw requestError("Device command not found", 404);
  if (existing.status !== "claimed" && existing.status !== "running") {
    throw requestError("Device command is not claimed", 409);
  }
  const claimToken = cleanString(body.claim_token || body.claimToken);
  if (!claimToken || claimToken !== existing.claim_token) {
    throw requestError("Device command claim token is invalid", 403);
  }

  const input = normalizeDeviceCommandResult(body);
  const resultJson = JSON.stringify({
    status: input.status,
    exit_code: input.exit_code,
    summary: input.summary,
    runner_id: input.runner_id,
    started_at: input.started_at,
    completed_at: now,
    summary_truncated: input.summary_truncated
  });
  const result = db.prepare(`
    UPDATE device_commands SET
      status = ?,
      started_at = COALESCE(NULLIF(started_at, ''), ?),
      completed_at = ?,
      result_json = ?,
      error = ?,
      updated_at = ?
    WHERE device_command_id = ?
      AND device_id = ?
      AND claim_token = ?
      AND status IN ('claimed', 'running')
  `).run(
    input.status,
    input.started_at || now,
    now,
    resultJson,
    input.status === "failed" ? input.summary : "",
    now,
    commandId,
    device.device_id,
    claimToken
  );
  if (result.changes !== 1) {
    throw requestError("Device command result was not accepted", 409);
  }

  const after = db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(commandId);
  recordAuditLog(
    "device",
    device.device_id,
    "device_command.result",
    "device_command",
    commandId,
    publicDeviceCommand(existing),
    publicDeviceCommand(after),
    { status: input.status, runner_id: input.runner_id },
    now
  );
  return publicDeviceCommand(after);
}

function maintainDeviceCommands(now = nowIso()) {
  const expired = expireQueuedDeviceCommands(now);
  const stale = markStaleDeviceCommands(now);
  const purged = purgeTerminalDeviceCommands(now);
  return { expired, stale, purged };
}

function expireQueuedDeviceCommands(now = nowIso()) {
  const expired = db.prepare(`
    SELECT * FROM device_commands
    WHERE status = 'queued'
      AND ttl_expires_at <= ?
  `).all(now);
  if (expired.length === 0) return 0;

  const expire = db.transaction((rows) => {
    for (const row of rows) {
      const resultPayload = {
        status: "expired",
        reason: "ttl expired before device claim",
        at: now
      };
      db.prepare(`
        UPDATE device_commands SET
          status = 'expired',
          expired_at = ?,
          completed_at = ?,
          result_json = ?,
          error = ?,
          updated_at = ?
        WHERE device_command_id = ? AND status = 'queued'
      `).run(now, now, JSON.stringify(resultPayload), resultPayload.reason, now, row.device_command_id);
      recordAuditLog(
        "system",
        "device-command-expiry",
        "device_command.expire",
        "device_command",
        row.device_command_id,
        publicDeviceCommand(row),
        publicDeviceCommand(db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(row.device_command_id)),
        {},
        now
      );
    }
  });
  expire(expired);
  return expired.length;
}

function markStaleDeviceCommands(now = nowIso()) {
  const cutoff = new Date(Date.parse(now) - DEVICE_COMMAND_CLAIM_LEASE_SECONDS * 1000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM device_commands
    WHERE status IN ('claimed', 'running')
      AND COALESCE(NULLIF(claimed_at, ''), NULLIF(started_at, ''), updated_at, requested_at) <= ?
  `).all(cutoff);
  if (rows.length === 0) return 0;

  const mark = db.transaction((commands) => {
    for (const row of commands) {
      const payload = {
        status: "stale",
        previous_status: row.status,
        reason: `claim lease expired after ${DEVICE_COMMAND_CLAIM_LEASE_SECONDS}s without result`,
        at: now
      };
      const result = db.prepare(`
        UPDATE device_commands SET
          status = 'stale',
          completed_at = ?,
          result_json = ?,
          error = ?,
          updated_at = ?
        WHERE device_command_id = ?
          AND status IN ('claimed', 'running')
          AND COALESCE(NULLIF(claimed_at, ''), NULLIF(started_at, ''), updated_at, requested_at) <= ?
      `).run(now, JSON.stringify(payload), payload.reason, now, row.device_command_id, cutoff);
      if (result.changes !== 1) continue;
      recordAuditLog(
        "system",
        "device-command-lease",
        "device_command.stale",
        "device_command",
        row.device_command_id,
        publicDeviceCommand(row),
        publicDeviceCommand(db.prepare("SELECT * FROM device_commands WHERE device_command_id = ?").get(row.device_command_id)),
        { claim_lease_seconds: DEVICE_COMMAND_CLAIM_LEASE_SECONDS },
        now
      );
    }
  });
  mark(rows);
  return rows.length;
}

function purgeTerminalDeviceCommands(now = nowIso()) {
  const cutoff = new Date(Date.parse(now) - DEVICE_COMMAND_RETENTION_DAYS * 86400000).toISOString();
  const terminalStatuses = Array.from(DEVICE_COMMAND_TERMINAL_STATUS);
  const rows = db.prepare(`
    SELECT * FROM device_commands
    WHERE status IN (${sqlPlaceholders(terminalStatuses.length)})
      AND completed_at IS NOT NULL
      AND completed_at != ''
      AND completed_at <= ?
    ORDER BY completed_at ASC, id ASC
    LIMIT 500
  `).all(...terminalStatuses, cutoff);
  if (rows.length === 0) return 0;

  const purge = db.transaction((commands) => {
    const ids = commands.map((row) => row.id);
    const result = db.prepare(`
      DELETE FROM device_commands
      WHERE id IN (${sqlPlaceholders(ids.length)})
    `).run(...ids);
    recordAuditLog(
      "system",
      "device-command-retention",
      "device_command.purge",
      "device_command",
      "device-command-retention",
      null,
      null,
      {
        retention_days: DEVICE_COMMAND_RETENTION_DAYS,
        cutoff,
        selected_count: commands.length,
        deleted_count: result.changes,
        statuses: terminalStatuses
      },
      now
    );
  });
  purge(rows);
  return rows.length;
}

function normalizeDeviceCommandCreateInput(input) {
  const commandType = cleanString(input.command_type || input.commandType);
  if (!DEVICE_COMMAND_TYPES.has(commandType)) {
    throw requestError(`command_type must be one of: ${Array.from(DEVICE_COMMAND_TYPES).join(", ")}`, 400);
  }
  const ttlSeconds = normalizedLimit(input.ttl_seconds || input.ttlSeconds, DEVICE_COMMAND_DEFAULT_TTL_SECONDS, 1, DEVICE_COMMAND_MAX_TTL_SECONDS);
  return {
    command_type: commandType,
    ttl_seconds: ttlSeconds,
    params: normalizeDeviceCommandParams(input)
  };
}

function normalizeDeviceCommandParams(input) {
  const source = parseParamsObject(input.params_json ?? input.params ?? {});
  const bodyFields = {
    reason: input.reason,
    label: input.label
  };
  const combined = { ...source, ...Object.fromEntries(Object.entries(bodyFields).filter(([, value]) => value !== undefined)) };
  const allowedKeys = new Set(["reason", "label"]);
  for (const key of Object.keys(combined)) {
    if (!allowedKeys.has(key)) {
      throw requestError(`params.${key} is not allowed for device commands`, 400);
    }
  }
  return {
    reason: cleanText(combined.reason).slice(0, 500),
    label: cleanString(combined.label).slice(0, 120)
  };
}

function parseParamsObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    const parsed = parseJson(value, null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw requestError("params_json must be a JSON object", 400);
    }
    return parsed;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw requestError("params must be an object", 400);
  }
  return value;
}

function normalizeDeviceCommandResult(input) {
  for (const key of ["stdout", "stderr", "stdout_text", "stderr_text", "raw_output", "logs"]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw requestError("Device command result must not include stdout/stderr or raw logs", 400);
    }
  }
  const status = cleanString(input.status);
  if (status !== "succeeded" && status !== "failed") {
    throw requestError("status must be succeeded or failed", 400);
  }
  const startedAt = cleanIsoString(input.started_at || input.startedAt);
  const summary = truncateTextByBytes(input.summary || input.message || "", DEVICE_COMMAND_RESULT_MAX_BYTES);
  return {
    status,
    exit_code: asInteger(input.exit_code ?? input.exitCode),
    started_at: startedAt,
    summary: summary.value || (status === "succeeded" ? "completed" : "failed"),
    summary_truncated: summary.truncated,
    runner_id: cleanString(input.runner_id || input.runnerId).slice(0, 120)
  };
}

function cleanIsoString(value) {
  const text = cleanString(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function publicDeviceCommand(row, options = {}) {
  if (!row) return null;
  const status = cleanString(row.status);
  const isClaimed = status === "claimed" || status === "running";
  const claimedAtMs = Date.parse(row.claimed_at || "");
  const claimStaleAt = isClaimed && Number.isFinite(claimedAtMs)
    ? new Date(claimedAtMs + DEVICE_COMMAND_CLAIM_LEASE_SECONDS * 1000).toISOString()
    : "";
  const command = {
    device_command_id: cleanString(row.device_command_id),
    tenant_id: cleanString(row.tenant_id),
    store_id: cleanString(row.store_id),
    screen_group_id: cleanString(row.screen_group_id),
    device_id: cleanString(row.device_id),
    command_type: cleanString(row.command_type),
    params: parseJson(row.params_json || "{}", {}),
    status,
    terminal: DEVICE_COMMAND_TERMINAL_STATUS.has(status),
    claim_stale_at: claimStaleAt,
    requested_by_user_id: cleanString(row.requested_by_user_id),
    requested_at: cleanString(row.requested_at),
    ttl_expires_at: cleanString(row.ttl_expires_at),
    claimed_at: cleanString(row.claimed_at),
    claimed_by_runner_id: cleanString(row.claimed_by_runner_id),
    started_at: cleanString(row.started_at),
    completed_at: cleanString(row.completed_at),
    cancelled_at: cleanString(row.cancelled_at),
    cancelled_by_user_id: cleanString(row.cancelled_by_user_id),
    expired_at: cleanString(row.expired_at),
    result: parseJson(row.result_json || "{}", {}),
    error: cleanString(row.error),
    audit_log_id: row.audit_log_id || null,
    updated_at: cleanString(row.updated_at)
  };
  if (options.include_claim_token) {
    command.claim_token = cleanString(row.claim_token);
  }
  return command;
}

function sqlPlaceholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
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

function nextEntityId(prefix, seed = "") {
  const base = cleanId(seed || prefix).slice(0, 44) || prefix;
  return cleanId(`${prefix}-${base}-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeCurrency(value) {
  const currency = cleanString(value || DEFAULT_CURRENCY).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_CURRENCY;
}

function normalizeBooleanFlag(value) {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = cleanString(value).toLowerCase();
  return !["0", "false", "no", "off"].includes(text);
}

function normalizeAmount(value, fallback = 0) {
  const amount = asInteger(value);
  if (amount === null) return fallback;
  return Math.max(0, amount);
}

function normalizeNullableAmount(value) {
  const amount = asInteger(value);
  return amount === null ? null : Math.max(0, amount);
}

function normalizeNullableLimit(value) {
  const limit = asInteger(value);
  return limit === null ? null : Math.max(0, limit);
}

function assertOptionalBusinessTime(label, value, required = false) {
  const time = cleanString(value);
  if (!time && !required) return;
  if (!isValidScheduleTime(time)) {
    throw requestError(`${label} must be HH:mm${required ? "" : " or empty"}`, 400);
  }
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function businessDateFor(isoValue, timezone = DEFAULT_TIMEZONE, businessDayStartTime = "00:00") {
  const parts = localDateTimeParts(isoValue, timezone);
  const startMinutes = minutesForTime(businessDayStartTime);
  const localMinutes = parts.hour * 60 + parts.minute;
  const utcDate = Date.UTC(parts.year, parts.month - 1, parts.day);
  const businessDate = new Date(localMinutes < startMinutes ? utcDate - 86400000 : utcDate);
  return businessDate.toISOString().slice(0, 10);
}

function isAfterBusinessCutoff(isoValue, timezone, businessDayStartTime, cutoffTime) {
  const startMinutes = minutesForTime(businessDayStartTime);
  let cutoffMinutes = minutesForTime(cutoffTime);
  if (cutoffMinutes < startMinutes) cutoffMinutes += 1440;
  const parts = localDateTimeParts(isoValue, timezone);
  let localMinutes = parts.hour * 60 + parts.minute;
  if (localMinutes < startMinutes) localMinutes += 1440;
  return localMinutes > cutoffMinutes;
}

function minutesForTime(value) {
  const [hours, minutes] = cleanString(value || "00:00").split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function localDateTimeParts(isoValue, timezone = DEFAULT_TIMEZONE) {
  const date = new Date(isoValue || nowIso());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function recordAuditLog(actorType, actorId, action, entityType, entityId, beforeValue, afterValue, metadata = {}, createdAt = nowIso()) {
  const result = db.prepare(`
    INSERT INTO audit_logs (
      actor_type, actor_id, action, entity_type, entity_id,
      before_json, after_json, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cleanString(actorType || "admin"),
    cleanString(actorId).slice(0, 120),
    cleanString(action),
    cleanString(entityType),
    cleanId(entityId),
    beforeValue ? JSON.stringify(beforeValue) : "",
    afterValue ? JSON.stringify(afterValue) : "",
    JSON.stringify(metadata || {}),
    createdAt
  );
  return result.lastInsertRowid;
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
  const storeId = cleanString(row.store_id || row.site_id);
  const screenGroupId = cleanString(row.screen_group_id || row.display_wall_id);
  const screenSlotId = cleanString(row.screen_slot_id || row.screen_id);
  const publicFields = {
    id: row.id,
    content_id: cleanString(row.content_id),
    playlist_version: cleanString(row.playlist_version),
    release_channel: cleanString(row.release_channel),
    status: cleanString(row.status),
    title: cleanString(row.title),
    notes: cleanString(row.notes),
    tenant_id: cleanString(row.tenant_id),
    store_id: storeId,
    screen_group_id: screenGroupId,
    screen_slot_id: screenSlotId,
    site_id: storeId,
    display_wall_id: screenGroupId,
    screen_id: screenSlotId,
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
    store_id: cleanString(manifest?.store_id || manifest?.site_id),
    screen_group_id: cleanString(manifest?.screen_group_id || manifest?.display_wall_id),
    screen_slot_id: cleanString(manifest?.screen_slot_id || manifest?.screen_id),
    site_id: cleanString(manifest?.store_id || manifest?.site_id),
    display_wall_id: cleanString(manifest?.screen_group_id || manifest?.display_wall_id),
    screen_id: cleanString(manifest?.screen_slot_id || manifest?.screen_id),
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

function requestNowIso(input = {}) {
  const candidate = cleanString(input.test_now || input.testNow || process.env.MISELL_CLOUD_TEST_NOW);
  if (process.env.NODE_ENV === "test" && candidate) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return nowIso();
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function requestAcceptsHtml(req) {
  const accept = cleanString(req.get("accept")).toLowerCase();
  return accept.includes("text/html");
}

function getStoreStaffSessionToken(req) {
  const bearer = getBearerToken(req);
  if (bearer) return bearer;
  return parseCookies(req.get("cookie")).misell_store_staff_session || "";
}

function getCustomerSessionToken(req) {
  const bearer = getBearerToken(req);
  if (bearer) return bearer;
  return parseCookies(req.get("cookie")).misell_customer_session || "";
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cleanString(cookieHeader).split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setStoreStaffSessionCookie(req, res, token, expiresAt) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `misell_store_staff_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${new Date(expiresAt).toUTCString()}`
  ]);
}

function clearStoreStaffSessionCookie(req, res) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `misell_store_staff_session=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
  ]);
}

function setCustomerSessionCookie(req, res, token, expiresAt) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `misell_customer_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${new Date(expiresAt).toUTCString()}`
  ]);
}

function clearCustomerSessionCookie(req, res) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `misell_customer_session=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
  ]);
}

function requestIsHttps(req) {
  return Boolean(req.secure || cleanString(req.get("x-forwarded-proto")).split(",")[0].trim().toLowerCase() === "https");
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeEqualHex(left, right) {
  const leftText = cleanString(left);
  const rightText = cleanString(right);
  if (!/^[a-f0-9]{64}$/i.test(leftText) || !/^[a-f0-9]{64}$/i.test(rightText)) return false;
  return crypto.timingSafeEqual(Buffer.from(leftText, "hex"), Buffer.from(rightText, "hex"));
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

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderCounterOrderPage(order, orderToken, req) {
  const payload = withCounterOrderStoreProfile(order);
  const receipt = payload.receipt_snapshot || {};
  const absoluteUrl = `${req.protocol}://${req.get("host")}/order/${encodeURIComponent(orderToken)}`;
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>受付番号 ${escapeHtml(order.order_number)} | Misell</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body class="order-page">
    <main class="order-shell">
      <section class="order-hero">
        <div>
          <p class="order-kicker">${escapeHtml(payload.store.store_name || "店舗")}</p>
          <h1>受付番号を発行しました</h1>
          <p>商品を受け取るときに、この番号と確認コードをスタッフに見せてください。</p>
        </div>
        <span class="update-status update-status-${escapeHtml(order.status === "issued" ? "success" : order.status)}">${escapeHtml(counterOrderStatusLabel(order.status))}</span>
      </section>
      <section id="order-card" class="order-card" aria-label="受付番号カード">
        <div class="order-card-head">
          <span>${escapeHtml(payload.store.store_name || "Misell")}</span>
          <strong>${escapeHtml(counterOrderStatusLabel(order.status))}</strong>
        </div>
        <p class="order-number-label">受付番号</p>
        <div class="order-number">${escapeHtml(order.order_number)}</div>
        <div class="verify-code">確認コード <strong>${escapeHtml(order.verify_code)}</strong></div>
        <dl class="order-receipt-meta">
          <div>
            <dt>引換場所</dt>
            <dd>${escapeHtml(receipt.pickup_location || "店頭")}</dd>
          </div>
          <div>
            <dt>引換時間</dt>
            <dd>${escapeHtml(receipt.pickup_window || "店舗営業時間に準じます")}</dd>
          </div>
          <div>
            <dt>有効期限</dt>
            <dd>${escapeHtml(formatOrderDate(receipt.valid_until) || "なし")}</dd>
          </div>
        </dl>
        <div class="order-items">
          ${payload.items.map((item) => `
            <div class="order-item-row">
              <span>
                <strong>${escapeHtml(item.item_name_snapshot)}</strong>
                <small>単価 ${escapeHtml(formatCurrency(item.unit_price_snapshot, item.currency))} / ${escapeHtml(item.quantity)}点</small>
              </span>
              <strong>小計 ${escapeHtml(formatCurrency(item.subtotal_amount, item.currency))}</strong>
            </div>
          `).join("")}
        </div>
        <div class="order-card-foot">
          <span>合計 ${escapeHtml(formatCurrency(order.total_amount, order.currency))}</span>
          <span>${order.tax_included ? "税込" : "税別"}</span>
          <span>${escapeHtml(formatOrderDate(order.issued_at))}</span>
        </div>
      </section>
      <section id="previous-order" class="order-previous" hidden></section>
      <section class="order-actions" aria-label="受付番号操作">
        <button id="save-order-image" type="button">画像で保存</button>
        <button id="preview-order-image" class="secondary" type="button">画像プレビュー</button>
        <button id="share-order" class="secondary" type="button">共有</button>
        <button id="copy-order-number" class="secondary" type="button">番号をコピー</button>
        <button id="copy-order-url" class="secondary" type="button">URLをコピー</button>
      </section>
      <section id="order-image-fallback" class="order-image-fallback" hidden>
        <div>
          <strong>画像プレビュー</strong>
          <p>iPhone Safariでは、この画像を長押しして「写真に保存」または「画像を保存」を選択してください。</p>
        </div>
        <img id="order-image-preview" alt="受付番号カード画像">
      </section>
      <p id="order-message" class="order-message" role="status"></p>
      <canvas id="order-card-canvas" width="1200" height="1600" hidden></canvas>
    </main>
    <script>
      window.MISELL_COUNTER_ORDER = ${escapeJsonForScript(payload)};
      window.MISELL_ORDER_TOKEN = ${escapeJsonForScript(orderToken)};
      window.MISELL_ORDER_URL = ${escapeJsonForScript(absoluteUrl)};
      window.MISELL_FORCE_IMAGE_FALLBACK = ${req.query?.force_image_fallback === "1" ? "true" : "false"};
    </script>
    <script src="/order-card.js"></script>
  </body>
</html>`;
}

function renderOrderNotFoundPage() {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>受付番号が見つかりません | Misell</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body class="order-page">
    <main class="order-shell">
      <section class="order-hero">
        <div>
          <p class="order-kicker">Misell</p>
          <h1>受付番号が見つかりません</h1>
          <p>URLが正しいか、もう一度確認してください。</p>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderStoreOrdersPage(storeAccess, req) {
  const store = getStoreSettings(storeAccess.store_id, { withDefaults: true }) || {
    store_id: storeAccess.store_id,
    store_name: storeAccess.store_name || storeAccess.store_id
  };
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(store.store_name || store.store_id)} 受付確認 | Misell</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body class="store-orders-page">
    <div class="shell">
      <header class="topbar">
        <h1>${escapeHtml(store.store_name || store.store_id)} 受付確認</h1>
        <button id="store-refresh" type="button">更新</button>
      </header>
      <main>
        <section id="store-login" class="store-login-panel">
          <h2>スタッフPIN</h2>
          <form id="store-login-form" class="store-login-form">
            <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" placeholder="PIN" aria-label="スタッフPIN" required>
            <button type="submit">開始</button>
          </form>
        </section>
        <section id="store-orders-app" hidden>
          <div class="store-orders-toolbar">
            <select id="store-order-status" aria-label="受付ステータス">
              <option value="issued">未引換</option>
              <option value="redeemed">引換済み</option>
              <option value="cancelled">取消</option>
              <option value="">すべて</option>
            </select>
            <input id="store-order-search" type="search" placeholder="受付番号/確認コード" aria-label="受付検索">
            <button id="store-order-search-button" type="button">検索</button>
            <button id="store-logout" class="secondary" type="button">終了</button>
          </div>
          <div id="store-session-summary" class="notification-bar"></div>
          <div id="store-orders-list"></div>
        </section>
        <p id="store-orders-message" class="order-message" role="status"></p>
      </main>
    </div>
    <script>
      window.MISELL_STORE_TOKEN = ${escapeJsonForScript(cleanString(req.params.store_token))};
      window.MISELL_STORE = ${escapeJsonForScript({
        store_id: store.store_id,
        store_name: store.store_name || store.store_id
      })};
    </script>
    <script src="/store-orders.js"></script>
  </body>
</html>`;
}

function renderStoreOrdersNotFoundPage() {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>店舗受付が見つかりません | Misell</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body class="store-orders-page">
    <main class="order-shell">
      <section class="order-hero">
        <div>
          <p class="order-kicker">Misell</p>
          <h1>店舗受付が見つかりません</h1>
          <p>URLが正しいか、管理者に確認してください。</p>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderCustomerAdminPage(customerAccess, req) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(customerAccess.tenant_name || customerAccess.tenant_id)} 顧客管理 | Misell</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body class="customer-admin-page">
    <div class="shell">
      <header class="topbar">
        <h1>${escapeHtml(customerAccess.tenant_name || customerAccess.tenant_id)} 顧客管理</h1>
        <button id="customer-refresh" type="button">更新</button>
      </header>
      <main>
        <section id="customer-login" class="store-login-panel">
          <h2>顧客PIN</h2>
          <form id="customer-login-form" class="store-login-form">
            <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" placeholder="PIN" aria-label="顧客PIN" required>
            <button type="submit">開始</button>
          </form>
        </section>
        <section id="customer-admin-app" hidden>
          <div class="store-orders-toolbar">
            <input id="customer-report-month" type="month" aria-label="レポート月">
            <select id="customer-store-filter" aria-label="店舗"></select>
            <select id="customer-screen-group-filter" aria-label="画面グループ"></select>
            <button id="customer-logout" class="secondary" type="button">終了</button>
          </div>
          <div id="customer-session-summary" class="notification-bar"></div>
          <section class="section">
            <h2>成果KPI</h2>
            <div id="customer-kpis" class="metrics"></div>
          </section>
          <section class="section">
            <h2>今月の提案</h2>
            <div id="customer-campaign-proposals"></div>
          </section>
          <section class="section">
            <h2>店舗文脈</h2>
            <div id="customer-context-items"></div>
          </section>
          <section class="section">
            <h2>受付状況</h2>
            <div id="customer-orders"></div>
          </section>
          <section class="section">
            <h2>店舗運用設定</h2>
            <div id="customer-store-settings"></div>
          </section>
          <section class="section">
            <h2>オファー設定</h2>
            <div id="customer-offers"></div>
          </section>
        </section>
        <p id="customer-message" class="order-message" role="status"></p>
      </main>
    </div>
    <script>
      window.MISELL_CUSTOMER_ACCESS_ID = ${escapeJsonForScript(customerAccess.customer_access_token_id)};
      window.MISELL_CUSTOMER_ACCESS = ${escapeJsonForScript({
        tenant_id: customerAccess.tenant_id,
        tenant_name: customerAccess.tenant_name,
        role: customerAccess.role,
        store_ids: customerAccess.store_ids || []
      })};
    </script>
    <script src="/context-ui.js"></script>
    <script src="/customer-admin.js"></script>
  </body>
</html>`;
}

function renderCustomerAdminNotFoundPage() {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>顧客管理が見つかりません | Misell</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body class="customer-admin-page">
    <main class="order-shell">
      <section class="order-hero">
        <div>
          <p class="order-kicker">Misell</p>
          <h1>顧客管理が見つかりません</h1>
          <p>URLが正しいか、管理者に確認してください。</p>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function counterOrderStatusLabel(status) {
  return {
    issued: "未引換",
    redeemed: "引換済み",
    expired: "期限切れ",
    cancelled: "取消"
  }[status] || status || "";
}

function formatCurrency(amount, currency) {
  if (normalizeCurrency(currency) === "JPY") return `${asInteger(amount) || 0}円`;
  return `${asInteger(amount) || 0} ${normalizeCurrency(currency)}`;
}

function formatPickupWindow(from, until) {
  const start = cleanString(from);
  const end = cleanString(until);
  if (start && end) return `${start} - ${end}`;
  return start || end || "";
}

function formatOrderDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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
