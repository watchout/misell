#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const args = parseArgs(process.argv.slice(2));
const assetsDir = path.resolve(args.assets_dir || process.env.ASSETS_DIR || path.join(__dirname, "..", "assets"));
const policy = readPolicy();
const content = policy.content || {};
const assets = Array.isArray(content.assets) ? content.assets : [];
const failures = [];
let checked = 0;

for (const asset of assets) {
  const required = asset.required !== false;
  if (!required) continue;
  checked += 1;
  verifyAsset(asset);
}

const result = {
  ok: failures.length === 0,
  checked,
  failed: failures.length,
  failures
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;

function verifyAsset(asset) {
  const assetId = cleanString(asset.asset_id) || "<missing>";
  const targetPath = cleanString(asset.target_path);
  const expectedSha = cleanString(asset.sha256).toLowerCase();
  const expectedSize = Number(asset.size);

  if (!targetPath) {
    fail(assetId, targetPath, "target_path is required");
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    fail(assetId, targetPath, "sha256 must be a 64 character hex digest");
    return;
  }
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
    fail(assetId, targetPath, "size must be a positive integer");
    return;
  }

  let localPath = "";
  try {
    localPath = localPathForTarget(targetPath);
  } catch (error) {
    fail(assetId, targetPath, error.message);
    return;
  }

  if (!fs.existsSync(localPath)) {
    fail(assetId, targetPath, "local asset file is missing");
    return;
  }

  const stat = fs.statSync(localPath);
  if (!stat.isFile()) {
    fail(assetId, targetPath, "local asset path is not a file");
    return;
  }
  if (stat.size !== expectedSize) {
    fail(assetId, targetPath, `local asset size mismatch: expected ${expectedSize}, got ${stat.size}`);
    return;
  }

  const actualSha = sha256File(localPath);
  if (actualSha !== expectedSha) {
    fail(assetId, targetPath, "local asset sha256 mismatch");
  }
}

function localPathForTarget(targetPath) {
  const target = cleanString(targetPath);
  let subdir = "";
  let filename = "";
  if (target.startsWith("/assets/images/")) {
    subdir = "images";
    filename = target.slice("/assets/images/".length);
  } else if (target.startsWith("/assets/videos/")) {
    subdir = "videos";
    filename = target.slice("/assets/videos/".length);
  } else {
    throw new Error("target_path must start with /assets/images/ or /assets/videos/");
  }
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..") || !/^[a-zA-Z0-9_.:-]+$/.test(filename)) {
    throw new Error("target_path must end with a safe filename");
  }
  const resolved = path.resolve(assetsDir, subdir, filename);
  if (resolved !== assetsDir && !resolved.startsWith(`${assetsDir}${path.sep}`)) {
    throw new Error("target_path resolves outside assets directory");
  }
  return resolved;
}

function fail(assetId, targetPath, message) {
  failures.push({
    asset_id: assetId,
    target_path: targetPath,
    message
  });
}

function readPolicy() {
  if (process.env.POLICY_JSON) return parseJson(process.env.POLICY_JSON);
  if (args.policy_file) return parseJson(fs.readFileSync(path.resolve(args.policy_file), "utf8"));
  return {};
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
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

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    throw new Error(`Could not parse content policy JSON: ${error.message}`);
  }
}

function cleanString(value) {
  return String(value || "").trim();
}
