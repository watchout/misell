"use strict";

// Contract helpers for #213 Studio Execution D1.
// This layer records measurement/QR draft evidence only.
// It must not publish, activate content manifests, mutate Player/devices, call providers,
// or fabricate ROI/ROAS/lift/incremental outcomes.

const MEASUREMENT_BINDING_VERSION = "studio-measurement-binding-d1-v1";
const QR_BINDING_VERSION = "studio-qr-binding-d1-v1";

const CONTENT_LAYERS = Object.freeze(["always_on", "campaign_refresh", "realtime_context"]);
const ITEM_TYPES = Object.freeze(["content", "ad", "sponsor", "collaboration"]);
const EXPECTED_ACTIONS = Object.freeze([
  "qr_scan",
  "coupon_issue",
  "counter_order",
  "inquiry",
  "visit_guidance",
  "awareness",
  "other"
]);
const DURATION_CLASSES = Object.freeze([
  "glance_3s",
  "visual_5_7s",
  "text_7_10s",
  "standard_8_15s",
  "detail_15_20s"
]);
const MEASUREMENT_LABELS = Object.freeze(["measured", "estimated", "incremental"]);
const DATA_SOURCE_CLASSES = Object.freeze([
  "misell_playlog",
  "misell_qr",
  "misell_coupon",
  "misell_order",
  "advertiser_reported",
  "external_estimate",
  "baseline_model"
]);
const MISELL_MEASURED_DATA_SOURCES = new Set([
  "misell_playlog",
  "misell_qr",
  "misell_coupon",
  "misell_order"
]);
const MEASUREMENT_BINDING_STATUSES = Object.freeze(["draft", "valid", "invalid", "deleted"]);
const QR_BINDING_STATUSES = Object.freeze(["draft", "active", "expired", "revoked", "deleted"]);
const QR_ATTRIBUTION_CLAIMS = Object.freeze(["none", "measured_response_only"]);

const D1_FORBIDDEN_KEYS = new Set([
  "active_content_manifest",
  "ad_network",
  "billing",
  "camera",
  "content_manifest",
  "content_manifest_id",
  "credit_ledger",
  "device_command",
  "external_ai",
  "external_ai_provider",
  "external_data_ingestion",
  "guarantee",
  "incremental_roi",
  "lift",
  "player_command",
  "pos",
  "provider_job",
  "publish",
  "publish_now",
  "published_at",
  "roas",
  "roi",
  "schedule_activation"
]);

function assertStudioD1InputBoundary(input = {}) {
  const walk = (value, pathLabel = "") => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${pathLabel}[${index}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (D1_FORBIDDEN_KEYS.has(normalizedKey)) {
        throw new Error(`${pathLabel ? `${pathLabel}.` : ""}${key} is out of scope for Studio Execution D1`);
      }
      if (normalizedKey.endsWith("_claim") && stringValue(child) && !["none", "measured_response_only"].includes(stringValue(child))) {
        throw new Error(`${pathLabel ? `${pathLabel}.` : ""}${key} must not claim ROI, sale, visit, ROAS, lift, or incremental effect in D1`);
      }
      walk(child, pathLabel ? `${pathLabel}.${key}` : key);
    }
  };
  walk(input);
}

function normalizeMeasurementBindingInput(input = {}, defaults = {}) {
  assertStudioD1InputBoundary(input);
  const expectedAction = enumValue(input.expected_action || input.expectedAction || defaults.expected_action || "qr_scan", EXPECTED_ACTIONS, "expected_action");
  const dataSourceClass = enumValue(
    input.data_source_class || input.dataSourceClass || defaults.data_source_class || defaultDataSourceForExpectedAction(expectedAction),
    DATA_SOURCE_CLASSES,
    "data_source_class"
  );
  const measurementLabel = enumValue(
    input.measurement_label || input.measurementLabel || defaults.measurement_label || defaultMeasurementLabelForDataSource(dataSourceClass),
    MEASUREMENT_LABELS,
    "measurement_label"
  );
  return {
    measurement_binding_id: cleanId(input.measurement_binding_id || input.measurementBindingId || defaults.measurement_binding_id),
    tenant_id: cleanId(input.tenant_id || input.tenantId || defaults.tenant_id),
    store_id: cleanId(input.store_id || input.storeId || defaults.store_id),
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId || defaults.screen_group_id),
    campaign_project_id: cleanId(input.campaign_project_id || input.campaignProjectId || defaults.campaign_project_id),
    campaign_project_revision: positiveInteger(input.campaign_project_revision || input.campaignProjectRevision || defaults.campaign_project_revision, 1),
    campaign_project_scene_id: cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId || input.scene_id || input.sceneId || defaults.campaign_project_scene_id),
    render_manifest_id: cleanId(input.render_manifest_id || input.renderManifestId || defaults.render_manifest_id),
    content_layer: enumValue(input.content_layer || input.contentLayer || defaults.content_layer || "campaign_refresh", CONTENT_LAYERS, "content_layer"),
    item_type: enumValue(input.item_type || input.itemType || defaults.item_type || "content", ITEM_TYPES, "item_type"),
    measurement_goal: boundedString(input.measurement_goal || input.measurementGoal || defaults.measurement_goal, 300),
    expected_action: expectedAction,
    campaign_id: cleanId(input.campaign_id || input.campaignId || defaults.campaign_id),
    media_campaign_id: cleanId(input.media_campaign_id || input.mediaCampaignId || defaults.media_campaign_id),
    creative_id: cleanId(input.creative_id || input.creativeId || defaults.creative_id),
    ad_slot_id: cleanId(input.ad_slot_id || input.adSlotId || defaults.ad_slot_id),
    qr_link_id: cleanId(input.qr_link_id || input.qrLinkId || defaults.qr_link_id),
    variation_group: cleanId(input.variation_group || input.variationGroup || defaults.variation_group),
    improvement_reason: boundedString(input.improvement_reason || input.improvementReason || defaults.improvement_reason, 1000),
    previous_scene_id: cleanId(input.previous_scene_id || input.previousSceneId || defaults.previous_scene_id),
    duration_class: enumValue(input.duration_class || input.durationClass || defaults.duration_class || "standard_8_15s", DURATION_CLASSES, "duration_class"),
    measurement_label: measurementLabel,
    data_source_class: dataSourceClass,
    baseline_evidence_ref: boundedString(input.baseline_evidence_ref || input.baselineEvidenceRef || defaults.baseline_evidence_ref, 500),
    holdout_evidence_ref: boundedString(input.holdout_evidence_ref || input.holdoutEvidenceRef || defaults.holdout_evidence_ref, 500),
    next_review_at: boundedString(input.next_review_at || input.nextReviewAt || defaults.next_review_at, 80),
    status: enumValue(input.status || defaults.status || "draft", MEASUREMENT_BINDING_STATUSES, "status")
  };
}

function validateMeasurementBindingContract(binding = {}, context = {}) {
  const errors = [];
  const checks = [];
  requireText(errors, binding.tenant_id, "tenant_id");
  requireText(errors, binding.store_id, "store_id");
  requireText(errors, binding.screen_group_id, "screen_group_id");
  requireText(errors, binding.campaign_project_id, "campaign_project_id");
  requireText(errors, binding.measurement_goal, "measurement_goal");
  requireText(errors, binding.expected_action, "expected_action");
  requireText(errors, binding.creative_id, "creative_id");
  requireEnum(errors, binding.content_layer, CONTENT_LAYERS, "content_layer");
  requireEnum(errors, binding.item_type, ITEM_TYPES, "item_type");
  requireEnum(errors, binding.expected_action, EXPECTED_ACTIONS, "expected_action");
  requireEnum(errors, binding.duration_class, DURATION_CLASSES, "duration_class");
  requireEnum(errors, binding.measurement_label, MEASUREMENT_LABELS, "measurement_label");
  requireEnum(errors, binding.data_source_class, DATA_SOURCE_CLASSES, "data_source_class");

  addCheck(checks, "scope_required", hasText(binding.tenant_id) && hasText(binding.store_id) && hasText(binding.screen_group_id));
  addCheck(checks, "creative_traceable", hasText(binding.creative_id));
  addCheck(checks, "no_incremental_without_evidence", incrementalHasEvidence(binding));
  addCheck(checks, "measured_source_guard", measuredSourceGuard(binding));
  addCheck(checks, "qr_expected_action_has_qr_link", binding.expected_action !== "qr_scan" || hasText(binding.qr_link_id));
  addCheck(checks, "qr_scan_is_response_only", stringValue(binding.attribution_claim || "measured_response_only") === "measured_response_only");
  addCheck(checks, "no_roi_fabrication", true);
  addCheck(checks, "no_content_manifest_creation", true);
  addCheck(checks, "no_publish", true);

  if (!incrementalHasEvidence(binding)) {
    errors.push(errorEntry("measurement_label", "incremental_requires_baseline_or_holdout", "incremental measurement requires accepted baseline or holdout evidence"));
  }
  if (!measuredSourceGuard(binding)) {
    errors.push(errorEntry("data_source_class", "measured_source_mismatch", "measured values must come from Misell playlog, QR, coupon, or order rails"));
  }
  if (binding.expected_action === "qr_scan" && !hasText(binding.qr_link_id)) {
    errors.push(errorEntry("qr_link_id", "required_for_qr_scan", "qr_link_id is required when expected_action is qr_scan"));
  }
  if (context.project && !scopeMatches(binding, context.project)) {
    errors.push(errorEntry("scope", "project_scope_mismatch", "measurement binding scope must match campaign project scope"));
  }
  if (context.scene && !scopeMatches(binding, context.scene)) {
    errors.push(errorEntry("scope", "scene_scope_mismatch", "measurement binding scope must match scene scope"));
  }
  if (context.render_manifest && !scopeMatches(binding, context.render_manifest)) {
    errors.push(errorEntry("scope", "render_manifest_scope_mismatch", "measurement binding scope must match render manifest scope"));
  }
  if (context.qr_binding && !scopeMatches(binding, context.qr_binding)) {
    errors.push(errorEntry("scope", "qr_binding_scope_mismatch", "measurement binding scope must match QR binding scope"));
  }

  return {
    schema_version: "studio-measurement-binding-validation/d1",
    valid: errors.length === 0,
    errors,
    checks: checks.map((check) => ({
      ...check,
      result: check.passed ? "passed" : "failed"
    }))
  };
}

function normalizeQrBindingInput(input = {}, defaults = {}) {
  assertStudioD1InputBoundary(input);
  const qrToken = cleanId(input.qr_token || input.qrToken || defaults.qr_token);
  const qrLinkId = cleanId(input.qr_link_id || input.qrLinkId || defaults.qr_link_id);
  return {
    qr_binding_id: cleanId(input.qr_binding_id || input.qrBindingId || defaults.qr_binding_id),
    qr_link_id: qrLinkId,
    qr_token: qrToken,
    measurement_binding_id: cleanId(input.measurement_binding_id || input.measurementBindingId || defaults.measurement_binding_id),
    tenant_id: cleanId(input.tenant_id || input.tenantId || defaults.tenant_id),
    store_id: cleanId(input.store_id || input.storeId || defaults.store_id),
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId || defaults.screen_group_id),
    campaign_project_id: cleanId(input.campaign_project_id || input.campaignProjectId || defaults.campaign_project_id),
    campaign_project_scene_id: cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId || input.scene_id || input.sceneId || defaults.campaign_project_scene_id),
    campaign_project_revision: positiveInteger(input.campaign_project_revision || input.campaignProjectRevision || defaults.campaign_project_revision, 1),
    creative_id: cleanId(input.creative_id || input.creativeId || defaults.creative_id),
    campaign_id: cleanId(input.campaign_id || input.campaignId || defaults.campaign_id),
    media_campaign_id: cleanId(input.media_campaign_id || input.mediaCampaignId || defaults.media_campaign_id),
    ad_slot_id: cleanId(input.ad_slot_id || input.adSlotId || defaults.ad_slot_id),
    target_url: boundedString(input.target_url || input.targetUrl || input.destination_url || input.destinationUrl || defaults.target_url, 1000),
    status: enumValue(input.status || defaults.status || "draft", QR_BINDING_STATUSES, "status"),
    attribution_claim: enumValue(input.attribution_claim || input.attributionClaim || defaults.attribution_claim || "measured_response_only", QR_ATTRIBUTION_CLAIMS, "attribution_claim"),
    expires_at: boundedString(input.expires_at || input.expiresAt || defaults.expires_at, 80),
    created_by_actor_id: cleanId(input.created_by_actor_id || input.createdByActorId || defaults.created_by_actor_id)
  };
}

function validateQrBindingContract(qrBinding = {}, measurementBinding = {}) {
  const errors = [];
  requireText(errors, qrBinding.qr_link_id, "qr_link_id");
  requireText(errors, qrBinding.measurement_binding_id, "measurement_binding_id");
  requireText(errors, qrBinding.tenant_id, "tenant_id");
  requireText(errors, qrBinding.store_id, "store_id");
  requireText(errors, qrBinding.screen_group_id, "screen_group_id");
  requireText(errors, qrBinding.campaign_project_id, "campaign_project_id");
  requireText(errors, qrBinding.campaign_project_scene_id, "campaign_project_scene_id");
  requireText(errors, qrBinding.creative_id, "creative_id");
  requireText(errors, qrBinding.target_url, "target_url");
  requireEnum(errors, qrBinding.status, QR_BINDING_STATUSES, "status");
  requireEnum(errors, qrBinding.attribution_claim, QR_ATTRIBUTION_CLAIMS, "attribution_claim");
  if (qrBinding.attribution_claim !== "measured_response_only") {
    errors.push(errorEntry("attribution_claim", "qr_response_only", "QR scan evidence must remain measured response only"));
  }
  if (measurementBinding?.measurement_binding_id && !scopeMatches(qrBinding, measurementBinding)) {
    errors.push(errorEntry("scope", "measurement_binding_scope_mismatch", "QR binding scope must match measurement binding scope"));
  }
  if (measurementBinding?.measurement_binding_id && qrBinding.measurement_binding_id !== measurementBinding.measurement_binding_id) {
    errors.push(errorEntry("measurement_binding_id", "mismatch", "QR binding must reference the selected measurement binding"));
  }
  return {
    schema_version: "studio-qr-binding-validation/d1",
    valid: errors.length === 0,
    errors
  };
}

function defaultDataSourceForExpectedAction(expectedAction) {
  if (expectedAction === "qr_scan") return "misell_qr";
  if (expectedAction === "coupon_issue") return "misell_coupon";
  if (expectedAction === "counter_order") return "misell_order";
  return "misell_playlog";
}

function defaultMeasurementLabelForDataSource(dataSourceClass) {
  return MISELL_MEASURED_DATA_SOURCES.has(dataSourceClass) ? "measured" : "estimated";
}

function incrementalHasEvidence(binding) {
  if (stringValue(binding.measurement_label) !== "incremental") return true;
  return hasText(binding.baseline_evidence_ref) || hasText(binding.holdout_evidence_ref);
}

function measuredSourceGuard(binding) {
  if (stringValue(binding.measurement_label) !== "measured") return true;
  return MISELL_MEASURED_DATA_SOURCES.has(stringValue(binding.data_source_class));
}

function scopeMatches(left = {}, right = {}) {
  return ["tenant_id", "store_id", "screen_group_id"].every((field) => stringValue(left[field]) === stringValue(right[field]));
}

function addCheck(checks, checkId, passed) {
  checks.push({ check_id: checkId, passed: Boolean(passed) });
}

function requireText(errors, value, field) {
  if (!hasText(value)) errors.push(errorEntry(field, "required", `${field} is required`));
}

function requireEnum(errors, value, allowed, field) {
  if (!allowed.includes(stringValue(value))) {
    errors.push(errorEntry(field, "unsupported", `${field} must be one of: ${allowed.join(", ")}`));
  }
}

function errorEntry(field, code, message) {
  return { field, code, message };
}

function enumValue(value, allowed, field) {
  const normalized = stringValue(value);
  if (!allowed.includes(normalized)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return number;
}

function boundedString(value, maxLength) {
  return stringValue(value).slice(0, maxLength);
}

function cleanId(value) {
  return stringValue(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

function hasText(value) {
  return Boolean(stringValue(value));
}

function stringValue(value) {
  return typeof value === "string" ? value.trim().replace(/\0/g, "") : "";
}

function normalizeKey(key) {
  return stringValue(key).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

module.exports = {
  MEASUREMENT_BINDING_VERSION,
  QR_BINDING_VERSION,
  CONTENT_LAYERS,
  ITEM_TYPES,
  EXPECTED_ACTIONS,
  DURATION_CLASSES,
  MEASUREMENT_LABELS,
  DATA_SOURCE_CLASSES,
  MEASUREMENT_BINDING_STATUSES,
  QR_BINDING_STATUSES,
  QR_ATTRIBUTION_CLAIMS,
  assertStudioD1InputBoundary,
  normalizeMeasurementBindingInput,
  validateMeasurementBindingContract,
  normalizeQrBindingInput,
  validateQrBindingContract
};
