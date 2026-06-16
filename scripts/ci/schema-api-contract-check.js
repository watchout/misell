#!/usr/bin/env node
"use strict";

const fs = require("fs");

const REQUIRED_CLOUD_ROUTES = [
  'app.post("/api/device/heartbeat", requireDeviceAuth',
  'app.get("/api/device/content-policy", requireDeviceAuth',
  'app.post("/api/device/content-result", requireDeviceAuth',
  'app.post("/api/device/asset-result", requireDeviceAuth',
  'app.post("/api/device/logs", requireDeviceAuth',
  'app.get("/api/admin/content-manifests", requireAdminAuth',
  'app.post("/api/admin/content-manifests", requireAdminAuth',
  'app.get("/api/admin/content-rollouts/:content_id", requireAdminAuth'
];
const REQUIRED_STUDIO_CONTRACT_MARKERS = [
  "const ROLES = Object.freeze",
  "const ROLE_ALIASES = Object.freeze",
  "const ACTION_MATRIX = Object.freeze",
  "function resolveTenantScope",
  "function authorizeTenantAction",
  "function mapLegacyScreenGroupToDisplayWall",
  "function buildManifestContract",
  "function evaluatePublishApproval",
  "function evaluateEmergencyPublish"
];
const REQUIRED_STUDIO_SCHEMA_MARKERS = [
  "CREATE TABLE IF NOT EXISTS screens",
  "CREATE TABLE IF NOT EXISTS screen_device_bindings",
  "CREATE TABLE IF NOT EXISTS content_approvals",
  "CREATE TABLE IF NOT EXISTS publish_history",
  "addColumnIfMissing(\"content_manifests\", \"tenant_id\"",
  "addColumnIfMissing(\"content_manifests\", \"display_wall_id\"",
  "addColumnIfMissing(\"content_manifests\", \"manifest_schema_version\"",
  "addColumnIfMissing(\"content_manifests\", \"manifest_version\"",
  "addColumnIfMissing(\"content_manifests\", \"content_hash\""
];

function main() {
  const errors = [];
  const cloudServer = readText("apps/cloud/server.js", errors);
  const studioContract = readText("apps/cloud/lib/studio-phase1-contract.js", errors);

  requireMarkers("apps/cloud/server.js", cloudServer, REQUIRED_CLOUD_ROUTES, errors);
  requireMarkers("apps/cloud/server.js", cloudServer, REQUIRED_STUDIO_SCHEMA_MARKERS, errors);
  requireMarkers("apps/cloud/lib/studio-phase1-contract.js", studioContract, REQUIRED_STUDIO_CONTRACT_MARKERS, errors);

  if (cloudServer && !/manifest_version/.test(cloudServer)) {
    errors.push("apps/cloud/server.js content policy must expose manifest_version");
  }
  if (cloudServer && !/content_hash/.test(cloudServer)) {
    errors.push("apps/cloud/server.js content policy must expose content_hash");
  }

  if (errors.length) fail(errors);
  console.log("Schema/API contract check passed.");
}

function readText(file, errors) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    errors.push(`${file} is missing or unreadable: ${error.message}`);
    return "";
  }
}

function requireMarkers(file, text, markers, errors) {
  if (!text) return;
  for (const marker of markers) {
    if (!text.includes(marker)) errors.push(`${file} is missing contract marker: ${marker}`);
  }
}

function fail(errors) {
  console.error("Schema/API contract check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

main();
