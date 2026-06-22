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
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playerDir = path.resolve(appDir, "..", "player");
const deniedRoles = ["", "customer_admin", "customer_editor", "customer_viewer", "advertiser", "store_admin"];
const allowedRoles = ["misell_owner", "misell_operator", "device_ops"];

let serverProcess = null;
let tmpDir = "";
let dbPath = "";
let baseUrl = "";

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  process.exit(1);
});

async function main() {
  for (const role of deniedRoles) {
    await smokeDeniedRole(role);
  }
  for (const role of allowedRoles) {
    await smokeAllowedCreate(role);
  }
  const result = await smokeAllowedCommandFlow();
  console.log(JSON.stringify({
    ...result,
    denied_roles: deniedRoles,
    allowed_roles: allowedRoles
  }, null, 2));
}

async function smokeDeniedRole(role) {
  await startServer(role, `denied-${safeRoleName(role)}`);
  try {
    const device = await createDevice(`DENIED-${safeRoleName(role)}`);
    await expectAdminError(
      "POST",
      `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`,
      { command_type: "restart_player" },
      403,
      "not allowed"
    );
  } finally {
    await stopServer();
  }
}

async function smokeAllowedCreate(role) {
  await startServer(role, `allowed-${safeRoleName(role)}`);
  try {
    const device = await createDevice(`ALLOW-${safeRoleName(role)}`);
    const command = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "reload_player_content",
      reason: `allowed role smoke ${role}`,
      ttl_seconds: 120
    });
    if (command.status !== 201 || command.data.device_command.status !== "queued") {
      throw new Error(`allowed role ${role} could not create command`);
    }
  } finally {
    await stopServer();
  }
}

async function smokeAllowedCommandFlow() {
  await startServer("device_ops", "allowed");
  try {
    const device = await createDevice("ALLOWED");
    const auth = { authorization: `Bearer ${device.device_token}` };

    await expectAdminError(
      "POST",
      `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`,
      { command_type: "restart_device" },
      400,
      "command_type"
    );
    await expectAdminError(
      "POST",
      `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`,
      { command_type: "restart_player", params: { command: "rm -rf /" } },
      400,
      "not allowed"
    );

    const runnerCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "restart_player",
      reason: "runner smoke",
      ttl_seconds: 120
    });
    const firstPending = await request("GET", "/api/device/commands", null, auth);
    if (firstPending.data.commands[0]?.claim_token) throw new Error("pending command leaked claim_token");
    if (!firstPending.data.commands.some((item) => item.device_command_id === runnerCommand.data.device_command.device_command_id)) {
      throw new Error("created command was not visible to device");
    }

    const disabledRunner = await runNode([path.join(playerDir, "scripts", "sync-commands.js"), "--limit", "5"], {
      cwd: playerDir,
      env: {
        ...process.env,
        MISELL_ENV_FILE: path.join(tmpDir, "no-player-env"),
        MISELL_DEVICE_COMMANDS_URL: `${baseUrl}/api/device/commands`,
        MISELL_DEVICE_TOKEN: device.device_token,
        MISELL_COMMAND_RUNNER_ENABLED: "0",
        MISELL_COMMAND_RUNNER_DRY_RUN: "1",
        MISELL_COMMAND_RUNNER_ID: `disabled-runner-${runId}`
      }
    });
    if (disabledRunner.status !== 0) {
      throw new Error(`disabled sync-commands failed: ${disabledRunner.stdout}\n${disabledRunner.stderr}`);
    }
    const disabledOutput = JSON.parse(disabledRunner.stdout || "{}");
    if (!disabledOutput.skipped) {
      throw new Error(`disabled runner did not skip: ${disabledRunner.stdout}`);
    }
    const stillQueued = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({
      device_id: device.device_id,
      status: "queued"
    })}`);
    const queuedRunnerCommand = stillQueued.data.device_commands.find((item) => item.device_command_id === runnerCommand.data.device_command.device_command_id);
    if (!queuedRunnerCommand || queuedRunnerCommand.claimed_at) {
      throw new Error("disabled runner claimed a queued command");
    }

    const runner = await runNode([path.join(playerDir, "scripts", "sync-commands.js"), "--limit", "5"], {
      cwd: playerDir,
      env: {
        ...process.env,
        MISELL_ENV_FILE: path.join(tmpDir, "no-player-env"),
        MISELL_DEVICE_COMMANDS_URL: `${baseUrl}/api/device/commands`,
        MISELL_DEVICE_TOKEN: device.device_token,
        MISELL_COMMAND_RUNNER_ENABLED: "1",
        MISELL_COMMAND_RUNNER_DRY_RUN: "1",
        MISELL_COMMAND_RUNNER_ID: `smoke-runner-${runId}`
      }
    });
    if (runner.status !== 0) {
      throw new Error(`sync-commands failed: ${runner.stdout}\n${runner.stderr}`);
    }
    const runnerOutput = JSON.parse(runner.stdout || "{}");
    if (runnerOutput.succeeded !== 1 || runnerOutput.failed !== 0) {
      throw new Error(`unexpected runner output: ${runner.stdout}`);
    }
    const succeeded = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({
      device_id: device.device_id,
      status: "succeeded"
    })}`);
    const runnerResult = succeeded.data.device_commands.find((item) => item.device_command_id === runnerCommand.data.device_command.device_command_id);
    if (!runnerResult) throw new Error("runner command was not marked succeeded");
    if (JSON.stringify(runnerResult.result).includes("stdout") || JSON.stringify(runnerResult.result).includes("stderr")) {
      throw new Error("runner result included stdout/stderr");
    }

    const manualCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "sync_content_now",
      reason: "manual claim smoke",
      ttl_seconds: 120
    });
    const manualId = manualCommand.data.device_command.device_command_id;
    const claim = await request("POST", `/api/device/commands/${encodeURIComponent(manualId)}/claim`, {
      runner_id: "manual-smoke"
    }, auth);
    await expectAdminError("POST", `/api/admin/device-commands/${encodeURIComponent(manualId)}/cancel`, {
      reason: "claimed command should not cancel"
    }, 409, "already been claimed");
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(manualId)}/claim`, {
      runner_id: "manual-smoke-2"
    }, auth, 409, "not queued");
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(manualId)}/result`, {
      claim_token: "wrong-token",
      status: "succeeded",
      summary: "should be rejected"
    }, auth, 403, "claim token");
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(manualId)}/result`, {
      claim_token: claim.data.device_command.claim_token,
      status: "succeeded",
      stdout: "raw output must not be accepted"
    }, auth, 400, "stdout");
    await request("POST", `/api/device/commands/${encodeURIComponent(manualId)}/result`, {
      claim_token: claim.data.device_command.claim_token,
      status: "succeeded",
      exit_code: 0,
      summary: "manual command completed",
      runner_id: "manual-smoke"
    }, auth);
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(manualId)}/result`, {
      claim_token: claim.data.device_command.claim_token,
      status: "failed",
      summary: "late result"
    }, auth, 409, "not claimed");

    const cancelCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "reload_player_content",
      reason: "cancel smoke",
      ttl_seconds: 120
    });
    const cancelId = cancelCommand.data.device_command.device_command_id;
    const cancelled = await admin("POST", `/api/admin/device-commands/${encodeURIComponent(cancelId)}/cancel`, {
      reason: "operator cancelled smoke"
    });
    if (cancelled.data.device_command.status !== "cancelled") throw new Error("cancel did not mark command cancelled");
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(cancelId)}/claim`, {
      runner_id: "cancel-smoke"
    }, auth, 409, "not queued");

    const expiryCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "collect_logs",
      reason: "expiry smoke",
      ttl_seconds: 1
    });
    await sleep(1200);
    await request("GET", "/api/device/commands", null, auth);
    const expired = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({
      device_id: device.device_id,
      status: "expired"
    })}`);
    if (!expired.data.device_commands.some((item) => item.device_command_id === expiryCommand.data.device_command.device_command_id)) {
      throw new Error("expired command was not marked expired");
    }

    const staleCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "sync_content_now",
      reason: "stale smoke",
      ttl_seconds: 120
    });
    const staleId = staleCommand.data.device_command.device_command_id;
    const staleClaim = await request("POST", `/api/device/commands/${encodeURIComponent(staleId)}/claim`, {
      runner_id: "stale-smoke"
    }, auth);
    setCommandFields(staleId, {
      claimed_at: "2000-01-01T00:00:00.000Z",
      updated_at: "2000-01-01T00:00:00.000Z"
    });
    await admin("GET", `/api/admin/device-commands?${new URLSearchParams({ device_id: device.device_id })}`);
    const staleList = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({
      device_id: device.device_id,
      status: "stale"
    })}`);
    const staleResult = staleList.data.device_commands.find((item) => item.device_command_id === staleId);
    if (!staleResult || staleResult.terminal !== true) throw new Error("claimed command was not marked terminal stale");
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(staleId)}/result`, {
      claim_token: staleClaim.data.device_command.claim_token,
      status: "succeeded",
      summary: "late stale result"
    }, auth, 409, "not claimed");

    const forceCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "collect_logs",
      reason: "force cancel smoke",
      ttl_seconds: 120
    });
    const forceId = forceCommand.data.device_command.device_command_id;
    const forceClaim = await request("POST", `/api/device/commands/${encodeURIComponent(forceId)}/claim`, {
      runner_id: "force-cancel-smoke"
    }, auth);
    const forceCancelled = await admin("POST", `/api/admin/device-commands/${encodeURIComponent(forceId)}/force-cancel`, {
      reason: "operator force cancel smoke"
    });
    if (forceCancelled.data.device_command.status !== "force_cancelled" || forceCancelled.data.device_command.result.previous_status !== "claimed") {
      throw new Error(`force-cancel did not preserve previous status: ${JSON.stringify(forceCancelled.data.device_command)}`);
    }
    await expectAdminError("POST", `/api/admin/device-commands/${encodeURIComponent(forceId)}/force-cancel`, {
      reason: "terminal force cancel should fail"
    }, 409, "already terminal");
    await expectDeviceError("POST", `/api/device/commands/${encodeURIComponent(forceId)}/result`, {
      claim_token: forceClaim.data.device_command.claim_token,
      status: "failed",
      summary: "late force-cancelled result"
    }, auth, 409, "not claimed");

    const retentionCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "reload_player_content",
      reason: "retention smoke",
      ttl_seconds: 120
    });
    const retentionId = retentionCommand.data.device_command.device_command_id;
    await admin("POST", `/api/admin/device-commands/${encodeURIComponent(retentionId)}/cancel`, {
      reason: "retention smoke cancel"
    });
    setCommandFields(retentionId, {
      completed_at: "2000-01-01T00:00:00.000Z",
      updated_at: "2000-01-01T00:00:00.000Z"
    });
    const activeOldCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/commands`, {
      command_type: "reload_player_content",
      reason: "active old command must survive retention",
      ttl_seconds: 120
    });
    const activeOldId = activeOldCommand.data.device_command.device_command_id;
    setCommandFields(activeOldId, {
      requested_at: "2000-01-01T00:00:00.000Z",
      updated_at: "2000-01-01T00:00:00.000Z"
    });
    const afterPurge = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({ device_id: device.device_id, limit: "500" })}`);
    if (afterPurge.data.device_commands.some((item) => item.device_command_id === retentionId)) {
      throw new Error("old terminal command was not purged");
    }
    if (!afterPurge.data.device_commands.some((item) => item.device_command_id === activeOldId)) {
      throw new Error("active queued command was purged by retention");
    }

    const otherDevice = await createDevice("OTHER");
    const otherCommand = await admin("POST", `/api/admin/devices/${encodeURIComponent(otherDevice.device_id)}/commands`, {
      command_type: "reload_player_content",
      reason: "scope smoke other device",
      ttl_seconds: 120
    });
    const scoped = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({
      tenant_id: device.tenant_id,
      store_id: device.store_id,
      screen_group_id: device.screen_group_id,
      device_id: device.device_id,
      limit: "500"
    })}`);
    if (scoped.data.device_commands.some((item) => item.device_command_id === otherCommand.data.device_command.device_command_id)) {
      throw new Error("scope-filtered command list included another device command");
    }
    const wrongScope = await admin("GET", `/api/admin/device-commands?${new URLSearchParams({
      tenant_id: otherDevice.tenant_id,
      device_id: device.device_id,
      limit: "500"
    })}`);
    if (wrongScope.data.device_commands.length !== 0) {
      throw new Error("command list did not enforce conflicting tenant/device scope filters");
    }

    await admin("POST", `/api/admin/devices/${encodeURIComponent(device.device_id)}/token/revoke`, {
      reason: "device command smoke revoke"
    });
    await expectDeviceError("GET", "/api/device/commands", null, auth, 403, "revoked");

    const auditCount = auditLogCount();
    if (auditCount < 6) throw new Error(`expected device command audit logs, got ${auditCount}`);
    if (auditActionCount("device_command.stale") < 1) throw new Error("stale audit was not recorded");
    if (auditActionCount("device_command.force_cancel") < 1) throw new Error("force-cancel audit was not recorded");
    if (auditActionCount("device_command.purge") < 1) throw new Error("retention purge audit was not recorded");

    return {
      ok: true,
      base_url: baseUrl,
      denied_role: true,
      unknown_command_rejected: true,
      params_allowlist: true,
      runner_disabled: true,
      runner_dry_run: true,
      atomic_claim: true,
      claim_token_guard: true,
      bounded_result_guard: true,
      cancel_guard: true,
      expiry_guard: true,
      stale_claim_guard: true,
      force_cancel_guard: true,
      retention_purge: true,
      scope_filtering: true,
      revoked_token_guard: true,
      audit_log_count: auditCount
    };
  } finally {
    await stopServer();
  }
}

async function createDevice(suffix) {
  const deviceId = `DEV-CMD-${suffix}-${runId}`;
  const response = await admin("POST", "/api/admin/devices", {
    tenant_id: `TEN-CMD-${suffix}-${runId}`,
    tenant_name: "Command Smoke Tenant",
    store_id: `STO-CMD-${suffix}-${runId}`,
    store_name: "Command Smoke Store",
    location_id: `LOC-CMD-${suffix}-${runId}`,
    location_name: "Main",
    screen_group_id: `SG-CMD-${suffix}-${runId}`,
    screen_group_name: "Front",
    device_id: deviceId,
    device_name: "Command Smoke Player",
    release_channel: "stable"
  });
  return {
    device_id: deviceId,
    tenant_id: `TEN-CMD-${suffix}-${runId}`,
    store_id: `STO-CMD-${suffix}-${runId}`,
    screen_group_id: `SG-CMD-${suffix}-${runId}`,
    device_token: response.data.device_token
  };
}

function safeRoleName(role) {
  return String(role || "missing").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
}

async function startServer(role, prefix) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `misell-cloud-device-commands-${prefix}.`));
  dbPath = path.join(tmpDir, "misell-cloud.sqlite");
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
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
      MISELL_CLOUD_ADMIN_ROLE: role,
      MISELL_DEVICE_COMMAND_CLAIM_LEASE_SECONDS: "1",
      MISELL_DEVICE_COMMAND_RETENTION_DAYS: "1",
      MISELL_CLOUD_DATA_DIR: tmpDir,
      DB_PATH: dbPath,
      DEVICE_TOKEN_PEPPER: `device-command-${prefix}-pepper`
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
      await sleep(100);
    }
  }
  throw new Error("Timed out waiting for device command smoke server");
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
  dbPath = "";
  baseUrl = "";
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
  return expectError(method, requestPath, body, { authorization: adminAuth }, expectedStatus, expectedText);
}

async function expectDeviceError(method, requestPath, body, headers, expectedStatus, expectedText) {
  return expectError(method, requestPath, body, headers, expectedStatus, expectedText);
}

async function expectError(method, requestPath, body, headers, expectedStatus, expectedText) {
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
  if (response.status !== expectedStatus || !text.includes(expectedText)) {
    throw new Error(`${method} ${requestPath} expected ${expectedStatus}/${expectedText}, got ${response.status}: ${text}`);
  }
}

function auditLogCount() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action LIKE 'device_command.%'").get().count;
  } finally {
    db.close();
  }
}

function auditActionCount(action) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = ?").get(action).count;
  } finally {
    db.close();
  }
}

function setCommandFields(commandId, fields) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${safeSqlIdentifier(key)} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  const db = new Database(dbPath);
  try {
    db.prepare(`UPDATE device_commands SET ${assignments} WHERE device_command_id = ?`).run(...values, commandId);
  } finally {
    db.close();
  }
}

function safeSqlIdentifier(value) {
  const text = String(value || "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) throw new Error(`unsafe SQL identifier: ${text}`);
  return text;
}

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
