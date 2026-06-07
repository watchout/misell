require("dotenv").config({ quiet: true });

const { execFile } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const util = require("util");

const Ajv = require("ajv/dist/2020");
const express = require("express");
const basicAuth = require("express-basic-auth");
const multer = require("multer");
const { nanoid } = require("nanoid");

const app = express();
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = runtimePath("MISELL_DATA_DIR", path.join(ROOT_DIR, "data"));
const ASSETS_DIR = runtimePath("MISELL_ASSETS_DIR", path.join(ROOT_DIR, "assets"));
const IMAGE_DIR = path.join(ASSETS_DIR, "images");
const VIDEO_DIR = path.join(ASSETS_DIR, "videos");
const LOG_DIR = runtimePath("MISELL_LOG_DIR", path.join(ROOT_DIR, "logs"));
const GENERATED_DIR = runtimePath("MISELL_GENERATED_DIR", path.join(DATA_DIR, "generated"));
const CONTENT_BACKUP_DIR = runtimePath("MISELL_CONTENT_BACKUP_DIR", path.join(DATA_DIR, "backups"));
const PLAYLIST_PATH = runtimePath("MISELL_PLAYLIST_PATH", path.join(DATA_DIR, "playlist.json"));
const PLAYLIST_SCHEMA_PATH = runtimePath("MISELL_PLAYLIST_SCHEMA_PATH", path.join(ROOT_DIR, "data", "playlist.schema.json"));
const DEVICE_CONFIG_PATH = runtimePath("MISELL_DEVICE_CONFIG_PATH", path.join(DATA_DIR, "config.json"));
const PLAYLOG_KEY = "playlog";
const ADMIN_LOG_KEY = "admin";
const ERROR_LOG_KEY = "error";
const LOG_FILES = {
  [PLAYLOG_KEY]: "playlog.jsonl",
  [ADMIN_LOG_KEY]: "admin.log",
  [ERROR_LOG_KEY]: "error.log"
};

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB || 500);
const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;
const CONTENT_BACKUP_RETENTION = normalizedLimit(process.env.MISELL_CONTENT_BACKUP_RETENTION, 30, 1, 365);
const ADMIN_USER = process.env.MISELL_ADMIN_USER || process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.MISELL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "change-me";
const ADMIN_AUTH_ENABLED = process.env.MISELL_DISABLE_ADMIN_AUTH !== "1";
const REQUIRE_ADMIN_AUTH = process.env.MISELL_REQUIRE_ADMIN_AUTH === "1" || process.env.REQUIRE_ADMIN_AUTH === "1";
const DEVICE_ID = process.env.MISELL_DEVICE_ID || "";
const TENANT_ID = process.env.MISELL_TENANT_ID || "";
const STORE_ID = process.env.MISELL_STORE_ID || "";
const LOCATION_ID = process.env.MISELL_LOCATION_ID || "";
const SCREEN_GROUP_ID = process.env.MISELL_SCREEN_GROUP_ID || "";
const DEVICE_NAME = process.env.MISELL_DEVICE_NAME || "";
const APP_VERSION = process.env.npm_package_version || "0.1.0";
const RELEASE_ID = process.env.MISELL_RELEASE_ID || process.env.RELEASE_ID || "";
const RELEASE_CHANNEL = process.env.MISELL_RELEASE_CHANNEL || "";
const CONFIG_VERSION = process.env.MISELL_CONFIG_VERSION || "";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);
const ALLOWED_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
const ALLOWED_MIME_BY_EXTENSION = new Map([
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".mp4", new Set(["video/mp4"])],
  [".webm", new Set(["video/webm", "video/x-matroska"])]
]);
const sseClients = new Set();
const execFileAsync = util.promisify(execFile);
let deviceIdentity = null;
let deviceSecrets = null;
let validatePlaylistDocument = null;
let lastPlayback = null;

const defaultPlaylist = {
  version: 1,
  playlist_version: "local-001",
  updatedAt: new Date().toISOString(),
  items: [
    {
      id: "demo-three-zone",
      item_id: "demo-three-zone",
      name: "3ゾーン デモ",
      enabled: true,
      layout: "three-zone",
      duration: 12,
      start: "",
      end: "",
      left: "/demo/left.html",
      center: "/demo/center.html",
      right: "/demo/right.html",
      wide: ""
    },
    {
      id: "demo-wide",
      item_id: "demo-wide",
      name: "ワイド デモ",
      enabled: true,
      layout: "wide",
      duration: 12,
      start: "",
      end: "",
      left: "",
      center: "",
      right: "",
      wide: "/demo/wide.html"
    }
  ]
};

async function ensureRuntimeFiles() {
  await Promise.all([
    fsp.mkdir(DATA_DIR, { recursive: true }),
    fsp.mkdir(path.dirname(PLAYLIST_PATH), { recursive: true }),
    fsp.mkdir(path.dirname(DEVICE_CONFIG_PATH), { recursive: true }),
    fsp.mkdir(IMAGE_DIR, { recursive: true }),
    fsp.mkdir(VIDEO_DIR, { recursive: true }),
    fsp.mkdir(GENERATED_DIR, { recursive: true }),
    fsp.mkdir(CONTENT_BACKUP_DIR, { recursive: true }),
    fsp.mkdir(LOG_DIR, { recursive: true })
  ]);

  try {
    await fsp.access(PLAYLIST_PATH, fs.constants.F_OK);
  } catch {
    await writeJsonAtomic(PLAYLIST_PATH, defaultPlaylist);
  }

  const deviceConfig = await readDeviceConfigFile();
  deviceIdentity = await loadDeviceIdentity(deviceConfig);
  deviceSecrets = loadDeviceSecrets(deviceConfig);
  validatePlaylistDocument = await loadPlaylistValidator();
  await Promise.all([
    ensureFile(logFilePath(PLAYLOG_KEY)),
    ensureFile(logFilePath(ADMIN_LOG_KEY)),
    ensureFile(logFilePath(ERROR_LOG_KEY))
  ]);
}

function runtimePath(envName, fallbackPath) {
  const value = process.env[envName];
  if (!value) return fallbackPath;
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

async function ensureFile(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(filePath, "", "utf8");
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, filePath);
}

async function appendJsonl(logKey, entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...deviceIdentity,
    ...entry
  });
  const filePath = logFilePath(logKey);
  await fsp.appendFile(filePath, `${line}\n`, "utf8");
}

async function createContentBackup(reason = "manual") {
  await fsp.mkdir(CONTENT_BACKUP_DIR, { recursive: true });
  const timestamp = compactTimestamp();
  const safeReason = cleanId(reason) || "manual";
  const filename = `misell-content-${timestamp}-${safeReason}.tar.gz`;
  const targetPath = path.join(CONTENT_BACKUP_DIR, filename);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "misell-content-backup-"));

  try {
    const stagingDataDir = path.join(tempDir, "data");
    const stagingAssetsDir = path.join(tempDir, "assets");
    await Promise.all([
      fsp.mkdir(stagingDataDir, { recursive: true }),
      fsp.mkdir(path.join(stagingDataDir, "generated"), { recursive: true }),
      fsp.mkdir(path.join(stagingAssetsDir, "images"), { recursive: true }),
      fsp.mkdir(path.join(stagingAssetsDir, "videos"), { recursive: true })
    ]);

    await Promise.all([
      copyFileIfExists(PLAYLIST_PATH, path.join(stagingDataDir, "playlist.json")),
      copyFileIfExists(DEVICE_CONFIG_PATH, path.join(stagingDataDir, "config.json")),
      copyDirIfExists(GENERATED_DIR, path.join(stagingDataDir, "generated")),
      copyDirIfExists(IMAGE_DIR, path.join(stagingAssetsDir, "images")),
      copyDirIfExists(VIDEO_DIR, path.join(stagingAssetsDir, "videos"))
    ]);

    await writeJsonAtomic(path.join(tempDir, "backup-manifest.json"), {
      app: "misell-player",
      created_at: new Date().toISOString(),
      reason: safeReason,
      playlist_path: PLAYLIST_PATH,
      device_config_path: DEVICE_CONFIG_PATH,
      assets_dir: ASSETS_DIR,
      generated_dir: GENERATED_DIR,
      device: deviceIdentity || {}
    });

    await execFileAsync("tar", ["-czf", targetPath, "-C", tempDir, "."]);
    const stat = await fsp.stat(targetPath);
    await pruneContentBackups();
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "content.backup",
      reason: safeReason,
      backup: {
        name: filename,
        path: targetPath,
        size: stat.size
      }
    }).catch(() => {});
    return {
      name: filename,
      path: targetPath,
      size: stat.size,
      created_at: new Date().toISOString(),
      reason: safeReason
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function copyFileIfExists(source, destination) {
  try {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function copyDirIfExists(source, destination) {
  try {
    await fsp.cp(source, destination, {
      recursive: true,
      force: true,
      filter: (filePath) => path.basename(filePath) !== ".gitkeep"
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function listContentBackups() {
  await fsp.mkdir(CONTENT_BACKUP_DIR, { recursive: true });
  const entries = await fsp.readdir(CONTENT_BACKUP_DIR, { withFileTypes: true });
  const backups = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tar.gz"))
    .map(async (entry) => {
      const filePath = path.join(CONTENT_BACKUP_DIR, entry.name);
      const stat = await fsp.stat(filePath);
      return {
        name: entry.name,
        path: filePath,
        size: stat.size,
        created_at: stat.mtime.toISOString()
      };
    }));
  return backups.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function pruneContentBackups() {
  const backups = await listContentBackups();
  await Promise.all(backups.slice(CONTENT_BACKUP_RETENTION).map((backup) => (
    fsp.unlink(backup.path).catch(() => {})
  )));
}

async function loadDeviceIdentity(fileConfig = {}) {
  const identity = {
    tenant_id: TENANT_ID || cleanString(fileConfig.tenant_id) || "TEN-LOCAL",
    store_id: STORE_ID || cleanString(fileConfig.store_id) || "STO-LOCAL",
    location_id: LOCATION_ID || cleanString(fileConfig.location_id) || "LOC-LOCAL",
    screen_group_id: SCREEN_GROUP_ID || cleanString(fileConfig.screen_group_id) || "SG-LOCAL",
    device_id: DEVICE_ID || cleanString(fileConfig.device_id) || "DEV-LOCAL-001",
    device_name: DEVICE_NAME || cleanString(fileConfig.device_name) || "local-dev-player",
    playlist_version: cleanString(fileConfig.playlist_version) || "local-001",
    environment: process.env.APP_ENV || process.env.NODE_ENV || cleanString(fileConfig.environment) || "local",
    app_version: APP_VERSION,
    release_id: RELEASE_ID || cleanString(fileConfig.release_id) || `local-${APP_VERSION}`,
    release_channel: RELEASE_CHANNEL || cleanString(fileConfig.release_channel) || "dev",
    config_version: CONFIG_VERSION || cleanString(fileConfig.config_version) || "local-001"
  };

  try {
    await fsp.access(DEVICE_CONFIG_PATH, fs.constants.F_OK);
  } catch {
    await writeJsonAtomic(DEVICE_CONFIG_PATH, identity);
    await fsp.chmod(DEVICE_CONFIG_PATH, 0o600).catch(() => {});
  }

  return identity;
}

function loadDeviceSecrets(fileConfig = {}) {
  const deviceToken = process.env.MISELL_DEVICE_TOKEN || process.env.DEVICE_TOKEN || cleanString(fileConfig.device_token);
  return {
    device_token: deviceToken,
    device_token_configured: Boolean(deviceToken)
  };
}

async function readDeviceConfigFile() {
  try {
    const raw = await fsp.readFile(DEVICE_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function buildStatusPayload() {
  let playlistVersion = deviceIdentity.playlist_version;
  let playlistOk = true;
  let itemCount = 0;
  let lastError = null;

  try {
    const playlist = await readPlaylist();
    playlistVersion = playlist.playlist_version;
    itemCount = playlist.items.length;
  } catch (error) {
    playlistOk = false;
    lastError = error.message || "playlist read failed";
  }

  return {
    ok: playlistOk,
    ...deviceIdentity,
    playlist_version: playlistVersion,
    current_time: new Date().toISOString(),
    uptime: process.uptime(),
    uptime_seconds: Math.round(process.uptime()),
    system_uptime_seconds: Math.round(os.uptime()),
    process_pid: process.pid,
    service_state: "active",
    kiosk_state: "unknown",
    current_item_id: lastPlayback?.item_id || null,
    current_item_started_at: lastPlayback?.timestamp || null,
    playlist_item_count: itemCount,
    disk_free_mb: await getDiskFreeMb(ROOT_DIR),
    memory_used_percent: getMemoryUsedPercent(),
    cpu_load_1m: getCpuLoad1m(),
    temperature_c: null,
    network_status: "unknown",
    display_status: process.env.DISPLAY ? "display-env-present" : "unknown",
    device_token_configured: Boolean(deviceSecrets?.device_token_configured),
    last_error: lastError
  };
}

async function getDiskFreeMb(targetDir) {
  try {
    const stats = await fsp.statfs(targetDir);
    return Math.round((stats.bavail * stats.bsize) / 1024 / 1024);
  } catch {
    return null;
  }
}

function getMemoryUsedPercent() {
  const total = os.totalmem();
  if (!total) return null;
  const used = total - os.freemem();
  return Math.round((used / total) * 100);
}

function getCpuLoad1m() {
  const [load1m] = os.loadavg();
  return Number.isFinite(load1m) ? Number(load1m.toFixed(2)) : null;
}

function logFilePath(logKey) {
  const filename = LOG_FILES[logKey];
  if (!filename) throw new Error(`Unknown log key: ${logKey}`);
  return path.join(LOG_DIR, filename);
}

async function readPlaylistRaw() {
  const raw = await fsp.readFile(PLAYLIST_PATH, "utf8");
  return JSON.parse(raw);
}

async function readPlaylist(options = {}) {
  return normalizePlaylist(await readPlaylistRaw(), {
    touch: false,
    validateSourceExists: Boolean(options.validateSourceExists)
  });
}

async function loadPlaylistValidator() {
  const schema = JSON.parse(await fsp.readFile(PLAYLIST_SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({
    allErrors: true,
    allowUnionTypes: true
  });
  return ajv.compile(schema);
}

function validatePlaylistWithSchema(playlist) {
  if (!validatePlaylistDocument) return [];
  const ok = validatePlaylistDocument(playlist);
  if (ok) return [];
  return (validatePlaylistDocument.errors || []).map(formatAjvError);
}

function formatAjvError(error) {
  const pathLabel = error.instancePath || "/";
  if (error.keyword === "required") {
    return `${pathLabel} missing required property '${error.params.missingProperty}'`;
  }
  if (error.keyword === "oneOf") {
    return `${pathLabel} must match one playlist item schema`;
  }
  return `${pathLabel} ${error.message || "is invalid"}`;
}

function playlistResponse(playlist) {
  return {
    ok: true,
    errors: [],
    playlist,
    ...playlist
  };
}

function playlistErrorResponse(error, rawPlaylist = null) {
  const response = {
    ok: false,
    errors: [error.message || String(error)],
    playlist: null
  };
  if (rawPlaylist && typeof rawPlaylist === "object") {
    response.raw_playlist = rawPlaylist;
  }
  return response;
}

function normalizePlaylist(input, options = {}) {
  const source = Array.isArray(input) ? { items: input } : input || {};
  if (!Array.isArray(source.items)) {
    throw new Error("playlist.items must be an array");
  }

  const items = source.items.map((item, index) => normalizePlaylistItem(item, index));
  const playlist = {
    version: Number(source.version || 1),
    playlist_version: cleanString(source.playlist_version) || cleanString(source.version) || "1",
    updatedAt: options.touch ? new Date().toISOString() : cleanString(source.updatedAt) || new Date().toISOString(),
    items
  };
  const schemaErrors = validatePlaylistWithSchema(playlist);
  if (schemaErrors.length > 0) {
    throw new Error(`playlist schema validation failed: ${schemaErrors.join("; ")}`);
  }
  validatePlaylistSchema(playlist, {
    validateSourceExists: Boolean(options.validateSourceExists)
  });
  return playlist;
}

function normalizePlaylistItem(item, index) {
  const value = item || {};
  const layout = value.layout === "wide" ? "wide" : "three-zone";
  const duration = parseInteger(value.duration, 10);
  const id = cleanId(value.item_id) || cleanId(value.id) || `item-${Date.now()}-${index + 1}`;

  return {
    id,
    item_id: id,
    name: String(value.name || id),
    enabled: value.enabled !== false,
    layout,
    duration,
    start: cleanString(value.start),
    end: cleanString(value.end),
    days_of_week: normalizeDaysOfWeek(value.days_of_week),
    campaign_id: cleanString(value.campaign_id),
    asset_id: cleanString(value.asset_id),
    priority: clampInt(value.priority, 0, 0, 100),
    left: cleanString(value.left),
    center: cleanString(value.center),
    right: cleanString(value.right),
    wide: cleanString(value.wide)
  };
}

function normalizeDaysOfWeek(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
  return value
    .map((day) => cleanString(day).toLowerCase())
    .filter((day, index, days) => allowed.has(day) && days.indexOf(day) === index);
}

function validatePlaylistSchema(playlist, options = {}) {
  if (!cleanString(playlist.playlist_version)) {
    throw new Error("playlist_version is required");
  }

  if (!Array.isArray(playlist.items)) {
    throw new Error("items must be an array");
  }

  const seenIds = new Set();
  for (const [index, item] of playlist.items.entries()) {
    const prefix = `items[${index}]`;
    const id = cleanString(item.item_id || item.id);
    if (!id) throw new Error(`${prefix}.item_id is required`);
    if (seenIds.has(id)) throw new Error(`${prefix}.item_id must be unique`);
    seenIds.add(id);

    if (item.layout !== "three-zone" && item.layout !== "wide") {
      throw new Error(`${prefix}.layout must be three-zone or wide`);
    }

    if (!Number.isInteger(item.duration) || item.duration < 1 || item.duration > 300) {
      throw new Error(`${prefix}.duration must be between 1 and 300 seconds`);
    }

    if (item.start && !isValidScheduleTime(item.start)) {
      throw new Error(`${prefix}.start must be HH:mm or empty`);
    }

    if (item.end && !isValidScheduleTime(item.end)) {
      throw new Error(`${prefix}.end must be HH:mm or empty`);
    }

    if (item.layout === "wide") {
      validateSource(`${prefix}.wide`, item.wide, {
        required: item.enabled !== false,
        validateExists: options.validateSourceExists
      });
    } else {
      validateSource(`${prefix}.left`, item.left, {
        required: item.enabled !== false,
        validateExists: options.validateSourceExists
      });
      validateSource(`${prefix}.center`, item.center, {
        required: item.enabled !== false,
        validateExists: options.validateSourceExists
      });
      validateSource(`${prefix}.right`, item.right, {
        required: item.enabled !== false,
        validateExists: options.validateSourceExists
      });
    }
  }
}

function isValidScheduleTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
}

function validateSource(label, source, options = {}) {
  const value = cleanString(source);
  if (!value) {
    if (options.required) throw new Error(`${label} is required for enabled playlist items`);
    return;
  }

  if (
    value.startsWith("/assets/images/") ||
    value.startsWith("/assets/videos/") ||
    value.startsWith("assets/images/") ||
    value.startsWith("assets/videos/")
  ) {
    const filePath = resolveAssetPath(value);
    if (options.validateExists && !fs.existsSync(filePath)) {
      throw new Error(`${label} does not exist: ${value}`);
    }
    return;
  }

  if (value.startsWith("/demo/")) {
    const filePath = path.join(PUBLIC_DIR, value);
    if (options.validateExists && !fs.existsSync(filePath)) {
      throw new Error(`${label} does not exist: ${value}`);
    }
    return;
  }

  if (value.startsWith("/generated/")) {
    const filePath = resolveGeneratedPath(value);
    if (options.validateExists && !fs.existsSync(filePath)) {
      throw new Error(`${label} does not exist: ${value}`);
    }
    return;
  }

  throw new Error(`${label} must be an /assets path, /demo path, or /generated path`);
}

function resolveGeneratedPath(sourceUrl) {
  const value = String(sourceUrl || "");
  const decodedValue = decodeURIComponent(value);
  const decoded = decodedValue.startsWith("generated/") ? `/${decodedValue}` : decodedValue;

  if (!decoded.startsWith("/generated/")) {
    throw new Error("Only local /generated paths are allowed");
  }

  const relativePath = decoded.slice("/generated/".length);
  if (!relativePath || relativePath.includes("\0") || path.extname(relativePath) !== ".html") {
    throw new Error("Generated content must be an HTML file");
  }

  const resolved = path.resolve(GENERATED_DIR, relativePath);
  const resolvedBase = path.resolve(GENERATED_DIR);
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error("Invalid generated content path");
  }
  return resolved;
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizedLimit(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : Number.NaN;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 80);
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function classifyFilename(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return {
    ext,
    type: IMAGE_EXTENSIONS.has(ext) ? "image" : "video",
    dir: IMAGE_EXTENSIONS.has(ext) ? IMAGE_DIR : VIDEO_DIR,
    baseUrl: IMAGE_EXTENSIONS.has(ext) ? "/assets/images" : "/assets/videos",
    allowedMimeTypes: ALLOWED_MIME_BY_EXTENSION.get(ext) || new Set()
  };
}

function isAllowedMime(file, classified) {
  if (!file.mimetype || classified.allowedMimeTypes.size === 0) return false;
  return classified.allowedMimeTypes.has(file.mimetype);
}

function safeAssetFilename(originalName) {
  const parsed = path.parse(originalName || "asset");
  const ext = parsed.ext.toLowerCase();
  const basename = parsed.name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "asset";
  const suffix = nanoid(12);
  return `${Date.now()}-${suffix}-${basename}${ext}`;
}

function toAssetUrl(type, filename) {
  return `/assets/${type === "image" ? "images" : "videos"}/${encodeURIComponent(filename)}`;
}

function resolveAssetPath(assetUrl) {
  const value = String(assetUrl || "");
  const decodedValue = decodeURIComponent(value);
  const decoded = decodedValue.startsWith("assets/") ? `/${decodedValue}` : decodedValue;

  if (decoded.startsWith("/assets/images/")) {
    const filename = path.basename(decoded);
    return resolveSafeAssetPath(IMAGE_DIR, "/assets/images", decoded, filename);
  }

  if (decoded.startsWith("/assets/videos/")) {
    const filename = path.basename(decoded);
    return resolveSafeAssetPath(VIDEO_DIR, "/assets/videos", decoded, filename);
  }

  throw new Error("Only local /assets/images or /assets/videos paths can be deleted");
}

function resolveSafeAssetPath(baseDir, baseUrl, decodedUrl, filename) {
  if (!filename || filename === ".gitkeep" || filename.startsWith(".")) {
    throw new Error("Invalid asset path");
  }
  if (decodedUrl !== `${baseUrl}/${filename}`) {
    throw new Error("Nested asset paths are not allowed");
  }
  const resolved = path.resolve(baseDir, filename);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error("Invalid asset path");
  }
  return resolved;
}

function normalizePromoInput(body) {
  const source = body || {};
  const productName = boundedString(source.product_name, 80);
  if (!productName) {
    throw new Error("product_name is required");
  }

  const pattern = ["center-hero", "two-panel-info", "wide-first"].includes(source.pattern)
    ? source.pattern
    : "center-hero";
  const productAsset = cleanString(source.product_asset) || "/demo/wide.html";
  validateSource("product_asset", productAsset, { required: true, validateExists: true });

  const features = normalizePromoFeatures(source);
  const now = new Date();
  const campaignId = cleanId(source.campaign_id) || `promo-${compactTimestamp(now).toLowerCase()}`;
  const requestedPromoId = cleanId(source.promo_id);
  if (source.promo_id && !isSafePromoId(requestedPromoId)) {
    throw new Error("promo_id is invalid");
  }
  return {
    id: requestedPromoId || `${campaignId}-${nanoid(6)}`,
    campaign_id: campaignId,
    pattern,
    product_name: productName,
    product_asset: productAsset,
    price: boundedString(source.price, 48),
    offer: boundedString(source.offer, 80),
    cta: boundedString(source.cta, 80) || "店頭で今すぐチェック",
    tone: boundedString(source.tone, 48) || "店頭PR",
    features,
    duration_per_cut: clampInt(source.duration_per_cut, 5, 2, 20),
    created_at: now.toISOString()
  };
}

function isSafePromoId(value) {
  const normalized = String(value || "");
  return Boolean(normalized) && normalized !== "." && normalized !== "..";
}

function normalizePromoFeatures(source) {
  const rawFeatures = Array.isArray(source.features)
    ? source.features
    : [source.feature_1, source.feature_2, source.feature_3];
  const features = rawFeatures
    .map((feature) => boundedString(feature, 48))
    .filter(Boolean)
    .slice(0, 3);
  return features.length > 0 ? features : ["新商品", "店頭限定", "今だけ"];
}

function boundedString(value, maxLength) {
  return cleanString(value).replace(/\s+/g, " ").slice(0, maxLength);
}

async function createPromoCampaign(input) {
  const promo = input && input.id && input.created_at ? input : normalizePromoInput(input);
  const relativeDir = path.join("promos", promo.id);
  const targetDir = path.join(GENERATED_DIR, relativeDir);
  await fsp.mkdir(targetDir, { recursive: true });

  const pageDefinitions = buildPromoPages(promo);
  const pages = {};
  for (const page of pageDefinitions) {
    const relativePath = path.join(relativeDir, page.filename);
    const filePath = path.join(GENERATED_DIR, relativePath);
    await fsp.writeFile(filePath, page.html, "utf8");
    await fsp.chmod(filePath, 0o644);
    pages[page.key] = `/${path.posix.join("generated", "promos", promo.id, page.filename)}`;
  }

  const playlistItems = buildPromoPlaylistItems(promo, pages);
  return {
    ...promo,
    generated_paths: Object.values(pages),
    playlist_items: playlistItems,
    storyboard: playlistItems.map((item) => ({
      item_id: item.item_id,
      name: item.name,
      layout: item.layout,
      duration: item.duration,
      screens: item.layout === "wide"
        ? { wide: item.wide }
        : { left: item.left, center: item.center, right: item.right }
    }))
  };
}

function buildPromoPages(promo) {
  return [
    {
      key: "leftFeature",
      filename: "left-feature.html",
      html: renderPromoPage({
        role: "left",
        label: "Feature",
        title: promo.features[0],
        subtitle: promo.tone,
        body: promo.features.slice(1).join(" / ") || promo.offer,
        accent: "teal"
      })
    },
    {
      key: "centerProduct",
      filename: "center-product.html",
      html: renderPromoPage({
        role: "center",
        label: "Product",
        title: promo.product_name,
        subtitle: promo.offer,
        media: promo.product_asset,
        accent: "berry"
      })
    },
    {
      key: "rightCta",
      filename: "right-cta.html",
      html: renderPromoPage({
        role: "right",
        label: "Action",
        title: promo.price || promo.cta,
        subtitle: promo.price ? promo.cta : promo.offer,
        body: promo.offer,
        accent: "olive"
      })
    },
    {
      key: "wideHero",
      filename: "wide-hero.html",
      html: renderPromoPage({
        role: "wide",
        label: "Hero",
        title: promo.product_name,
        subtitle: promo.offer || promo.cta,
        body: promo.price,
        media: promo.product_asset,
        accent: "wide"
      })
    },
    {
      key: "leftDetail",
      filename: "left-detail.html",
      html: renderPromoPage({
        role: "left",
        label: "Point",
        title: promo.features[1] || promo.features[0],
        subtitle: promo.features[2] || promo.tone,
        body: promo.offer,
        accent: "navy"
      })
    },
    {
      key: "centerDetail",
      filename: "center-detail.html",
      html: renderPromoPage({
        role: "center",
        label: "Recommend",
        title: promo.product_name,
        subtitle: promo.price,
        media: promo.product_asset,
        accent: "slate"
      })
    },
    {
      key: "rightClose",
      filename: "right-close.html",
      html: renderPromoPage({
        role: "right",
        label: "CTA",
        title: promo.cta,
        subtitle: promo.price,
        body: promo.offer,
        accent: "gold"
      })
    },
    {
      key: "wideClose",
      filename: "wide-close.html",
      html: renderPromoPage({
        role: "wide",
        label: "CTA",
        title: promo.cta,
        subtitle: [promo.product_name, promo.price].filter(Boolean).join(" / "),
        body: promo.offer,
        accent: "dark"
      })
    }
  ];
}

function buildPromoPlaylistItems(promo, pages) {
  const base = {
    enabled: true,
    duration: promo.duration_per_cut,
    start: "",
    end: "",
    days_of_week: [],
    campaign_id: promo.campaign_id,
    asset_id: cleanId(path.basename(promo.product_asset)) || promo.campaign_id,
    priority: 0
  };
  const threeZoneIntro = {
    ...base,
    id: `${promo.id}-intro`,
    item_id: `${promo.id}-intro`,
    name: `${promo.product_name} / 3面PR`,
    layout: "three-zone",
    left: pages.leftFeature,
    center: pages.centerProduct,
    right: pages.rightCta,
    wide: ""
  };
  const wideHero = {
    ...base,
    id: `${promo.id}-wide`,
    item_id: `${promo.id}-wide`,
    name: `${promo.product_name} / ワイド訴求`,
    layout: "wide",
    left: "",
    center: "",
    right: "",
    wide: pages.wideHero
  };
  const detail = {
    ...base,
    id: `${promo.id}-detail`,
    item_id: `${promo.id}-detail`,
    name: `${promo.product_name} / 詳細CTA`,
    layout: "three-zone",
    left: pages.leftDetail,
    center: pages.centerDetail,
    right: pages.rightClose,
    wide: ""
  };
  const wideClose = {
    ...base,
    id: `${promo.id}-close`,
    item_id: `${promo.id}-close`,
    name: `${promo.product_name} / 締め`,
    layout: "wide",
    left: "",
    center: "",
    right: "",
    wide: pages.wideClose
  };

  if (promo.pattern === "wide-first") return [wideHero, threeZoneIntro, detail];
  if (promo.pattern === "two-panel-info") {
    return [
      {
        ...threeZoneIntro,
        left: pages.centerProduct,
        center: pages.centerDetail,
        right: pages.rightCta,
        name: `${promo.product_name} / 2面商品+情報`
      },
      wideHero,
      detail
    ];
  }
  return [threeZoneIntro, wideHero, detail, wideClose];
}

function renderPromoPage(page) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.title || "Misell PR")}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      body {
        display: grid;
        min-height: 100vh;
        color: #f8fafc;
        background: ${promoBackground(page.accent)};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        display: grid;
        grid-template-columns: ${page.role === "wide" ? "1.2fr 0.8fr" : "1fr"};
        gap: 56px;
        align-items: center;
        width: 100%;
        height: 100%;
        padding: ${page.role === "wide" ? "90px 130px" : "84px"};
      }
      .copy { min-width: 0; }
      .label {
        margin: 0 0 24px;
        color: rgba(255, 255, 255, 0.7);
        font-size: ${page.role === "wide" ? "44px" : "48px"};
        font-weight: 800;
        letter-spacing: 0;
      }
      h1 {
        margin: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        font-size: ${page.role === "wide" ? "140px" : "122px"};
        line-height: 0.98;
        letter-spacing: 0;
      }
      h2 {
        margin: 34px 0 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        color: rgba(255, 255, 255, 0.86);
        font-size: ${page.role === "wide" ? "56px" : "54px"};
        line-height: 1.12;
        letter-spacing: 0;
      }
      .body {
        margin: 30px 0 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        color: rgba(255, 255, 255, 0.76);
        font-size: ${page.role === "wide" ? "44px" : "46px"};
        font-weight: 700;
        line-height: 1.18;
        letter-spacing: 0;
      }
      .media {
        min-width: 0;
        height: ${page.role === "wide" ? "78vh" : "42vh"};
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.3);
        background: rgba(5, 7, 10, 0.45);
      }
      .media img,
      .media video,
      .media iframe {
        width: 100%;
        height: 100%;
        display: block;
        border: 0;
        object-fit: cover;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="copy">
        <p class="label">${escapeHtml(page.label || "Misell")}</p>
        <h1>${escapeHtml(page.title || "")}</h1>
        ${page.subtitle ? `<h2>${escapeHtml(page.subtitle)}</h2>` : ""}
        ${page.body ? `<p class="body">${escapeHtml(page.body)}</p>` : ""}
      </section>
      ${page.media ? `<section class="media">${renderPromoMedia(page.media, page.title)}</section>` : ""}
    </main>
  </body>
</html>
`;
}

function promoBackground(accent) {
  const backgrounds = {
    teal: "linear-gradient(125deg, #0f8b8d, #19323c)",
    berry: "linear-gradient(125deg, #10151d, #7a2538)",
    olive: "linear-gradient(125deg, #2d3748, #5f6f3d)",
    navy: "linear-gradient(125deg, #0f172a, #164e63)",
    slate: "linear-gradient(125deg, #111827, #374151)",
    gold: "linear-gradient(125deg, #7a2538, #d9a441)",
    dark: "linear-gradient(125deg, #05070a, #111827)",
    wide: "linear-gradient(100deg, rgba(15, 139, 141, 0.95), rgba(122, 37, 56, 0.93), rgba(217, 164, 65, 0.9)), #10151d"
  };
  return backgrounds[accent] || backgrounds.dark;
}

function renderPromoMedia(source, altText) {
  const safeSource = escapeAttr(source);
  const lower = String(source || "").toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".mov") || lower.endsWith(".m4v")) {
    return `<video src="${safeSource}" muted autoplay loop playsinline></video>`;
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")) {
    return `<img src="${safeSource}" alt="${escapeAttr(altText || "")}">`;
  }
  return `<iframe src="${safeSource}" title="${escapeAttr(altText || "promo media")}"></iframe>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function validateUploadedFile(filePath, classified) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);

    if (classified.ext === ".jpg" || classified.ext === ".jpeg") {
      if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return;
    }

    if (classified.ext === ".png") {
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (header.length >= 8 && header.subarray(0, 8).equals(pngSignature)) return;
    }

    if (classified.ext === ".webm") {
      const webmSignature = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      if (header.length >= 4 && header.subarray(0, 4).equals(webmSignature)) return;
    }

    if (classified.ext === ".mp4") {
      if (header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") return;
    }
  } finally {
    await handle.close();
  }

  throw new Error("Uploaded file content does not match the allowed file type");
}

function requireAdminAuth(req, res, next) {
  if (!ADMIN_AUTH_ENABLED) {
    next();
    return;
  }

  adminAuth(req, res, next);
}

function validateSecurityConfig() {
  if (REQUIRE_ADMIN_AUTH && !ADMIN_AUTH_ENABLED) {
    throw new Error("REQUIRE_ADMIN_AUTH requires admin auth to be enabled");
  }

  if (!ADMIN_AUTH_ENABLED) {
    console.warn("WARNING: admin Basic auth is disabled. Do not connect this app to a store LAN.");
    return;
  }

  if (ADMIN_PASSWORD === "change-me") {
    console.warn("WARNING: admin Basic auth uses the default password. Set ADMIN_PASSWORD or MISELL_ADMIN_PASSWORD before store deployment.");
  }
}

const adminAuth = basicAuth({
  challenge: true,
  realm: "misell admin",
  authorizer(username, password) {
    const ok = basicAuth.safeCompare(username, ADMIN_USER) & basicAuth.safeCompare(password, ADMIN_PASSWORD);
    return Boolean(ok);
  },
  unauthorizedResponse: (req) => {
    appendJsonl(ADMIN_LOG_KEY, {
      action: "admin.auth_failed",
      ip: req.ip,
      path: req.originalUrl
    }).catch(() => {});
    return { error: "Authentication required" };
  }
});

async function listAssetsInDirectory(type, dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name !== ".gitkeep")
      .map(async (entry) => {
        const filePath = path.join(dir, entry.name);
        const stat = await fsp.stat(filePath);
        return {
          name: entry.name,
          type,
          path: toAssetUrl(type, entry.name),
          size: stat.size,
          updatedAt: stat.mtime.toISOString()
        };
      })
  );
  return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function broadcastReload(reason) {
  const payload = JSON.stringify({
    reason,
    timestamp: new Date().toISOString()
  });

  for (const client of sseClients) {
    client.write(`event: reload\n`);
    client.write(`data: ${payload}\n\n`);
  }
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const classified = classifyFilename(file.originalname);
    if (!classified) {
      cb(new Error("Unsupported file type. Use jpg, jpeg, png, mp4, or webm."));
      return;
    }
    cb(null, classified.dir);
  },
  filename(req, file, cb) {
    cb(null, safeAssetFilename(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter(req, file, cb) {
    const classified = classifyFilename(file.originalname);
    if (!classified) {
      cb(new Error("Unsupported file type. Use jpg, jpeg, png, mp4, or webm."));
      return;
    }
    if (!isAllowedMime(file, classified)) {
      cb(new Error("Uploaded file MIME type does not match the allowed extensions."));
      return;
    }
    cb(null, true);
  }
});

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use("/assets/images", express.static(IMAGE_DIR, { fallthrough: true }));
app.use("/assets/videos", express.static(VIDEO_DIR, { fallthrough: true }));
app.use("/generated", express.static(GENERATED_DIR, { fallthrough: true }));

app.get("/", (req, res) => {
  res.redirect("/player");
});

app.get("/player", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "player.html"));
});

app.get(["/admin", "/admin.html"], requireAdminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "misell-player",
    version: APP_VERSION,
    release_id: deviceIdentity?.release_id || `local-${APP_VERSION}`,
    release_channel: deviceIdentity?.release_channel || "dev",
    time: new Date().toISOString()
  });
});

app.get("/api/device", requireAdminAuth, (req, res) => {
  res.json(deviceIdentity);
});

app.get("/api/config", (req, res) => {
  res.json(deviceIdentity);
});

app.get("/api/status", async (req, res, next) => {
  try {
    res.json(await buildStatusPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/heartbeat", async (req, res, next) => {
  try {
    res.json(await buildStatusPayload());
  } catch (error) {
    next(error);
  }
});

app.get("/api/playlist", async (req, res, next) => {
  try {
    res.json(playlistResponse(await readPlaylist({ validateSourceExists: true })));
  } catch (error) {
    let rawPlaylist = null;
    try {
      rawPlaylist = await readPlaylistRaw();
    } catch {
      rawPlaylist = null;
    }
    res.status(200).json(playlistErrorResponse(error, rawPlaylist));
  }
});

async function savePlaylistHandler(req, res, next) {
  try {
    const playlist = normalizePlaylist(req.body, {
      touch: true,
      validateSourceExists: true
    });
    const backup = await createContentBackup("before-playlist-save");
    await writeJsonAtomic(PLAYLIST_PATH, playlist);
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "playlist.save",
      ip: req.ip,
      itemCount: playlist.items.length,
      backup: backup.name
    });
    broadcastReload("playlist-saved");
    res.json({ ...playlistResponse(playlist), backup });
  } catch (error) {
    next(error);
  }
}

app.put("/api/playlist", requireAdminAuth, savePlaylistHandler);
app.post("/api/playlist", requireAdminAuth, savePlaylistHandler);

app.post("/api/promo-campaigns", requireAdminAuth, async (req, res, next) => {
  try {
    const input = normalizePromoInput(req.body || {});
    const backup = await createContentBackup("before-promo-generate");
    const promo = await createPromoCampaign(input);
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "promo.generate",
      ip: req.ip,
      promo_id: promo.id,
      campaign_id: promo.campaign_id,
      pattern: promo.pattern,
      itemCount: promo.playlist_items.length,
      backup: backup.name
    });
    res.status(201).json({ ok: true, promo, backup });
  } catch (error) {
    next(error);
  }
});

app.get("/api/assets", requireAdminAuth, async (req, res, next) => {
  try {
    const [images, videos] = await Promise.all([
      listAssetsInDirectory("image", IMAGE_DIR),
      listAssetsInDirectory("video", VIDEO_DIR)
    ]);
    res.json({ images, videos, assets: [...images, ...videos] });
  } catch (error) {
    next(error);
  }
});

function uploadAssetHandler(req, res, next) {
  upload.single("asset")(req, res, async (error) => {
    if (error) {
      next(error);
      return;
    }

    if (!req.file) {
      next(new Error("No file uploaded. Use multipart field name 'asset'."));
      return;
    }

    try {
      const classified = classifyFilename(req.file.originalname);
      await validateUploadedFile(req.file.path, classified);
      await fsp.chmod(req.file.path, 0o644);
      const asset = {
        name: req.file.filename,
        originalName: req.file.originalname,
        type: classified.type,
        path: `${classified.baseUrl}/${encodeURIComponent(req.file.filename)}`,
        size: req.file.size,
        updatedAt: new Date().toISOString()
      };
      const backup = await createContentBackup("after-asset-upload");
      await appendJsonl(ADMIN_LOG_KEY, {
        action: "asset.upload",
        ip: req.ip,
        asset,
        backup: backup.name
      });
      res.status(201).json({ ...asset, backup });
    } catch (uploadError) {
      await fsp.unlink(req.file.path).catch(() => {});
      next(uploadError);
    }
  });
}

app.post("/api/assets", requireAdminAuth, uploadAssetHandler);
app.post("/api/assets/upload", requireAdminAuth, uploadAssetHandler);

app.delete("/api/assets", requireAdminAuth, async (req, res, next) => {
  try {
    const assetPath = req.query.path || req.body?.path;
    const filePath = resolveAssetPath(assetPath);
    const backup = await createContentBackup("before-asset-delete");
    await fsp.unlink(filePath);
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "asset.delete",
      ip: req.ip,
      path: assetPath,
      backup: backup.name
    });
    broadcastReload("asset-deleted");
    res.json({ ok: true, backup });
  } catch (error) {
    next(error);
  }
});

app.get("/api/content-backups", requireAdminAuth, async (req, res, next) => {
  try {
    res.json({
      ok: true,
      backup_dir: CONTENT_BACKUP_DIR,
      retention: CONTENT_BACKUP_RETENTION,
      backups: await listContentBackups()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/content-backups", requireAdminAuth, async (req, res, next) => {
  try {
    const backup = await createContentBackup(req.body?.reason || "manual");
    res.status(201).json({ ok: true, backup });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reload", requireAdminAuth, async (req, res, next) => {
  try {
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "player.reload",
      ip: req.ip
    });
    broadcastReload("manual");
    res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.post("/api/playback-log", async (req, res, next) => {
  try {
    const body = req.body || {};
    const entry = {
      playlist_version: cleanString(body.playlist_version),
      playlist_item_id: cleanString(body.playlist_item_id || body.itemId),
      itemId: cleanString(body.itemId),
      item_id: cleanString(body.playlist_item_id || body.item_id || body.itemId),
      itemName: cleanString(body.itemName),
      campaign_id: cleanString(body.campaign_id),
      asset_id: cleanString(body.asset_id),
      layout: cleanString(body.layout),
      asset: cleanString(body.asset),
      duration: clampInt(body.duration, 0, 0, 300),
      result: cleanString(body.result || "started")
    };
    rememberPlayback(entry);
    await appendJsonl(PLAYLOG_KEY, entry);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/log/play", async (req, res, next) => {
  try {
    const body = req.body || {};
    const entry = {
      playlist_version: cleanString(body.playlist_version),
      playlist_item_id: cleanString(body.playlist_item_id || body.item_id || body.itemId),
      itemId: cleanString(body.itemId || body.item_id),
      item_id: cleanString(body.playlist_item_id || body.item_id || body.itemId),
      itemName: cleanString(body.itemName),
      campaign_id: cleanString(body.campaign_id),
      asset_id: cleanString(body.asset_id),
      layout: cleanString(body.layout),
      asset: cleanString(body.asset || (Array.isArray(body.asset_paths) ? body.asset_paths.join(",") : "")),
      duration: clampInt(body.duration, 0, 0, 300),
      result: cleanString(body.result || "started")
    };
    rememberPlayback(entry);
    await appendJsonl(PLAYLOG_KEY, entry);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function rememberPlayback(entry) {
  lastPlayback = {
    timestamp: new Date().toISOString(),
    item_id: cleanString(entry.item_id || entry.playlist_item_id || entry.itemId),
    layout: cleanString(entry.layout),
    result: cleanString(entry.result)
  };
}

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  appendJsonl(ERROR_LOG_KEY, {
    action: "request.error",
    ip: req.ip,
    path: req.originalUrl,
    status,
    error: error.message || "Request failed"
  }).catch(() => {});
  res.status(status).json({
    error: error.message || "Request failed",
    errors: [error.message || "Request failed"]
  });
});

async function runValidatePlaylistCli() {
  await ensureRuntimeFiles();
  const playlist = await readPlaylist({ validateSourceExists: true });
  console.log(JSON.stringify(playlistResponse(playlist), null, 2));
}

async function startServer() {
  await ensureRuntimeFiles();
  validateSecurityConfig();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`misell-player listening on http://0.0.0.0:${PORT}`);
    console.log(`player: http://localhost:${PORT}/player`);
    console.log(`admin:  http://localhost:${PORT}/admin`);
  });
}

const entrypoint = process.argv.includes("--validate-playlist")
  ? runValidatePlaylistCli
  : startServer;

entrypoint().catch((error) => {
  console.error("Failed to initialize misell-player:", error);
  process.exit(1);
});
