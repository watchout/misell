"use strict";

const crypto = require("crypto");

// Canonical domain vocabulary is defined by #152 and docs/91 in PR #150:
// Tenant -> Store -> ScreenGroup -> Device.
// In this PR, site_id and display_wall_id are compatibility aliases only:
// - site_id aliases store_id
// - display_wall_id aliases screen_group_id
// - screen_id represents a ScreenSlot scoped under ScreenGroup
// Keep these aliases at the boundary and prefer canonical IDs in new specs/APIs.

const ROLES = Object.freeze({
  MISELL_OWNER: "misell_owner",
  MISELL_OPERATOR: "misell_operator",
  DEVICE_OPS: "device_ops",
  CUSTOMER_ADMIN: "customer_admin",
  CUSTOMER_EDITOR: "customer_editor",
  CUSTOMER_VIEWER: "customer_viewer",
  ADVERTISER: "advertiser"
});

const ROLE_ALIASES = Object.freeze({
  store_admin: ROLES.CUSTOMER_ADMIN,
  store_viewer: ROLES.CUSTOMER_VIEWER
});

const ACTIONS = Object.freeze({
  ALL_TENANT_VISIBILITY: "all_tenant_visibility",
  ASSET_UPLOAD_DELETE: "asset_upload_delete",
  LAYOUT_SCHEDULE_EDIT: "layout_schedule_edit",
  PREVIEW: "preview",
  NORMAL_SELF_PUBLISH: "normal_self_publish",
  AD_APPROVAL_REQUEST: "ad_approval_request",
  AD_APPROVAL_DECISION: "ad_approval_decision",
  EMERGENCY_STOP: "emergency_stop",
  DEVICE_STATUS_OPS: "device_status_ops"
});

const CONTENT_TYPES = Object.freeze(["normal", "ad", "sponsor", "emergency"]);
const APPROVAL_STATUSES = Object.freeze([
  "not_required",
  "draft",
  "pending",
  "approved",
  "rejected",
  "revoked",
  "expired"
]);
const APPROVAL_SUBJECT_TYPES = Object.freeze(["asset", "layout", "playlist_item", "manifest_item"]);
const SCREEN_POSITIONS = Object.freeze(["left", "center", "right"]);

const ACTION_MATRIX = Object.freeze({
  [ROLES.MISELL_OWNER]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "all",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "all",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "all",
    [ACTIONS.PREVIEW]: "all",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "all",
    [ACTIONS.AD_APPROVAL_REQUEST]: "all",
    [ACTIONS.AD_APPROVAL_DECISION]: "yes",
    [ACTIONS.EMERGENCY_STOP]: "yes",
    [ACTIONS.DEVICE_STATUS_OPS]: "all"
  },
  [ROLES.MISELL_OPERATOR]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "all",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "all",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "all",
    [ACTIONS.PREVIEW]: "all",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "all",
    [ACTIONS.AD_APPROVAL_REQUEST]: "all",
    [ACTIONS.AD_APPROVAL_DECISION]: "yes",
    [ACTIONS.EMERGENCY_STOP]: "yes",
    [ACTIONS.DEVICE_STATUS_OPS]: "all"
  },
  [ROLES.DEVICE_OPS]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "device-only",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "no",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "no",
    [ACTIONS.PREVIEW]: "device preview",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "no",
    [ACTIONS.AD_APPROVAL_REQUEST]: "no",
    [ACTIONS.AD_APPROVAL_DECISION]: "no",
    [ACTIONS.EMERGENCY_STOP]: "device-safe-stop only",
    [ACTIONS.DEVICE_STATUS_OPS]: "assigned/all"
  },
  [ROLES.CUSTOMER_ADMIN]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "no",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "tenant",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "tenant",
    [ACTIONS.PREVIEW]: "tenant",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "tenant",
    [ACTIONS.AD_APPROVAL_REQUEST]: "tenant",
    [ACTIONS.AD_APPROVAL_DECISION]: "no",
    [ACTIONS.EMERGENCY_STOP]: "request only",
    [ACTIONS.DEVICE_STATUS_OPS]: "tenant read"
  },
  [ROLES.CUSTOMER_EDITOR]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "no",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "tenant",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "tenant",
    [ACTIONS.PREVIEW]: "tenant",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "tenant",
    [ACTIONS.AD_APPROVAL_REQUEST]: "tenant",
    [ACTIONS.AD_APPROVAL_DECISION]: "no",
    [ACTIONS.EMERGENCY_STOP]: "no",
    [ACTIONS.DEVICE_STATUS_OPS]: "tenant read"
  },
  [ROLES.CUSTOMER_VIEWER]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "no",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "no",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "no",
    [ACTIONS.PREVIEW]: "tenant",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "no",
    [ACTIONS.AD_APPROVAL_REQUEST]: "no",
    [ACTIONS.AD_APPROVAL_DECISION]: "no",
    [ACTIONS.EMERGENCY_STOP]: "no",
    [ACTIONS.DEVICE_STATUS_OPS]: "tenant read"
  },
  [ROLES.ADVERTISER]: {
    [ACTIONS.ALL_TENANT_VISIBILITY]: "no",
    [ACTIONS.ASSET_UPLOAD_DELETE]: "own ad asset",
    [ACTIONS.LAYOUT_SCHEDULE_EDIT]: "no",
    [ACTIONS.PREVIEW]: "own campaign preview",
    [ACTIONS.NORMAL_SELF_PUBLISH]: "no",
    [ACTIONS.AD_APPROVAL_REQUEST]: "own",
    [ACTIONS.AD_APPROVAL_DECISION]: "no",
    [ACTIONS.EMERGENCY_STOP]: "no",
    [ACTIONS.DEVICE_STATUS_OPS]: "no"
  }
});

function normalizeRole(role) {
  const value = String(role || "").trim();
  return ROLE_ALIASES[value] || value;
}

function getActionDecision(role, action) {
  const normalizedRole = normalizeRole(role);
  const value = ACTION_MATRIX[normalizedRole]?.[action] || "no";
  return {
    role: normalizedRole,
    action,
    scope: value,
    allowed: value !== "no"
  };
}

function authorizeTenantAction(auth, action, requestedTenantId = "") {
  const decision = getActionDecision(auth?.role, action);
  if (!decision.allowed) {
    return { ok: false, role: decision.role, action, reason: "action_denied" };
  }
  const scope = resolveTenantScope({ ...auth, role: decision.role }, requestedTenantId);
  if (!scope.ok && decision.scope !== "all") {
    return { ok: false, role: decision.role, action, reason: scope.reason || "tenant_scope_denied" };
  }
  return {
    ok: true,
    role: decision.role,
    action,
    permission_scope: decision.scope,
    tenant_scope: scope.scope,
    tenant_ids: scope.tenant_ids
  };
}

function resolveTenantScope(auth, requestedTenantId = "") {
  const role = normalizeRole(auth?.role);
  const requested = String(requestedTenantId || "").trim();
  if (!ACTION_MATRIX[role]) {
    return { ok: false, role, reason: "unknown_role", tenant_ids: [] };
  }
  if (role === ROLES.MISELL_OWNER || role === ROLES.MISELL_OPERATOR) {
    return { ok: true, role, scope: "all", tenant_ids: requested ? [requested] : [] };
  }

  const allowedTenants = new Set((auth?.tenant_ids || auth?.tenantIds || []).map((item) => String(item || "").trim()).filter(Boolean));
  if (allowedTenants.size === 0 && auth?.tenant_id) {
    allowedTenants.add(String(auth.tenant_id).trim());
  }
  if (requested && !allowedTenants.has(requested)) {
    return { ok: false, role, scope: "tenant", reason: "cross_tenant_denied", tenant_ids: Array.from(allowedTenants) };
  }
  return {
    ok: allowedTenants.size > 0,
    role,
    scope: role === ROLES.DEVICE_OPS ? "device" : "tenant",
    reason: allowedTenants.size > 0 ? "" : "missing_tenant_membership",
    tenant_ids: requested ? [requested] : Array.from(allowedTenants)
  };
}

function mapLegacyScreenGroupToDisplayWall(screenGroup, devices) {
  const group = screenGroup || {};
  const groupId = cleanId(group.screen_group_id || group.display_wall_id);
  if (!groupId) throw new Error("screen_group_id is required");
  const orderedDevices = (devices || []).map((device) => ({
    device,
    position: inferScreenPosition(device)
  }));

  if (orderedDevices.length !== 3) {
    throw new Error("legacy screen_group fixture must include exactly 3 devices");
  }
  if (orderedDevices.some((entry) => !entry.position)) {
    throw new Error("screen position cannot be inferred; explicit fixture metadata is required");
  }

  const seen = new Set();
  for (const entry of orderedDevices) {
    if (seen.has(entry.position)) throw new Error(`duplicate screen position: ${entry.position}`);
    seen.add(entry.position);
  }
  for (const position of SCREEN_POSITIONS) {
    if (!seen.has(position)) throw new Error(`missing screen position: ${position}`);
  }

  orderedDevices.sort((left, right) => SCREEN_POSITIONS.indexOf(left.position) - SCREEN_POSITIONS.indexOf(right.position));

  const storeId = cleanId(group.store_id || group.site_id);
  const screenSlots = orderedDevices.map((entry, index) => ({
    screen_slot_id: cleanId(entry.device.screen_slot_id || entry.device.screen_id || `${groupId}-${entry.position}`),
    screen_id: cleanId(entry.device.screen_id || entry.device.screen_slot_id || `${groupId}-${entry.position}`),
    store_id: storeId,
    site_id: storeId,
    screen_group_id: groupId,
    display_wall_id: groupId,
    device_id: cleanId(entry.device.device_id),
    position: entry.position,
    display_order: index + 1
  }));

  return {
    tenant_id: cleanId(group.tenant_id),
    store_id: storeId,
    site_id: storeId,
    screen_group_id: groupId,
    display_wall_id: groupId,
    screen_slots: screenSlots,
    screens: screenSlots
  };
}

function inferScreenPosition(device) {
  const raw = device || {};
  const explicit = cleanString(raw.screen_position || raw.display_position || raw.position || raw.slot);
  if (SCREEN_POSITIONS.includes(explicit)) return explicit;
  const numeric = Number(raw.screen_index || raw.display_index || raw.display_order || raw.order);
  if (numeric === 1) return "left";
  if (numeric === 2) return "center";
  if (numeric === 3) return "right";
  return "";
}

function buildManifestContentHash(manifest) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(manifest || {}))
    .digest("hex");
}

function buildManifestContract(input) {
  const manifest = input || {};
  const storeId = cleanId(manifest.store_id || manifest.site_id);
  const screenGroupId = cleanId(manifest.screen_group_id || manifest.display_wall_id);
  const screenSlotId = cleanId(manifest.screen_slot_id || manifest.screen_id);
  return {
    tenant_id: cleanId(manifest.tenant_id),
    store_id: storeId,
    site_id: storeId,
    screen_group_id: screenGroupId,
    display_wall_id: screenGroupId,
    screen_slot_id: screenSlotId,
    screen_id: screenSlotId,
    manifest_schema_version: Number(manifest.manifest_schema_version || 1),
    manifest_version: Number(manifest.manifest_version || 1),
    content_hash: cleanString(manifest.content_hash) || buildManifestContentHash({
      tenant_id: manifest.tenant_id,
      store_id: manifest.store_id || manifest.site_id,
      screen_group_id: manifest.screen_group_id || manifest.display_wall_id,
      screen_slot_id: manifest.screen_slot_id || manifest.screen_id,
      playlist: manifest.playlist || null,
      assets: manifest.assets || []
    })
  };
}

function evaluatePublishApproval({
  content_type: contentType,
  tenant_id: tenantId,
  store_id: storeId,
  site_id: siteId,
  screen_group_id: screenGroupId,
  display_wall_id: displayWallId,
  subject_type: subjectType,
  subject_id: subjectId,
  subject_hash: subjectHash,
  content_hash: contentHash,
  approvals,
  now = new Date()
}) {
  const type = cleanString(contentType || "normal");
  if (!CONTENT_TYPES.includes(type)) return blocked("unknown_content_type");
  const match = findApproval({ subjectType, subjectId, approvals });
  if (!match) return blocked("approval_missing");
  if (cleanString(match.content_type) && cleanString(match.content_type) !== type) return blocked("approval_content_type_mismatch");
  if (tenantId && cleanString(match.tenant_id) !== cleanString(tenantId)) return blocked("approval_tenant_mismatch");

  const requestedStoreId = cleanString(storeId || siteId);
  const approvalStoreId = cleanString(match.store_id || match.site_id);
  if (requestedStoreId && approvalStoreId !== requestedStoreId) return blocked("approval_store_mismatch");

  const requestedScreenGroupId = cleanString(screenGroupId || displayWallId);
  const approvalScreenGroupId = cleanString(match.screen_group_id || match.display_wall_id);
  if (requestedScreenGroupId && approvalScreenGroupId !== requestedScreenGroupId) return blocked("approval_screen_group_mismatch");

  if (subjectHash && cleanString(match.subject_hash) !== cleanString(subjectHash)) return blocked("approval_hash_mismatch");
  if (contentHash && cleanString(match.content_hash) !== cleanString(contentHash)) return blocked("approval_content_hash_mismatch");

  const status = cleanString(match.approval_status);
  if (status === "approved" && isExpired(match.expires_at, now)) return blocked("approval_expired");
  if (type === "normal") return status === "not_required" ? allowed(match) : blocked(`normal_requires_not_required:${status}`);
  if (type === "ad" || type === "sponsor") return status === "approved" ? allowed(match) : blocked(`approval_not_approved:${status || "missing"}`);
  if (type === "emergency") return blocked("emergency_requires_operator_path");
  return blocked("approval_blocked");
}

function evaluateEmergencyPublish({ actor_role: actorRole, actor_id: actorId, audit_reason: auditReason, timestamp }) {
  const role = normalizeRole(actorRole);
  const canOverride = role === ROLES.MISELL_OWNER || role === ROLES.MISELL_OPERATOR;
  if (!canOverride) return blocked("operator_role_required");
  if (!cleanString(actorId)) return blocked("actor_id_required");
  if (!cleanString(auditReason)) return blocked("audit_reason_required");
  if (!validTimestamp(timestamp)) return blocked("timestamp_required");
  return { allowed: true, reason: "", role, actor_id: cleanString(actorId), timestamp: new Date(timestamp).toISOString() };
}

function findApproval({ subjectType, subjectId, approvals }) {
  const normalizedType = cleanString(subjectType);
  const normalizedId = cleanString(subjectId);
  return (approvals || []).find((approval) => (
    cleanString(approval.subject_type) === normalizedType &&
    cleanString(approval.subject_id) === normalizedId
  ));
}

function allowed(approval) {
  return { allowed: true, reason: "", approval };
}

function blocked(reason) {
  return { allowed: false, reason };
}

function isExpired(expiresAt, now) {
  const value = cleanString(expiresAt);
  if (!value) return false;
  const expiry = Date.parse(value);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(current)) return true;
  return expiry <= current;
}

function validTimestamp(value) {
  return Number.isFinite(Date.parse(cleanString(value)));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

module.exports = {
  ROLES,
  ROLE_ALIASES,
  ACTIONS,
  ACTION_MATRIX,
  CONTENT_TYPES,
  APPROVAL_STATUSES,
  APPROVAL_SUBJECT_TYPES,
  SCREEN_POSITIONS,
  normalizeRole,
  getActionDecision,
  authorizeTenantAction,
  resolveTenantScope,
  mapLegacyScreenGroupToDisplayWall,
  inferScreenPosition,
  buildManifestContentHash,
  buildManifestContract,
  evaluatePublishApproval,
  evaluateEmergencyPublish
};
