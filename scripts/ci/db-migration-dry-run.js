#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

async function main() {
  const repoRoot = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "misell-cloud-db-dry-run-"));
  const port = await getFreePort();
  const dbPath = path.join(tempDir, "misell-cloud.sqlite");
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_PATH: dbPath,
    MISELL_CLOUD_DATA_DIR: tempDir,
    MISELL_CLOUD_ASSETS_DIR: path.join(tempDir, "assets"),
    ADMIN_PASSWORD: "ci-admin-password",
    DEVICE_TOKEN_PEPPER: "ci-device-token-pepper-value"
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(repoRoot, "apps/cloud"),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(port);
    if (!fs.existsSync(dbPath)) throw new Error(`Expected dry-run DB to exist at ${dbPath}`);
    assertStudioPhase1Schema(repoRoot, dbPath);
    console.log(`Cloud DB dry-run passed: ${dbPath}`);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (stderr.trim()) console.log(stderr.trim());
}

function assertStudioPhase1Schema(repoRoot, dbPath) {
  const Database = require(path.join(repoRoot, "apps/cloud/node_modules/better-sqlite3"));
  const db = new Database(dbPath, { readonly: true });
  try {
    for (const table of ["screen_slots", "screen_device_bindings", "content_approvals", "publish_history"]) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!row) throw new Error(`Expected Studio Phase 1 table '${table}' to exist`);
    }
    assertColumns(db, "content_manifests", [
      "tenant_id",
      "store_id",
      "screen_group_id",
      "screen_slot_id",
      "manifest_schema_version",
      "manifest_version",
      "content_hash",
      "lifecycle_status"
    ]);
    assertColumns(db, "content_approvals", [
      "approval_id",
      "tenant_id",
      "store_id",
      "screen_group_id",
      "screen_slot_id",
      "content_type",
      "subject_type",
      "subject_id",
      "subject_hash",
      "content_hash",
      "approval_status"
    ]);
    assertColumns(db, "publish_history", [
      "publish_history_id",
      "content_id",
      "manifest_version",
      "manifest_schema_version",
      "content_hash",
      "approval_snapshot_json",
      "approval_hash"
    ]);
  } finally {
    db.close();
  }
}

function assertColumns(db, table, columns) {
  const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const column of columns) {
    if (!present.has(column)) throw new Error(`Expected ${table}.${column} to exist`);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForHealth(port) {
  const deadline = Date.now() + 15000;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${port}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for cloud server health during DB dry-run"));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
