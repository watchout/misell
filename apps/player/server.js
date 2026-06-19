require("dotenv").config({ quiet: true });

const { execFile } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const util = require("util");
const { pathToFileURL } = require("url");

const Ajv = require("ajv/dist/2020");
const express = require("express");
const basicAuth = require("express-basic-auth");
const multer = require("multer");
const { nanoid } = require("nanoid");
const QRCode = require("qrcode");

const { PLAYLOG_ENDPOINT, openLocalState } = require("./lib/local-state");

const app = express();
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = runtimePath("MISELL_DATA_DIR", path.join(ROOT_DIR, "data"));
const ASSETS_DIR = runtimePath("MISELL_ASSETS_DIR", path.join(ROOT_DIR, "assets"));
const IMAGE_DIR = path.join(ASSETS_DIR, "images");
const VIDEO_DIR = path.join(ASSETS_DIR, "videos");
const LOG_DIR = runtimePath("MISELL_LOG_DIR", path.join(ROOT_DIR, "logs"));
const GENERATED_DIR = runtimePath("MISELL_GENERATED_DIR", path.join(DATA_DIR, "generated"));
const QR_CATALOG_PATH = runtimePath("MISELL_QR_CATALOG_PATH", path.join(DATA_DIR, "qrs.json"));
const QR_GENERATED_DIR = path.join(GENERATED_DIR, "qrs");
const CONTENT_BACKUP_DIR = runtimePath("MISELL_CONTENT_BACKUP_DIR", path.join(DATA_DIR, "backups"));
const PLAYLIST_PATH = runtimePath("MISELL_PLAYLIST_PATH", path.join(DATA_DIR, "playlist.json"));
const PLAYLIST_SCHEMA_PATH = runtimePath("MISELL_PLAYLIST_SCHEMA_PATH", path.join(ROOT_DIR, "data", "playlist.schema.json"));
const DEVICE_CONFIG_PATH = runtimePath("MISELL_DEVICE_CONFIG_PATH", path.join(DATA_DIR, "config.json"));
const LOCAL_STATE_DB_PATH = runtimePath("MISELL_LOCAL_STATE_DB_PATH", path.join(DATA_DIR, "local_state.sqlite"));
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
const VIDEO_EXPORT_PRESETS = {
  preview: { width: 1280, height: 720, stageWidth: 1280, stageHeight: 240 },
  full: { width: 5760, height: 1080, stageWidth: 5760, stageHeight: 1080 }
};
const VIDEO_EXPORT_MAX_ITEMS = 12;
const VIDEO_EXPORT_MAX_SECONDS = 120;
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
let localState = null;

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

async function ensureRuntimeFiles(options = {}) {
  await Promise.all([
    fsp.mkdir(DATA_DIR, { recursive: true }),
    fsp.mkdir(path.dirname(PLAYLIST_PATH), { recursive: true }),
    fsp.mkdir(path.dirname(DEVICE_CONFIG_PATH), { recursive: true }),
    fsp.mkdir(path.dirname(QR_CATALOG_PATH), { recursive: true }),
    fsp.mkdir(IMAGE_DIR, { recursive: true }),
    fsp.mkdir(VIDEO_DIR, { recursive: true }),
    fsp.mkdir(GENERATED_DIR, { recursive: true }),
    fsp.mkdir(QR_GENERATED_DIR, { recursive: true }),
    fsp.mkdir(CONTENT_BACKUP_DIR, { recursive: true }),
    fsp.mkdir(LOG_DIR, { recursive: true })
  ]);

  try {
    await fsp.access(PLAYLIST_PATH, fs.constants.F_OK);
  } catch {
    await writeJsonAtomic(PLAYLIST_PATH, defaultPlaylist);
  }

  try {
    await fsp.access(QR_CATALOG_PATH, fs.constants.F_OK);
  } catch {
    await writeJsonAtomic(QR_CATALOG_PATH, { version: 1, qrs: [] });
  }

  const deviceConfig = await readDeviceConfigFile();
  deviceIdentity = await loadDeviceIdentity(deviceConfig);
  deviceSecrets = loadDeviceSecrets(deviceConfig);
  validatePlaylistDocument = await loadPlaylistValidator();
  if (options.openLocalState !== false) {
    localState = openLocalState(LOCAL_STATE_DB_PATH);
  }
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
      copyFileIfExists(QR_CATALOG_PATH, path.join(stagingDataDir, "qrs.json")),
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
    local_state: localState?.summary() || null,
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
  const sourcePath = sourcePathname(value);
  if (!value) {
    if (options.required) throw new Error(`${label} is required for enabled playlist items`);
    return;
  }

  if (
    sourcePath.startsWith("/assets/images/") ||
    sourcePath.startsWith("/assets/videos/") ||
    sourcePath.startsWith("assets/images/") ||
    sourcePath.startsWith("assets/videos/")
  ) {
    const filePath = resolveAssetPath(sourcePath);
    if (options.validateExists && !fs.existsSync(filePath)) {
      throw new Error(`${label} does not exist: ${value}`);
    }
    return;
  }

  if (sourcePath.startsWith("/demo/")) {
    const filePath = path.join(PUBLIC_DIR, sourcePath);
    if (options.validateExists && !fs.existsSync(filePath)) {
      throw new Error(`${label} does not exist: ${value}`);
    }
    return;
  }

  if (sourcePath.startsWith("/generated/")) {
    const filePath = resolveGeneratedPath(sourcePath);
    if (options.validateExists && !fs.existsSync(filePath)) {
      throw new Error(`${label} does not exist: ${value}`);
    }
    return;
  }

  throw new Error(`${label} must be an /assets path, /demo path, or /generated path`);
}

function sourcePathname(sourceUrl) {
  return String(sourceUrl || "").split(/[?#]/, 1)[0];
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

async function readQrCatalog() {
  let raw = "";
  try {
    raw = await fsp.readFile(QR_CATALOG_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, qrs: [] };
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("qrs.json is invalid JSON");
  }

  const qrs = Array.isArray(parsed?.qrs)
    ? parsed.qrs.map(normalizeStoredQrRecord).filter(Boolean)
    : [];
  return {
    version: Number(parsed?.version || 1),
    qrs
  };
}

function normalizeStoredQrRecord(record) {
  if (!record || typeof record !== "object") return null;
  const qrId = cleanId(record.qr_id || record.qrId);
  const campaignId = cleanId(record.campaign_id || record.campaignId);
  const lpUrl = cleanString(record.lp_url || record.lpUrl).slice(0, 500);
  if (!qrId || !campaignId || !lpUrl) return null;
  return {
    qr_id: qrId,
    campaign_id: campaignId,
    label: boundedString(record.label || record.name, 80),
    lp_url: lpUrl,
    image_path: cleanString(record.image_path || record.imagePath) || `/generated/qrs/${encodeURIComponent(`${qrId}.png`)}`,
    created_at: cleanString(record.created_at || record.createdAt),
    updated_at: cleanString(record.updated_at || record.updatedAt)
  };
}

async function writeQrCatalog(catalog) {
  await fsp.mkdir(path.dirname(QR_CATALOG_PATH), { recursive: true });
  await writeJsonAtomic(QR_CATALOG_PATH, {
    version: Number(catalog?.version || 1),
    qrs: Array.isArray(catalog?.qrs) ? catalog.qrs : []
  });
}

function normalizeQrInput(body) {
  const source = body || {};
  const campaignId = cleanId(source.campaign_id || source.campaignId);
  if (!campaignId) {
    throw new Error("campaign_id is required");
  }

  const requestedQrId = cleanId(source.qr_id || source.qrId);
  if ((source.qr_id || source.qrId) && !isSafeQrId(requestedQrId)) {
    throw new Error("qr_id is invalid");
  }

  return {
    campaign_id: campaignId,
    qr_id: requestedQrId,
    label: boundedString(source.label || source.name, 80),
    lp_url: normalizeQrLpUrl(source.lp_url || source.lpUrl)
  };
}

function normalizeQrLpUrl(value) {
  const rawUrl = cleanString(value).replace(/[\u0000-\u001f\u007f]/g, "");
  if (!rawUrl) {
    throw new Error("lp_url is required");
  }
  if (rawUrl.length > 500) {
    throw new Error("lp_url must be 500 characters or less");
  }

  if (rawUrl.startsWith("/")) {
    if (rawUrl.startsWith("//")) {
      throw new Error("lp_url local paths must start with a single slash");
    }
    const pathOnly = sourcePathname(rawUrl);
    let decodedPath = pathOnly;
    try {
      decodedPath = decodeURIComponent(pathOnly);
    } catch {
      throw new Error("lp_url local path is invalid");
    }
    if (!decodedPath.startsWith("/") || decodedPath.includes("\\") || decodedPath.split("/").includes("..")) {
      throw new Error("lp_url local path is invalid");
    }
    return rawUrl;
  }

  let parsed = null;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("lp_url must be an http(s) URL or local path");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("lp_url must be an http(s) URL or local path");
  }
  return parsed.toString();
}

function isSafeQrId(value) {
  const normalized = String(value || "");
  return Boolean(normalized) && normalized !== "." && normalized !== ".." && !normalized.startsWith(".");
}

function nextQrId(campaignId, catalog, requestedQrId) {
  const existingIds = new Set((catalog.qrs || []).map((qr) => qr.qr_id).filter(Boolean));
  if (requestedQrId) {
    if (existingIds.has(requestedQrId)) {
      throw new Error("qr_id already exists");
    }
    return requestedQrId;
  }

  const baseId = campaignId.slice(0, 60) || "qr";
  for (let index = 0; index < 5; index += 1) {
    const candidate = cleanId(`${baseId}-${nanoid(8)}`);
    if (isSafeQrId(candidate) && !existingIds.has(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique qr_id");
}

async function createQrCode(body) {
  const catalog = await readQrCatalog();
  const input = normalizeQrInput(body);
  const qrId = nextQrId(input.campaign_id, catalog, input.qr_id);
  const imageFilename = `${qrId}.png`;
  const imageFilePath = path.join(QR_GENERATED_DIR, imageFilename);
  const imagePath = `/generated/qrs/${encodeURIComponent(imageFilename)}`;
  const timestamp = new Date().toISOString();

  await fsp.mkdir(QR_GENERATED_DIR, { recursive: true });
  await QRCode.toFile(imageFilePath, input.lp_url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });
  await fsp.chmod(imageFilePath, 0o644);

  const record = {
    qr_id: qrId,
    campaign_id: input.campaign_id,
    label: input.label,
    lp_url: input.lp_url,
    image_path: imagePath,
    created_at: timestamp,
    updated_at: timestamp
  };
  await writeQrCatalog({
    version: 1,
    qrs: [record, ...(catalog.qrs || []).filter((qr) => qr.qr_id !== qrId)]
  });
  return record;
}

function createPromoDraftFromPrompt(body) {
  const prompt = cleanDraftValue(body?.prompt, 1000);
  if (prompt.length < 4) {
    throw new Error("prompt is required");
  }

  const features = extractDraftFeatures(prompt);
  const draft = {
    pattern: inferDraftPattern(prompt),
    product_name: extractDraftProductName(prompt),
    price: extractDraftPrice(prompt),
    offer: extractDraftOffer(prompt),
    cta: extractDraftCta(prompt) || "店頭で今すぐチェック",
    feature_1: features[0] || "",
    feature_2: features[1] || "",
    feature_3: features[2] || "",
    duration_per_cut: extractDraftDuration(prompt) || 5
  };

  const missingFields = [];
  if (!draft.product_name) missingFields.push("商品名");
  if (!draft.price) missingFields.push("価格");
  if (!draft.offer) missingFields.push("特典");
  if (features.length < 3) missingFields.push("特徴");

  return {
    draft,
    missing_fields: missingFields,
    parser: "local-rule-v1"
  };
}

function inferDraftPattern(prompt) {
  if (/(ワイド|wide|横長|全画面|全面|3面全体|三面全体|空間ジャック)/i.test(prompt)) return "wide-first";
  if (/(2面|二面|2画面|二画面|商品を?2面|商品二面|左右.*商品)/.test(prompt)) return "two-panel-info";
  return "center-hero";
}

function extractDraftProductName(prompt) {
  const labeled = extractLabeledValue(prompt, ["商品名", "商品", "サービス名", "商材", "PR商品"]);
  if (labeled) return cleanDraftValue(stripDraftPrefix(labeled), 80);

  const quoted = prompt.match(/[「『\"]([^」』\"]{2,80})[」』\"]/);
  if (quoted) return cleanDraftValue(quoted[1], 80);

  const objectMatch = prompt.match(/(?:新商品|商品|サービス)?\s*([^。、「」『』]{2,80}?)(?:を|は)(?:中央|メイン|大きく|紹介|PR|訴求)/);
  if (objectMatch) return cleanDraftValue(stripDraftPrefix(objectMatch[1]), 80);

  return "";
}

function extractDraftPrice(prompt) {
  const labeled = extractLabeledValue(prompt, ["価格", "値段", "料金", "税込価格", "price"]);
  if (labeled) return cleanDraftValue(extractPriceToken(labeled) || labeled, 48);
  return cleanDraftValue(extractPriceToken(prompt), 48);
}

function extractDraftOffer(prompt) {
  const labeled = extractLabeledValue(prompt, ["特典", "オファー", "キャンペーン", "訴求", "offer"]);
  if (labeled) return cleanDraftValue(labeled, 80);

  const offerMatch = prompt.match(/((?:今だけ|本日限定|店頭限定|期間限定|数量限定|限定)[^。.!?\n]{0,40})/);
  return offerMatch ? cleanDraftValue(offerMatch[1], 80) : "";
}

function extractDraftCta(prompt) {
  const labeled = extractLabeledValue(prompt, ["CTA", "行動導線", "誘導文", "呼びかけ"]);
  if (labeled) return cleanDraftValue(labeled, 80);

  const ctaMatch = prompt.match(/((?:店頭で|今すぐ|詳しく|クーポン|予約|購入|チェック)[^。.!?\n]{0,40})/);
  return ctaMatch ? cleanDraftValue(ctaMatch[1], 80) : "";
}

function extractDraftFeatures(prompt) {
  const labeled = extractLabeledValue(prompt, ["特徴", "ポイント", "推し", "訴求ポイント"]);
  const featureSource = labeled || "";
  const candidates = featureSource
    ? splitDraftList(featureSource)
    : [1, 2, 3].map((number) => extractLabeledValue(prompt, [`特徴${number}`, `特徴 ${number}`, `ポイント${number}`]));

  return candidates
    .map((feature) => cleanDraftValue(feature, 48))
    .filter(Boolean)
    .filter((feature, index, values) => values.indexOf(feature) === index)
    .slice(0, 3);
}

function extractDraftDuration(prompt) {
  const match = prompt.match(/(\d{1,2})\s*(?:秒|s|sec|seconds)/i);
  if (!match) return null;
  return clampInt(match[1], 5, 2, 20);
}

function extractLabeledValue(prompt, labels) {
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = prompt.match(new RegExp(`(?:${labelPattern})\\s*(?:[:：=は])\\s*([^\\n。.!?]+)`, "i"));
  return match ? cleanDraftValue(match[1], 120) : "";
}

function splitDraftList(value) {
  return String(value || "")
    .split(/[、,，／/・;]/)
    .map((item) => item.trim());
}

function extractPriceToken(value) {
  const match = String(value || "").match(/(?:税込|税別)?\s*([0-9０-９][0-9０-９,，.．]*(?:円|yen|税込|税別)?)/i);
  if (!match) return "";
  return normalizeDraftNumbers(match[0]).replace(/\s+/g, "");
}

function stripDraftPrefix(value) {
  return String(value || "")
    .replace(/^(?:新商品|商品|サービス|商材|PR商品)\s*/, "")
    .trim();
}

function cleanDraftValue(value, maxLength) {
  return normalizeDraftNumbers(value)
    .replace(/javascript:/gi, "")
    .replace(/[<>`]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeDraftNumbers(value) {
  return String(value || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
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

function normalizePromoExportInput(promoId, body) {
  if (!isSafePromoId(promoId)) {
    throw new Error("promo_id is invalid");
  }

  const source = body || {};
  const preset = Object.hasOwn(VIDEO_EXPORT_PRESETS, source.preset) ? source.preset : "preview";
  const rawItems = Array.isArray(source.items) ? source.items : [];
  if (rawItems.length === 0) {
    throw new Error("items are required for promo video export");
  }
  if (rawItems.length > VIDEO_EXPORT_MAX_ITEMS) {
    throw new Error(`promo video export supports up to ${VIDEO_EXPORT_MAX_ITEMS} cuts`);
  }

  const items = rawItems.map((item, index) => normalizePromoExportItem(promoId, item, index));
  const durationSeconds = items.reduce((sum, item) => sum + item.duration, 0);
  if (durationSeconds > VIDEO_EXPORT_MAX_SECONDS) {
    throw new Error(`promo video export duration must be ${VIDEO_EXPORT_MAX_SECONDS} seconds or less`);
  }

  return {
    promo_id: promoId,
    preset,
    format: "webm",
    items,
    duration_seconds: durationSeconds
  };
}

function normalizePromoExportItem(promoId, item, index) {
  const layout = item?.layout === "wide" ? "wide" : "three-zone";
  const id = cleanId(item?.item_id || item?.id || `cut-${index + 1}`) || `cut-${index + 1}`;
  const base = {
    id,
    item_id: id,
    name: boundedString(item?.name, 100) || `PR cut ${index + 1}`,
    layout,
    duration: clampInt(item?.duration, 5, 1, 20)
  };

  if (layout === "wide") {
    return {
      ...base,
      left: "",
      center: "",
      right: "",
      wide: normalizePromoExportSource(`${base.item_id}.wide`, item?.wide, promoId)
    };
  }

  return {
    ...base,
    left: normalizePromoExportSource(`${base.item_id}.left`, item?.left, promoId),
    center: normalizePromoExportSource(`${base.item_id}.center`, item?.center, promoId),
    right: normalizePromoExportSource(`${base.item_id}.right`, item?.right, promoId),
    wide: ""
  };
}

function normalizePromoExportSource(label, source, promoId) {
  const value = cleanString(source);
  validateSource(label, value, { required: true, validateExists: true });
  const promoPrefix = `/generated/promos/${promoId}/`;
  if (!value.startsWith(promoPrefix)) {
    throw new Error(`${label} must be generated content for promo ${promoId}`);
  }
  return value;
}

async function createPromoVideoExport(input, options = {}) {
  const preset = VIDEO_EXPORT_PRESETS[input.preset] || VIDEO_EXPORT_PRESETS.preview;
  const exportId = `${input.promo_id}-${compactTimestamp().toLowerCase()}-${nanoid(6)}`;
  const relativeDir = path.join("exports", exportId);
  const exportDir = path.join(GENERATED_DIR, relativeDir);
  const outputFilename = "promo.webm";
  const outputPath = path.join(exportDir, outputFilename);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "misell-promo-export-"));

  try {
    await fsp.mkdir(exportDir, { recursive: true });
    const ffmpegBin = await findExecutable(process.env.MISELL_FFMPEG_BIN, ["ffmpeg"]);
    if (ffmpegBin) {
      const browserBin = await findExecutable(process.env.MISELL_CHROMIUM_BIN, [
        "chromium-browser",
        "chromium",
        "google-chrome-stable",
        "google-chrome"
      ]);
      await createPromoVideoWithFfmpeg(input, preset, tempDir, outputPath, options.baseUrl, ffmpegBin, browserBin);
    } else {
      await createPromoVideoWithPlaywright(input, preset, tempDir, outputPath, options.baseUrl);
    }
    await fsp.chmod(outputPath, 0o644);

    const stat = await fsp.stat(outputPath);
    if (stat.size < 1024) {
      throw new Error("WebM export produced an unexpectedly small file");
    }

    const manifest = {
      id: exportId,
      promo_id: input.promo_id,
      format: input.format,
      preset: input.preset,
      width: preset.width,
      height: preset.height,
      stage_width: preset.stageWidth,
      stage_height: preset.stageHeight,
      duration_seconds: input.duration_seconds,
      output: `/${path.posix.join("generated", "exports", exportId, outputFilename)}`,
      size: stat.size,
      created_at: new Date().toISOString(),
      items: input.items.map((item) => ({
        item_id: item.item_id,
        name: item.name,
        layout: item.layout,
        duration: item.duration
      }))
    };
    await writeJsonAtomic(path.join(exportDir, "manifest.json"), manifest);
    return manifest;
  } catch (error) {
    await fsp.rm(exportDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createPromoVideoWithFfmpeg(input, preset, tempDir, outputPath, baseUrl, ffmpegBin, browserBin) {
  const screenshots = [];
  for (const [index, item] of input.items.entries()) {
    const htmlPath = path.join(tempDir, `cut-${String(index + 1).padStart(2, "0")}.html`);
    const screenshotPath = path.join(tempDir, `cut-${String(index + 1).padStart(2, "0")}.png`);
    await fsp.writeFile(htmlPath, renderPromoExportComposite(item, preset, baseUrl), "utf8");
    await captureExportScreenshot(htmlPath, screenshotPath, preset, browserBin);
    screenshots.push({ path: screenshotPath, duration: item.duration });
  }

  const concatPath = path.join(tempDir, "frames.txt");
  await fsp.writeFile(concatPath, renderFfmpegConcatFile(screenshots), "utf8");
  await execFileAsync(ffmpegBin, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-an",
    "-c:v", "libvpx-vp9",
    "-deadline", "good",
    "-cpu-used", "4",
    "-b:v", "0",
    "-crf", "34",
    "-pix_fmt", "yuv420p",
    outputPath
  ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
}

async function createPromoVideoWithPlaywright(input, preset, tempDir, outputPath, baseUrl) {
  let chromium = null;
  try {
    chromium = require("playwright").chromium;
  } catch {
    throw new Error("WebM export requires ffmpeg or Playwright. Install ffmpeg or set MISELL_FFMPEG_BIN.");
  }

  const htmlPath = path.join(tempDir, "reel.html");
  await fsp.writeFile(htmlPath, renderPromoExportReel(input, preset, baseUrl), "utf8");
  const browser = await chromium.launch({ headless: true });
  let context = null;
  try {
    context = await browser.newContext({
      viewport: { width: preset.width, height: preset.height },
      recordVideo: {
        dir: tempDir,
        size: { width: preset.width, height: preset.height }
      }
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout((input.duration_seconds * 1000) + 1000);
    const video = page.video();
    await context.close();
    context = null;
    await fsp.copyFile(await video.path(), outputPath);
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close();
  }
}

function renderPromoExportComposite(item, preset, baseUrl = `http://127.0.0.1:${PORT}`) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=${preset.width}, initial-scale=1">
    <title>${escapeHtml(item.name)} export</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${preset.width}px;
        height: ${preset.height}px;
        overflow: hidden;
        background: #05070a;
      }
      body {
        display: grid;
        place-items: center;
      }
      .stage {
        width: ${preset.stageWidth}px;
        height: ${preset.stageHeight}px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-template-rows: 100%;
        overflow: hidden;
        background: #080b10;
      }
      iframe {
        width: 100%;
        height: 100%;
        display: block;
        border: 0;
        background: #080b10;
      }
      iframe + iframe {
        border-left: ${preset.stageWidth >= 3000 ? 6 : 2}px solid rgba(255, 255, 255, 0.16);
      }
      .wide-frame {
        grid-column: 1 / 4;
      }
    </style>
  </head>
  <body>
    <main class="stage">
      ${renderPromoExportFrames(item, baseUrl)}
    </main>
  </body>
</html>
`;
}

function renderPromoExportReel(input, preset, baseUrl = `http://127.0.0.1:${PORT}`) {
  const cuts = input.items.map((item) => ({
    duration_ms: item.duration * 1000,
    frames: renderPromoExportFrames(item, baseUrl)
  }));

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=${preset.width}, initial-scale=1">
    <title>${escapeHtml(input.promo_id)} export reel</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${preset.width}px;
        height: ${preset.height}px;
        overflow: hidden;
        background: #05070a;
      }
      body {
        display: grid;
        place-items: center;
      }
      .stage {
        width: ${preset.stageWidth}px;
        height: ${preset.stageHeight}px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-template-rows: 100%;
        overflow: hidden;
        background: #080b10;
      }
      iframe {
        width: 100%;
        height: 100%;
        display: block;
        border: 0;
        background: #080b10;
      }
      iframe + iframe {
        border-left: ${preset.stageWidth >= 3000 ? 6 : 2}px solid rgba(255, 255, 255, 0.16);
      }
      .wide-frame {
        grid-column: 1 / 4;
      }
    </style>
  </head>
  <body>
    <main id="stage" class="stage"></main>
    <script id="cuts" type="application/json">${escapeScriptJson(cuts)}</script>
    <script>
      const cuts = JSON.parse(document.getElementById("cuts").textContent);
      const stage = document.getElementById("stage");
      let index = 0;
      function showNext() {
        const cut = cuts[index];
        if (!cut) {
          document.body.dataset.done = "1";
          return;
        }
        stage.innerHTML = cut.frames;
        index += 1;
        window.setTimeout(showNext, cut.duration_ms);
      }
      showNext();
    </script>
  </body>
</html>
`;
}

function renderPromoExportFrames(item, baseUrl) {
  if (item.layout === "wide") {
    return `<iframe class="wide-frame" src="${escapeAttr(toAbsoluteLocalUrl(item.wide, baseUrl))}" title="${escapeAttr(item.name)} wide" allow="autoplay"></iframe>`;
  }
  return ["left", "center", "right"].map((zone) => (
    `<iframe src="${escapeAttr(toAbsoluteLocalUrl(item[zone], baseUrl))}" title="${escapeAttr(item.name)} ${zone}" allow="autoplay"></iframe>`
  )).join("");
}

function toAbsoluteLocalUrl(source, baseUrl) {
  return new URL(source, baseUrl).href;
}

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

async function captureExportScreenshot(htmlPath, screenshotPath, preset, browserBin) {
  if (browserBin) {
    try {
      await execFileAsync(browserBin, [
        "--headless",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--mute-audio",
        "--autoplay-policy=no-user-gesture-required",
        "--virtual-time-budget=1500",
        `--window-size=${preset.width},${preset.height}`,
        `--screenshot=${screenshotPath}`,
        pathToFileURL(htmlPath).href
      ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      return;
    } catch (error) {
      await captureExportScreenshotWithPlaywright(htmlPath, screenshotPath, preset, error);
      return;
    }
  }

  await captureExportScreenshotWithPlaywright(htmlPath, screenshotPath, preset);
}

async function captureExportScreenshotWithPlaywright(htmlPath, screenshotPath, preset, browserError) {
  let chromium = null;
  try {
    chromium = require("playwright").chromium;
  } catch {
    const suffix = browserError ? ` Chromium failed first: ${browserError.message}` : "";
    throw new Error(`Video export requires Chromium or Playwright.${suffix}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: preset.width, height: preset.height },
      deviceScaleFactor: 1
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotPath, type: "png" });
  } finally {
    await browser.close();
  }
}

async function findExecutable(envValue, candidates) {
  const values = [envValue, ...candidates].filter(Boolean);
  for (const value of values) {
    const resolved = await resolveExecutable(value);
    if (!resolved) continue;
    try {
      await execFileAsync(resolved, ["-version"], { timeout: 5000, maxBuffer: 512 * 1024 });
      return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

async function resolveExecutable(value) {
  if (value.includes("/") || value.includes(path.sep)) return value;
  try {
    const { stdout } = await execFileAsync("which", [value], { timeout: 5000, maxBuffer: 64 * 1024 });
    return stdout.trim().split(/\r?\n/)[0] || "";
  } catch {
    return "";
  }
}

function renderFfmpegConcatFile(screenshots) {
  const lines = [];
  for (const frame of screenshots) {
    lines.push(`file '${escapeFfmpegConcatPath(frame.path)}'`);
    lines.push(`duration ${frame.duration}`);
  }
  if (screenshots.length > 0) {
    lines.push(`file '${escapeFfmpegConcatPath(screenshots[screenshots.length - 1].path)}'`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeFfmpegConcatPath(filePath) {
  return String(filePath).replaceAll("'", "'\\''");
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

app.get("/api/qrs", requireAdminAuth, async (req, res, next) => {
  try {
    const catalog = await readQrCatalog();
    res.json({
      ok: true,
      version: catalog.version,
      qrs: catalog.qrs
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/qrs", requireAdminAuth, async (req, res, next) => {
  try {
    const input = normalizeQrInput(req.body || {});
    const backup = await createContentBackup("before-qr-generate");
    const qr = await createQrCode(input);
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "qr.generate",
      ip: req.ip,
      qr_id: qr.qr_id,
      campaign_id: qr.campaign_id,
      lp_url: qr.lp_url,
      image_path: qr.image_path,
      backup: backup.name
    });
    res.status(201).json({ ok: true, qr, backup });
  } catch (error) {
    next(error);
  }
});

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

app.post("/api/promo-drafts", requireAdminAuth, async (req, res, next) => {
  try {
    const result = createPromoDraftFromPrompt(req.body || {});
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "promo.draft",
      ip: req.ip,
      parser: result.parser,
      missing_fields: result.missing_fields
    });
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/promo-campaigns/:promoId/export", requireAdminAuth, async (req, res, next) => {
  try {
    const input = normalizePromoExportInput(cleanId(req.params.promoId), req.body || {});
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const videoExport = await createPromoVideoExport(input, { baseUrl });
    await appendJsonl(ADMIN_LOG_KEY, {
      action: "promo.export",
      ip: req.ip,
      promo_id: input.promo_id,
      preset: videoExport.preset,
      format: videoExport.format,
      duration_seconds: videoExport.duration_seconds,
      size: videoExport.size,
      output: videoExport.output
    });
    res.status(201).json({ ok: true, export: videoExport });
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
    const timestamp = cleanString(body.timestamp || body.occurred_at || body.occurredAt) || new Date().toISOString();
    const playbackId = cleanString(body.playback_id || body.playbackId) || nanoid(12);
    const entry = {
      event_id: cleanString(body.event_id || body.eventId) || `play-${playbackId}`,
      event_type: cleanString(body.event_type || body.eventType || "playback"),
      timestamp,
      playback_id: playbackId,
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
    await persistPlaybackLog(entry);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/log/play", async (req, res, next) => {
  try {
    const body = req.body || {};
    const timestamp = cleanString(body.timestamp || body.occurred_at || body.occurredAt) || new Date().toISOString();
    const playbackId = cleanString(body.playback_id || body.playbackId) || nanoid(12);
    const entry = {
      event_id: cleanString(body.event_id || body.eventId) || `play-${playbackId}`,
      event_type: cleanString(body.event_type || body.eventType || "playback"),
      timestamp,
      playback_id: playbackId,
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
    await persistPlaybackLog(entry);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function rememberPlayback(entry) {
  lastPlayback = {
    timestamp: cleanString(entry.timestamp) || new Date().toISOString(),
    item_id: cleanString(entry.item_id || entry.playlist_item_id || entry.itemId),
    layout: cleanString(entry.layout),
    result: cleanString(entry.result)
  };
}

async function persistPlaybackLog(entry) {
  rememberPlayback(entry);
  await appendJsonl(PLAYLOG_KEY, entry);
  try {
    enqueuePlaybackLog(entry);
  } catch (error) {
    await appendJsonl(ERROR_LOG_KEY, {
      action: "local_state.enqueue_playlog_failed",
      event_id: cleanString(entry.event_id),
      message: error.message || "local state enqueue failed"
    });
  }
}

function enqueuePlaybackLog(entry) {
  if (!localState) return;
  const occurredAt = cleanString(entry.timestamp) || new Date().toISOString();
  const payload = {
    ...deviceIdentity,
    ...entry,
    occurred_at: occurredAt,
    timestamp: occurredAt
  };
  localState.enqueueOutboundEvent({
    event_id: entry.event_id,
    event_type: "playlog",
    endpoint: PLAYLOG_ENDPOINT,
    payload
  });
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
  await ensureRuntimeFiles({ openLocalState: false });
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
