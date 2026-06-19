const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");

const SCHEMA_VERSION = 1;
const PLAYLOG_ENDPOINT = "/api/device/playlog";
const EVENT_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;

function openLocalState(dbPath) {
  if (!dbPath) throw new Error("local state dbPath is required");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  applySchema(db);
  return new LocalState(db, dbPath);
}

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_state_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_token TEXT,
      claimed_at TEXT,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_attempt_at TEXT,
      sent_at TEXT,
      response_status INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_outbound_events_status_next
      ON outbound_events(status, next_attempt_at, id);
    CREATE INDEX IF NOT EXISTS idx_outbound_events_endpoint_status
      ON outbound_events(endpoint, status, id);

    CREATE TABLE IF NOT EXISTS applied_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT,
      playlist_version TEXT,
      source TEXT,
      status TEXT NOT NULL,
      playlist_sha256 TEXT,
      previous_playlist_version TEXT,
      message TEXT,
      manifest_json TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applied_content_latest
      ON applied_content(updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_applied_content_content
      ON applied_content(content_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS local_asset_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT,
      asset_id TEXT NOT NULL,
      target_path TEXT NOT NULL,
      local_path TEXT,
      sha256 TEXT,
      size INTEGER,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(content_id, asset_id, target_path)
    );

    CREATE INDEX IF NOT EXISTS idx_local_asset_states_status
      ON local_asset_states(status, updated_at DESC);
  `);

  addColumnIfMissing(db, "outbound_events", "claim_token", "TEXT");
  addColumnIfMissing(db, "outbound_events", "claimed_at", "TEXT");

  db.prepare(`
    INSERT INTO local_state_meta (key, value, updated_at)
    VALUES ('schema_version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(SCHEMA_VERSION), nowIso());
}

class LocalState {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
    this.statements = {
      getOutbound: db.prepare("SELECT * FROM outbound_events WHERE event_id = ?"),
      insertOutbound: db.prepare(`
        INSERT INTO outbound_events (
          event_id, event_type, endpoint, status, payload_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
      `),
      resetExpiredClaims: db.prepare(`
        UPDATE outbound_events SET
          status = 'failed',
          claim_token = '',
          claimed_at = '',
          updated_at = ?
        WHERE endpoint = ?
          AND status = 'sending'
          AND sent_at IS NULL
          AND claimed_at <= ?
      `),
      listClaimable: db.prepare(`
        SELECT * FROM outbound_events
        WHERE endpoint = ?
          AND status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at = '' OR next_attempt_at <= ?)
        ORDER BY id ASC
        LIMIT ?
      `),
      claimById: db.prepare(`
        UPDATE outbound_events SET
          status = 'sending',
          claim_token = ?,
          claimed_at = ?,
          last_attempt_at = ?,
          updated_at = ?
        WHERE id = ?
          AND status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at = '' OR next_attempt_at <= ?)
      `),
      listClaimedByToken: db.prepare(`
        SELECT * FROM outbound_events
        WHERE claim_token = ?
        ORDER BY id ASC
      `),
      markSent: db.prepare(`
        UPDATE outbound_events SET
          status = 'sent',
          claim_token = '',
          claimed_at = '',
          sent_at = ?,
          last_attempt_at = ?,
          response_status = ?,
          last_error = '',
          updated_at = ?
        WHERE event_id = ?
          AND (? = '' OR claim_token = ?)
      `),
      markFailed: db.prepare(`
        UPDATE outbound_events SET
          status = 'failed',
          claim_token = '',
          claimed_at = '',
          attempt_count = attempt_count + 1,
          next_attempt_at = ?,
          last_attempt_at = ?,
          response_status = ?,
          last_error = ?,
          updated_at = ?
        WHERE event_id = ?
          AND status != 'sent'
          AND (? = '' OR claim_token = ?)
      `),
      purgeSent: db.prepare(`
        DELETE FROM outbound_events
        WHERE endpoint = ?
          AND status = 'sent'
          AND sent_at IS NOT NULL
          AND sent_at != ''
          AND sent_at < ?
      `),
      contentInsert: db.prepare(`
        INSERT INTO applied_content (
          content_id, playlist_version, source, status, playlist_sha256,
          previous_playlist_version, message, manifest_json, applied_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      assetUpsert: db.prepare(`
        INSERT INTO local_asset_states (
          content_id, asset_id, target_path, local_path, sha256, size,
          status, message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(content_id, asset_id, target_path) DO UPDATE SET
          local_path = excluded.local_path,
          sha256 = excluded.sha256,
          size = excluded.size,
          status = excluded.status,
          message = excluded.message,
          updated_at = excluded.updated_at
      `),
      outboundStatusCounts: db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM outbound_events
        GROUP BY status
      `),
      latestContent: db.prepare(`
        SELECT * FROM applied_content
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `),
      assetStatusCounts: db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM local_asset_states
        GROUP BY status
      `)
    };
  }

  enqueueOutboundEvent(input) {
    const payload = normalizePayload(input.payload);
    const eventId = validateEventId(input.event_id || input.eventId || payload.event_id || payload.eventId);
    const existing = this.statements.getOutbound.get(eventId);
    if (existing) return { inserted: false, event: publicOutboundEvent(existing) };

    const eventType = cleanString(input.event_type || input.eventType || payload.event_type || payload.eventType || "playlog");
    const endpoint = cleanString(input.endpoint || PLAYLOG_ENDPOINT);
    const now = cleanString(input.now) || nowIso();
    this.statements.insertOutbound.run(eventId, eventType, endpoint, JSON.stringify(payload), now, now);
    return { inserted: true, event: publicOutboundEvent(this.statements.getOutbound.get(eventId)) };
  }

  listPendingOutboundEvents(options = {}) {
    const endpoint = cleanString(options.endpoint || PLAYLOG_ENDPOINT);
    const limit = boundedLimit(options.limit, 100, 1, 500);
    const now = cleanString(options.now) || nowIso();
    return this.statements.listClaimable.all(endpoint, now, limit).map(publicOutboundEvent);
  }

  claimPendingOutboundEvents(options = {}) {
    const endpoint = cleanString(options.endpoint || PLAYLOG_ENDPOINT);
    const limit = boundedLimit(options.limit, 100, 1, 500);
    const now = cleanString(options.now) || nowIso();
    const staleSeconds = boundedLimit(options.stale_claim_seconds ?? options.staleClaimSeconds, 600, 30, 86400);
    const staleBefore = new Date(Date.parse(now) - staleSeconds * 1000).toISOString();
    const claimToken = cleanString(options.claim_token || options.claimToken || crypto.randomUUID());
    const claim = this.db.transaction(() => {
      this.statements.resetExpiredClaims.run(now, endpoint, staleBefore);
      const rows = this.statements.listClaimable.all(endpoint, now, limit);
      for (const row of rows) {
        this.statements.claimById.run(claimToken, now, now, now, row.id, now);
      }
      return this.statements.listClaimedByToken.all(claimToken);
    });
    return claim().map(publicOutboundEvent);
  }

  markOutboundSent(eventId, options = {}) {
    const now = cleanString(options.now) || nowIso();
    const claimToken = cleanString(options.claim_token || options.claimToken);
    this.statements.markSent.run(
      now,
      now,
      asInteger(options.response_status ?? options.responseStatus),
      now,
      validateEventId(eventId),
      claimToken,
      claimToken
    );
  }

  markOutboundFailed(eventId, error, options = {}) {
    const now = cleanString(options.now) || nowIso();
    const claimToken = cleanString(options.claim_token || options.claimToken);
    const existing = this.statements.getOutbound.get(validateEventId(eventId));
    const attemptCount = Number(existing?.attempt_count || 0) + 1;
    const retrySeconds = Math.min(3600, 60 * (2 ** Math.min(attemptCount - 1, 5)));
    const nextAttemptAt = cleanString(options.next_attempt_at || options.nextAttemptAt) ||
      new Date(Date.parse(now) + retrySeconds * 1000).toISOString();
    this.statements.markFailed.run(
      nextAttemptAt,
      now,
      asInteger(options.response_status ?? options.responseStatus),
      cleanString(error).slice(0, 1000),
      now,
      validateEventId(eventId),
      claimToken,
      claimToken
    );
  }

  purgeSentOutboundEvents(options = {}) {
    const endpoint = cleanString(options.endpoint || PLAYLOG_ENDPOINT);
    const retentionDays = boundedLimit(options.retention_days ?? options.retentionDays, 30, 1, 3650);
    const now = cleanString(options.now) || nowIso();
    const cutoff = new Date(Date.parse(now) - retentionDays * 86400000).toISOString();
    return this.statements.purgeSent.run(endpoint, cutoff).changes;
  }

  recordAppliedContent(input) {
    const now = cleanString(input.now) || nowIso();
    this.statements.contentInsert.run(
      cleanString(input.content_id || input.contentId),
      cleanString(input.playlist_version || input.playlistVersion),
      cleanString(input.source),
      cleanString(input.status || "unknown"),
      cleanString(input.playlist_sha256 || input.playlistSha256),
      cleanString(input.previous_playlist_version || input.previousPlaylistVersion),
      cleanString(input.message).slice(0, 1000),
      jsonOrEmpty(input.manifest),
      input.status === "success" ? now : "",
      now,
      now
    );
  }

  recordAssetState(input) {
    const assetId = cleanId(input.asset_id || input.assetId);
    const targetPath = cleanString(input.target_path || input.targetPath);
    if (!assetId || !targetPath) throw new Error("asset_id and target_path are required");
    const now = cleanString(input.now) || nowIso();
    this.statements.assetUpsert.run(
      cleanString(input.content_id || input.contentId),
      assetId,
      targetPath,
      cleanString(input.local_path || input.localPath),
      cleanString(input.sha256),
      asInteger(input.size),
      cleanString(input.status || "unknown"),
      cleanString(input.message).slice(0, 1000),
      now,
      now
    );
  }

  summary(options = {}) {
    const summary = {
      outbound_events: countsByStatus(this.statements.outboundStatusCounts.all()),
      latest_content: publicAppliedContent(this.statements.latestContent.get()),
      assets: countsByStatus(this.statements.assetStatusCounts.all())
    };
    if (options.include_db_path !== false && options.includeDbPath !== false) {
      summary.db_path = this.dbPath;
    }
    return summary;
  }

  close() {
    this.db.close();
  }
}

function publicOutboundEvent(row) {
  if (!row) return null;
  return {
    event_id: cleanString(row.event_id),
    event_type: cleanString(row.event_type),
    endpoint: cleanString(row.endpoint),
    status: cleanString(row.status),
    payload: parseJson(row.payload_json, {}),
    attempt_count: asInteger(row.attempt_count) || 0,
    claim_token: cleanString(row.claim_token),
    claimed_at: cleanString(row.claimed_at),
    next_attempt_at: cleanString(row.next_attempt_at),
    last_attempt_at: cleanString(row.last_attempt_at),
    sent_at: cleanString(row.sent_at),
    response_status: asInteger(row.response_status),
    last_error: cleanString(row.last_error),
    created_at: cleanString(row.created_at),
    updated_at: cleanString(row.updated_at)
  };
}

function publicAppliedContent(row) {
  if (!row) return null;
  return {
    content_id: cleanString(row.content_id),
    playlist_version: cleanString(row.playlist_version),
    source: cleanString(row.source),
    status: cleanString(row.status),
    playlist_sha256: cleanString(row.playlist_sha256),
    previous_playlist_version: cleanString(row.previous_playlist_version),
    message: cleanString(row.message),
    applied_at: cleanString(row.applied_at),
    updated_at: cleanString(row.updated_at)
  };
}

function countsByStatus(rows) {
  const result = {};
  for (const row of rows || []) {
    result[cleanString(row.status || "unknown")] = Number(row.count || 0);
  }
  return result;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return { ...payload };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function jsonOrEmpty(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function boundedLimit(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function asInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function cleanString(value) {
  return String(value || "").trim();
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 160);
}

function validateEventId(value) {
  const eventId = cleanString(value);
  if (!eventId) throw new Error("event_id is required for outbound event");
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new Error("event_id must be 1-160 chars of a-z, A-Z, 0-9, _, ., :, or -");
  }
  return eventId;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  EVENT_ID_PATTERN,
  PLAYLOG_ENDPOINT,
  openLocalState,
  sha256File
};
