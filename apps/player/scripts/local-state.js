#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const dotenv = require("dotenv");

const { openLocalState, sha256File } = require("../lib/local-state");

const APP_DIR = path.resolve(__dirname, "..");

loadEnvFile();

const command = process.argv[2] || "summary";
const args = parseArgs(process.argv.slice(3));
const state = openLocalState(localStateDbPath());

try {
  if (command === "summary") {
    print(state.summary());
  } else if (command === "record-content") {
    state.recordAppliedContent({
      content_id: args.content_id,
      playlist_version: args.playlist_version,
      source: args.source,
      status: args.status,
      message: args.message,
      previous_playlist_version: args.previous_playlist_version,
      playlist_sha256: args.playlist_sha256 || hashIfExists(args.playlist_path),
      manifest: parseJson(process.env.POLICY_JSON || "", null)
    });
    print({ ok: true, local_state: state.summary() });
  } else if (command === "record-asset") {
    state.recordAssetState({
      content_id: args.content_id,
      asset_id: args.asset_id,
      target_path: args.target_path,
      local_path: args.local_path,
      sha256: args.sha256,
      size: args.size,
      status: args.status,
      message: args.message
    });
    print({ ok: true, local_state: state.summary() });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} finally {
  state.close();
}

function loadEnvFile() {
  const envFile = process.env.MISELL_ENV_FILE || path.join(os.homedir(), ".config", "misell-player", "env");
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, override: false, quiet: true });
}

function localStateDbPath() {
  if (process.env.MISELL_LOCAL_STATE_DB_PATH) return path.resolve(process.env.MISELL_LOCAL_STATE_DB_PATH);
  const dataDir = process.env.MISELL_DATA_DIR
    ? path.resolve(process.env.MISELL_DATA_DIR)
    : path.join(APP_DIR, "data");
  return path.join(dataDir, "local_state.sqlite");
}

function hashIfExists(filePath) {
  if (!filePath) return "";
  try {
    return sha256File(path.resolve(filePath));
  } catch {
    return "";
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const normalized = key.slice(2).replace(/-/g, "_");
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[normalized] = "1";
    } else {
      parsed[normalized] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
