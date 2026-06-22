#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const APP_DIR = path.resolve(__dirname, "..");

loadEnvFile();

const args = parseArgs(process.argv.slice(2));
const commandsUrl = commandEndpointUrl();
const deviceToken = process.env.MISELL_DEVICE_TOKEN || process.env.DEVICE_TOKEN || "";
const runnerEnabled = truthy(args.enable || process.env.MISELL_COMMAND_RUNNER_ENABLED);
const dryRun = truthy(args.dry_run || process.env.MISELL_COMMAND_RUNNER_DRY_RUN);
const limit = boundedInteger(args.limit || process.env.MISELL_COMMAND_SYNC_LIMIT, 5, 1, 20);
const httpTimeoutMs = boundedInteger(args.http_timeout_ms || process.env.MISELL_COMMAND_HTTP_TIMEOUT_MS, 15000, 1000, 120000);
const commandTimeoutMs = boundedInteger(args.command_timeout_ms || process.env.MISELL_COMMAND_EXEC_TIMEOUT_MS, 60000, 1000, 600000);
const runnerId = cleanString(process.env.MISELL_COMMAND_RUNNER_ID || `${os.hostname()}:sync-commands`).slice(0, 120);

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (!runnerEnabled) {
    print({ ok: true, skipped: true, reason: "MISELL_COMMAND_RUNNER_ENABLED is not set to 1" });
    return;
  }
  if (!commandsUrl) {
    print({ ok: true, skipped: true, reason: "MISELL_DEVICE_COMMANDS_URL is empty and could not be derived" });
    return;
  }
  if (!deviceToken) {
    throw new Error("MISELL_DEVICE_TOKEN is required for command sync");
  }

  const pending = await requestJson("GET", `${commandsUrl}?${new URLSearchParams({ limit: String(limit) })}`);
  const commands = Array.isArray(pending.commands) ? pending.commands : [];
  let claimed = 0;
  let succeeded = 0;
  let failed = 0;
  const results = [];

  for (const command of commands) {
    const commandId = cleanString(command.device_command_id);
    if (!commandId) continue;
    let claim = null;
    try {
      const claimResponse = await requestJson("POST", commandUrl(commandId, "claim"), { runner_id: runnerId });
      claim = claimResponse.device_command;
      claimed += 1;
    } catch (error) {
      failed += 1;
      results.push({ device_command_id: commandId, status: "claim_failed", error: error.message });
      continue;
    }

    const startedAt = new Date().toISOString();
    const execution = await executeDeviceCommand(claim).catch((error) => ({
      status: "failed",
      exit_code: error.exit_code ?? 1,
      summary: error.message || "command execution failed"
    }));
    const resultPayload = {
      claim_token: claim.claim_token,
      status: execution.status,
      exit_code: execution.exit_code,
      summary: boundedSummary(execution.summary),
      runner_id: runnerId,
      started_at: startedAt
    };

    try {
      await requestJson("POST", commandUrl(commandId, "result"), resultPayload);
      if (execution.status === "succeeded") succeeded += 1;
      else failed += 1;
      results.push({ device_command_id: commandId, status: execution.status });
    } catch (error) {
      failed += 1;
      results.push({ device_command_id: commandId, status: "result_failed", error: error.message });
    }
  }

  print({
    ok: failed === 0,
    commands_url: commandsUrl,
    runner_id: runnerId,
    dry_run: dryRun,
    pending: commands.length,
    claimed,
    succeeded,
    failed,
    results
  });
  if (failed > 0) process.exitCode = 1;
}

async function executeDeviceCommand(command) {
  const commandType = cleanString(command.command_type);
  if (dryRun) {
    return {
      status: "succeeded",
      exit_code: 0,
      summary: `dry-run accepted ${commandType}`
    };
  }

  if (commandType === "reload_player_content") {
    await requestReload();
    return { status: "succeeded", exit_code: 0, summary: "local player reload requested" };
  }
  if (commandType === "sync_content_now") {
    await spawnFixed(path.join(APP_DIR, "scripts", "sync-content.sh"), []);
    return { status: "succeeded", exit_code: 0, summary: "content sync completed" };
  }
  if (commandType === "collect_logs") {
    await spawnFixed(path.join(APP_DIR, "scripts", "collect-device-evidence.sh"), [
      "--upload",
      "--label",
      "remote-command",
      "--reason",
      "device command"
    ]);
    return { status: "succeeded", exit_code: 0, summary: "bounded evidence collection completed" };
  }
  if (commandType === "restart_player") {
    await spawnFixed("systemctl", ["--user", "restart", "misell-player.service"]);
    return { status: "succeeded", exit_code: 0, summary: "misell-player.service restart requested" };
  }
  if (commandType === "restart_kiosk") {
    await spawnFixed("systemctl", ["--user", "restart", "misell-kiosk.service"]);
    return { status: "succeeded", exit_code: 0, summary: "misell-kiosk.service restart requested" };
  }

  const error = new Error(`Unsupported device command: ${commandType}`);
  error.exit_code = 64;
  throw error;
}

function commandUrl(commandId, action) {
  return `${commandsUrl.replace(/\/+$/, "")}/${encodeURIComponent(commandId)}/${action}`;
}

async function requestJson(method, url, body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${deviceToken}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { text };
    }
    if (!response.ok) {
      throw new Error(`${method} ${url} -> ${response.status}: ${text.slice(0, 500)}`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${method} ${url} timed out after ${httpTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestReload() {
  const port = process.env.PORT || "3000";
  const reloadUrl = process.env.MISELL_PLAYER_RELOAD_URL || `http://127.0.0.1:${port}/api/reload`;
  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  const headers = {};
  if (adminUser && adminPassword) {
    headers.authorization = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);
  try {
    const response = await fetch(reloadUrl, {
      method: "POST",
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`local reload failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function spawnFixed(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: APP_DIR,
      env: process.env,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"]
    });
    let settled = false;
    let killTimer = null;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2000);
    }, commandTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    };
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal) {
        const error = new Error(`${path.basename(command)} terminated by ${signal}`);
        error.exit_code = 124;
        reject(error);
        return;
      }
      if (code !== 0) {
        const error = new Error(`${path.basename(command)} exited with ${code}`);
        error.exit_code = code ?? 1;
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function commandEndpointUrl() {
  if (process.env.MISELL_DEVICE_COMMANDS_URL) return process.env.MISELL_DEVICE_COMMANDS_URL;
  if (process.env.MISELL_COMMANDS_URL) return process.env.MISELL_COMMANDS_URL;
  const heartbeatUrl = process.env.MISELL_HEARTBEAT_URL || "";
  if (heartbeatUrl.endsWith("/api/device/heartbeat")) {
    return `${heartbeatUrl.slice(0, -"/api/device/heartbeat".length)}/api/device/commands`;
  }
  return "";
}

function boundedSummary(value) {
  const summary = cleanString(value || "");
  return summary.length > 1000 ? `${summary.slice(0, 1000)}...` : summary;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function truthy(value) {
  if (value === true) return true;
  const text = cleanString(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function loadEnvFile() {
  const envFile = process.env.MISELL_ENV_FILE || path.join(os.homedir(), ".config", "misell-player", "env");
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
