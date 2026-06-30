"use strict";

// Contract helpers for #212 Studio Execution C1.
// This layer creates publish preflight and content-manifest-like draft evidence.
// It must not activate, publish, mutate active content manifests, schedules, Player, or devices.

const crypto = require("crypto");
const { canAssetEnterPublishCandidate } = require("./studio-provider-job-contract");

const PUBLISH_PREFLIGHT_VERSION = "studio-publish-preflight-c1-v1";
const CONTENT_MANIFEST_DRAFT_TRANSFORM_VERSION = "content-manifest-draft-transform-c1-v1";
const PUBLISH_PREFLIGHT_STATUSES = Object.freeze(["passed", "failed", "human_review_required"]);
const CONTENT_MANIFEST_DRAFT_TRANSFORM_STATUSES = Object.freeze(["draft_created", "failed_preflight", "aborted"]);
const STUDIO_CONTENT_TYPES = Object.freeze(["normal", "ad", "sponsor", "collaboration"]);
const STUDIO_PUBLISH_MODES = Object.freeze([
  "normal_self_publish",
  "ad_approval_required",
  "external_review_required",
  "blocked"
]);
const DOCS99_GATE_VERDICTS = Object.freeze(["not_applicable", "allow", "allow_with_conditions", "block", "human_review_required"]);
const C1_FORBIDDEN_KEYS = new Set([
  "activate",
  "activation",
  "active_content_manifest",
  "active_manifest",
  "approval_token",
  "content_manifest_id",
  "content_manifest_status",
  "content_manifest_mutation",
  "device_command",
  "device_id",
  "external_partner_token",
  "external_publish",
  "live_activation",
  "player_command",
  "publish",
  "publish_now",
  "rollback_activation",
  "schedule_activation",
  "schedule_id",
  "screen_slot_id"
]);

function assertStudioC1InputBoundary(input = {}) {
  const walk = (value, pathLabel = "") => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${pathLabel}[${index}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (C1_FORBIDDEN_KEYS.has(normalizedKey)) {
        throw new Error(`${pathLabel ? `${pathLabel}.` : ""}${key} is out of scope for Studio Execution C1`);
      }
      if ((normalizedKey === "status" || normalizedKey.endsWith("_status")) && stringValue(child) === "active") {
        throw new Error("active status mutation is out of scope for Studio Execution C1");
      }
      if ((normalizedKey === "mutation" || normalizedKey.endsWith("_mutation")) && Boolean(child)) {
        throw new Error("runtime mutation is out of scope for Studio Execution C1");
      }
      walk(child, pathLabel ? `${pathLabel}.${key}` : key);
    }
  };
  walk(input);
}

function normalizePublishPreflightInput(input = {}) {
  assertStudioC1InputBoundary(input);
  const contentType = normalizeEnum(input.content_type || input.contentType || "normal", STUDIO_CONTENT_TYPES, "content_type");
  const docs99GateVerdict = normalizeEnum(
    input.docs99_gate_verdict || input.docs99GateVerdict || defaultDocs99GateVerdict(contentType),
    DOCS99_GATE_VERDICTS,
    "docs99_gate_verdict"
  );
  const publishMode = normalizeEnum(
    input.publish_mode || input.publishMode || defaultPublishMode(contentType, docs99GateVerdict),
    STUDIO_PUBLISH_MODES,
    "publish_mode"
  );
  return {
    publish_preflight_id: cleanId(input.publish_preflight_id || input.publishPreflightId),
    render_manifest_id: cleanId(input.render_manifest_id || input.renderManifestId),
    content_type: contentType,
    publish_mode: publishMode,
    docs99_gate_ref: boundedString(input.docs99_gate_ref || input.docs99GateRef || input.legal_gate_ref || input.legalGateRef, 500),
    docs99_gate_verdict: docs99GateVerdict,
    approval_gate_ref: boundedString(input.approval_gate_ref || input.approvalGateRef || "", 500),
    created_by_actor_id: cleanId(input.created_by_actor_id || input.createdByActorId),
    request_reason: boundedString(input.request_reason || input.requestReason || input.reason || "", 1000),
    dry_run: true
  };
}

function buildPublishPreflightContract({ project = {}, scenes = [], renderManifest = {}, assetProvenance = [], input = {} } = {}) {
  const normalized = normalizePublishPreflightInput(input);
  const requiredAssetIds = renderManifestAssetIds(renderManifest);
  const checks = [];
  addCheck(checks, "tenant_store_screen_group_scope", scopeMatches(project, renderManifest, scenes, assetProvenance), {
    reason: "project, scenes, render manifest, and asset provenance must share tenant/store/screen_group scope",
    evidence_ref: "campaign_project/studio_render_manifest/asset_provenance"
  });
  addCheck(checks, "campaign_project_validated", projectValidated(project), {
    reason: "campaign_project must be validated before publish preflight",
    evidence_ref: "campaign_projects.status"
  });
  addCheck(checks, "active_scenes_valid", activeScenesValid(scenes), {
    reason: "all active scenes must be valid before publish preflight",
    evidence_ref: "campaign_project_scenes.validation_status"
  });
  addCheck(checks, "render_manifest_qa_passed", renderManifestQaPassed(renderManifest), {
    reason: "render_manifest must have qa_status=passed and an output_sha256",
    evidence_ref: "studio_render_manifests.qa_status/output_sha256"
  });
  addCheck(checks, "render_manifest_scope_link", renderManifestLinksProject(project, renderManifest), {
    reason: "render_manifest must belong to the campaign_project and current revision scope",
    evidence_ref: "studio_render_manifests.campaign_project_id"
  });
  addCheck(checks, "asset_provenance_publish_safe", assetProvenanceSafe(assetProvenance, requiredAssetIds), {
    reason: "render_manifest referenced asset provenance must be present and publish-candidate safe",
    evidence_ref: "asset_provenance"
  });
  addCheck(checks, "content_type_publish_mode_resolved", publishModeMatchesContentType(normalized), {
    reason: "content_type and publish_mode must be resolved deterministically",
    evidence_ref: "studio_publish_preflight.content_type/publish_mode"
  });
  addCheck(checks, "docs99_gate_fail_closed", docs99GateAllows(normalized), {
    reason: "ad/sponsor/collaboration content must not pass when docs99 gate blocks or needs human review",
    evidence_ref: normalized.docs99_gate_ref || "docs99_gate_verdict"
  });
  addCheck(checks, "dry_run_no_activation_boundary", dryRunBoundary(), {
    reason: "C1 is dry-run only and must not activate content_manifest, schedule, Player, or devices",
    evidence_ref: "c1_guard_flags"
  });

  const failedChecks = checks.filter((check) => check.result === "failed");
  const hasHumanReview = normalized.docs99_gate_verdict === "human_review_required";
  return {
    schema_version: "studio-publish-preflight/c1",
    preflight_version: PUBLISH_PREFLIGHT_VERSION,
    publish_preflight_id: normalized.publish_preflight_id,
    tenant_id: stringValue(project.tenant_id),
    store_id: stringValue(project.store_id),
    screen_group_id: stringValue(project.screen_group_id),
    campaign_project_id: stringValue(project.campaign_project_id),
    campaign_project_revision: revisionFromProject(project),
    render_manifest_id: stringValue(renderManifest.render_manifest_id),
    render_manifest_output_sha256: stringValue(renderManifest.output_sha256),
    required_asset_ids: requiredAssetIds,
    content_type: normalized.content_type,
    publish_mode: normalized.publish_mode,
    status: failedChecks.length === 0 ? "passed" : hasHumanReview ? "human_review_required" : "failed",
    checks,
    blocked_reasons: failedChecks.map((check) => check.check_id),
    docs99_gate_ref: normalized.docs99_gate_ref,
    docs99_gate_verdict: normalized.docs99_gate_verdict,
    approval_gate_ref: normalized.approval_gate_ref,
    request_reason: normalized.request_reason,
    created_by_actor_id: normalized.created_by_actor_id,
    no_active_content_manifest_mutation: true,
    no_content_manifest_activation: true,
    no_publish: true,
    no_player_device_mutation: true,
    no_schedule_activation: true,
    dry_run_only: true
  };
}

function buildContentManifestDraftTransform(preflight = {}, { project = {}, scenes = [], renderManifest = {}, draft_transform_id = "", draft_content_manifest_id = "" } = {}) {
  const activeScenes = scenes.filter((scene) => stringValue(scene.status) !== "deleted");
  const sceneDraftItems = activeScenes.map((scene, index) => ({
    item_draft_id: `item-${index + 1}`,
    campaign_project_scene_id: stringValue(scene.campaign_project_scene_id),
    scene_order: numberValue(scene.scene_order),
    duration_seconds: numberValue(scene.duration_seconds),
    headline: stringValue(scene.headline),
    body_text: stringValue(scene.body_text),
    cta_text: stringValue(scene.cta_text)
  }));
  const draft = {
    schema_version: "content-manifest-draft/c1",
    content_manifest_draft_transform_version: CONTENT_MANIFEST_DRAFT_TRANSFORM_VERSION,
    draft_content_manifest_id: stringValue(draft_content_manifest_id),
    status: "draft",
    tenant_id: stringValue(project.tenant_id),
    store_id: stringValue(project.store_id),
    screen_group_id: stringValue(project.screen_group_id),
    campaign_project_id: stringValue(project.campaign_project_id),
    campaign_project_revision: revisionFromProject(project),
    render_manifest_id: stringValue(renderManifest.render_manifest_id),
    render_manifest_output_sha256: stringValue(renderManifest.output_sha256),
    content_type: stringValue(preflight.content_type),
    publish_mode: stringValue(preflight.publish_mode),
    playlist_json: {
      schema_version: "playlist-draft/c1",
      items: sceneDraftItems
    },
    render_state_ref: {
      output_ref: stringValue(renderManifest.output_ref),
      output_sha256: stringValue(renderManifest.output_sha256),
      output_type: stringValue(renderManifest.output_type)
    },
    activation: {
      status: "not_requested",
      reason: "C1 dry-run evidence only"
    },
    no_active_content_manifest_mutation: true,
    no_content_manifest_activation: true,
    no_publish: true,
    no_player_device_mutation: true,
    no_schedule_activation: true
  };
  const errors = preflight.status === "passed" ? [] : (Array.isArray(preflight.blocked_reasons) ? preflight.blocked_reasons : []);
  return {
    schema_version: "content-manifest-draft-transform/c1",
    transform_version: CONTENT_MANIFEST_DRAFT_TRANSFORM_VERSION,
    draft_transform_id: stringValue(draft_transform_id),
    publish_preflight_id: stringValue(preflight.publish_preflight_id),
    tenant_id: stringValue(project.tenant_id),
    store_id: stringValue(project.store_id),
    screen_group_id: stringValue(project.screen_group_id),
    campaign_project_id: stringValue(project.campaign_project_id),
    campaign_project_revision: revisionFromProject(project),
    render_manifest_id: stringValue(renderManifest.render_manifest_id),
    draft_content_manifest_id: stringValue(draft_content_manifest_id),
    status: preflight.status === "passed" ? "draft_created" : "failed_preflight",
    transform_errors: errors,
    playlist_item_draft_ids: sceneDraftItems.map((item) => item.item_draft_id),
    schedule_draft_ids: [],
    qr_link_ids: [],
    content_manifest_draft: preflight.status === "passed" ? draft : null,
    content_manifest_draft_sha256: preflight.status === "passed" ? sha256Hex(stableStringify(draft)) : "",
    no_active_content_manifest_mutation: true,
    no_content_manifest_activation: true,
    no_publish: true,
    no_player_device_mutation: true,
    no_schedule_activation: true
  };
}

function validatePublishPreflightContract(preflight = {}) {
  const errors = [];
  if (!stringValue(preflight.tenant_id)) pushError(errors, "tenant_id", "required", "tenant_id is required");
  if (!stringValue(preflight.store_id)) pushError(errors, "store_id", "required", "store_id is required");
  if (!stringValue(preflight.screen_group_id)) pushError(errors, "screen_group_id", "required", "screen_group_id is required");
  if (!stringValue(preflight.campaign_project_id)) pushError(errors, "campaign_project_id", "required", "campaign_project_id is required");
  if (!stringValue(preflight.render_manifest_id)) pushError(errors, "render_manifest_id", "required", "render_manifest_id is required");
  if (!PUBLISH_PREFLIGHT_STATUSES.includes(stringValue(preflight.status))) pushError(errors, "status", "unsupported", "unsupported preflight status");
  if (!STUDIO_CONTENT_TYPES.includes(stringValue(preflight.content_type))) pushError(errors, "content_type", "unsupported", "unsupported content_type");
  if (!STUDIO_PUBLISH_MODES.includes(stringValue(preflight.publish_mode))) pushError(errors, "publish_mode", "unsupported", "unsupported publish_mode");
  if (!Array.isArray(preflight.checks) || preflight.checks.length === 0) pushError(errors, "checks", "required", "checks are required");
  for (const guard of [
    "no_active_content_manifest_mutation",
    "no_content_manifest_activation",
    "no_publish",
    "no_player_device_mutation",
    "no_schedule_activation",
    "dry_run_only"
  ]) {
    if (preflight[guard] !== true) pushError(errors, guard, "required", `${guard}=true is required`);
  }
  return { valid: errors.length === 0, errors };
}

function defaultDocs99GateVerdict(contentType) {
  return contentType === "normal" ? "not_applicable" : "human_review_required";
}

function defaultPublishMode(contentType, docs99GateVerdict) {
  if (docs99GateVerdict === "block" || docs99GateVerdict === "human_review_required") return "blocked";
  if (contentType === "ad" || contentType === "sponsor") return "ad_approval_required";
  if (contentType === "collaboration") return "external_review_required";
  return "normal_self_publish";
}

function scopeMatches(project, renderManifest, scenes, assetProvenance) {
  if (!sameScope(project, renderManifest) || stringValue(project.campaign_project_id) !== stringValue(renderManifest.campaign_project_id)) return false;
  for (const scene of scenes.filter((entry) => stringValue(entry.status) !== "deleted")) {
    if (!sameScope(project, scene) || stringValue(scene.campaign_project_id) !== stringValue(project.campaign_project_id)) return false;
  }
  for (const provenance of assetProvenance) {
    if (!sameScope(project, provenance)) return false;
    const provenanceProjectId = stringValue(provenance.campaign_project_id);
    if (provenanceProjectId && provenanceProjectId !== stringValue(project.campaign_project_id)) return false;
  }
  return true;
}

function sameScope(left, right) {
  return stringValue(left.tenant_id) === stringValue(right.tenant_id) &&
    stringValue(left.store_id) === stringValue(right.store_id) &&
    stringValue(left.screen_group_id) === stringValue(right.screen_group_id);
}

function projectValidated(project) {
  return stringValue(project.status) === "validated" && stringValue(project.validation_status) === "valid";
}

function activeScenesValid(scenes) {
  const active = scenes.filter((scene) => stringValue(scene.status) !== "deleted");
  if (active.length === 0) return false;
  return active.every((scene) => stringValue(scene.status) === "valid" && stringValue(scene.validation_status) === "valid");
}

function renderManifestQaPassed(renderManifest) {
  return stringValue(renderManifest.status) !== "deleted" &&
    stringValue(renderManifest.qa_status) === "passed" &&
    Boolean(stringValue(renderManifest.output_sha256));
}

function renderManifestLinksProject(project, renderManifest) {
  return stringValue(project.campaign_project_id) === stringValue(renderManifest.campaign_project_id) &&
    revisionFromProject(project) === numberValue(renderManifest.campaign_project_revision);
}

function assetProvenanceSafe(assetProvenance, requiredAssetIds) {
  const required = Array.isArray(requiredAssetIds) ? requiredAssetIds.filter(Boolean) : [];
  if (required.length === 0) return true;
  const byAssetId = new Map((Array.isArray(assetProvenance) ? assetProvenance : []).map((provenance) => [
    stringValue(provenance.asset_id),
    provenance
  ]));
  return required.every((assetId) => {
    const provenance = byAssetId.get(assetId);
    if (!provenance) return false;
    return canAssetEnterPublishCandidate({
    source_type: stringValue(provenance.source_type),
    license_status: stringValue(provenance.license_status),
    commercial_use_allowed: provenance.commercial_use_allowed === true || provenance.commercial_use_allowed === 1,
    rights_review_status: stringValue(provenance.rights_review_status)
    });
  });
}

function publishModeMatchesContentType(input) {
  if (input.docs99_gate_verdict === "block" || input.docs99_gate_verdict === "human_review_required") {
    return input.publish_mode === "blocked";
  }
  if (input.content_type === "normal") return input.publish_mode === "normal_self_publish";
  if (input.content_type === "ad" || input.content_type === "sponsor") return input.publish_mode === "ad_approval_required";
  if (input.content_type === "collaboration") return input.publish_mode === "external_review_required";
  return false;
}

function docs99GateAllows(input) {
  if (input.content_type === "normal") return input.docs99_gate_verdict === "not_applicable" || input.docs99_gate_verdict === "allow";
  return input.docs99_gate_verdict === "allow" || input.docs99_gate_verdict === "allow_with_conditions";
}

function dryRunBoundary() {
  return true;
}

function addCheck(checks, checkId, passed, options = {}) {
  checks.push({
    check_id: checkId,
    result: passed ? "passed" : "failed",
    reason: options.reason || "",
    evidence_ref: options.evidence_ref || ""
  });
}

function renderManifestAssetIds(renderManifest = {}) {
  return [...new Set([
    ...normalizeIdList(renderManifest.source_asset_ids),
    ...normalizeIdList(renderManifest.generated_asset_ids)
  ])];
}

function normalizeIdList(value) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => stringValue(entry)).filter(Boolean);
}

function revisionFromProject(project) {
  const explicitRevision = numberValue(project.campaign_project_revision || project.revision);
  if (explicitRevision > 0) return explicitRevision;
  const updatedAt = Date.parse(stringValue(project.updated_at));
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(stringValue(project.created_at));
  if (Number.isFinite(createdAt)) return createdAt;
  return numberValue(project.id) || 1;
}

function pushError(errors, field, code, message) {
  errors.push({ field, code, message, severity: "block" });
}

function normalizeEnum(value, allowed, field) {
  const normalized = stringValue(value);
  if (!allowed.includes(normalized)) throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  return normalized;
}

function cleanId(value) {
  return stringValue(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 160);
}

function boundedString(value, maxLength) {
  return stringValue(value).slice(0, maxLength);
}

function stringValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function numberValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.trunc(number);
}

function normalizeKey(key) {
  return stringValue(key).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

module.exports = {
  PUBLISH_PREFLIGHT_VERSION,
  CONTENT_MANIFEST_DRAFT_TRANSFORM_VERSION,
  PUBLISH_PREFLIGHT_STATUSES,
  CONTENT_MANIFEST_DRAFT_TRANSFORM_STATUSES,
  STUDIO_CONTENT_TYPES,
  STUDIO_PUBLISH_MODES,
  DOCS99_GATE_VERDICTS,
  assertStudioC1InputBoundary,
  normalizePublishPreflightInput,
  buildPublishPreflightContract,
  buildContentManifestDraftTransform,
  validatePublishPreflightContract
};
