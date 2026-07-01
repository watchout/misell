"use strict";

const PROOF_OF_PLAY_BINDING_VERSION = "studio-proof-of-play-binding-d3-v1";
const PROOF_OF_PLAY_SOURCE_SYSTEMS = new Set(["playlog", "qr_scan"]);
const PROOF_OF_PLAY_EVIDENCE_LABELS = new Set(["measured_play_evidence", "measured_response_only"]);
const PROOF_OF_PLAY_SOURCE_DATA_CLASSES = new Set(["misell_playlog", "misell_qr"]);
const MEASUREMENT_LABELS = new Set(["measured", "estimated", "incremental"]);

const FORBIDDEN_INPUT_KEYS = new Set([
  "roi",
  "roas",
  "lift",
  "sales_lift",
  "guarantee",
  "guaranteed_outcome",
  "purchase",
  "purchase_attribution",
  "visit",
  "visit_attribution",
  "incremental_claim",
  "incremental_roi",
  "conversion_value",
  "content_manifest",
  "content_manifest_id",
  "publish",
  "publish_now",
  "activate",
  "schedule_activation",
  "release_channel",
  "device_command",
  "player_mutation",
  "provider_job",
  "external_ai",
  "mcp",
  "camera",
  "pos",
  "billing",
  "credit"
]);

function assertStudioD3InputBoundary(input = {}) {
  const forbidden = [];
  visitInputKeys(input, "", forbidden);
  if (forbidden.length > 0) {
    throw new Error(`Studio Execution D3 input is out of scope: ${forbidden.slice(0, 6).join(", ")}`);
  }
}

function normalizeProofOfPlayBindingInput(input = {}, defaults = {}) {
  return {
    proof_binding_id: cleanId(input.proof_binding_id || input.proofBindingId || defaults.proof_binding_id),
    tenant_id: cleanId(input.tenant_id || input.tenantId || defaults.tenant_id),
    store_id: cleanId(input.store_id || input.storeId || defaults.store_id),
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId || defaults.screen_group_id),
    measurement_binding_id: cleanId(input.measurement_binding_id || input.measurementBindingId || defaults.measurement_binding_id),
    campaign_project_id: cleanId(input.campaign_project_id || input.campaignProjectId || defaults.campaign_project_id),
    campaign_project_scene_id: cleanId(input.campaign_project_scene_id || input.campaignProjectSceneId || defaults.campaign_project_scene_id),
    campaign_id: cleanId(input.campaign_id || input.campaignId || defaults.campaign_id),
    media_campaign_id: cleanId(input.media_campaign_id || input.mediaCampaignId || defaults.media_campaign_id),
    creative_id: cleanId(input.creative_id || input.creativeId || defaults.creative_id),
    ad_slot_id: cleanId(input.ad_slot_id || input.adSlotId || defaults.ad_slot_id),
    qr_link_id: cleanId(input.qr_link_id || input.qrLinkId || defaults.qr_link_id),
    source_system: cleanString(input.source_system || input.sourceSystem || defaults.source_system),
    source_event_id: cleanString(input.source_event_id || input.sourceEventId || defaults.source_event_id),
    source_row_id: asInteger(input.source_row_id || input.sourceRowId || defaults.source_row_id),
    source_event_at: cleanString(input.source_event_at || input.sourceEventAt || defaults.source_event_at),
    evidence_label: cleanString(input.evidence_label || input.evidenceLabel || defaults.evidence_label),
    measurement_label: cleanString(input.measurement_label || input.measurementLabel || defaults.measurement_label),
    data_source_class: cleanString(input.data_source_class || input.dataSourceClass || defaults.data_source_class),
    source_data_class: cleanString(input.source_data_class || input.sourceDataClass || defaults.source_data_class),
    attribution_claim: cleanString(input.attribution_claim || input.attributionClaim || defaults.attribution_claim),
    baseline_evidence_ref: cleanString(input.baseline_evidence_ref || input.baselineEvidenceRef || defaults.baseline_evidence_ref),
    holdout_evidence_ref: cleanString(input.holdout_evidence_ref || input.holdoutEvidenceRef || defaults.holdout_evidence_ref),
    manifest_hash: cleanString(input.manifest_hash || input.manifestHash || defaults.manifest_hash).slice(0, 160),
    playlist_item_id: cleanId(input.playlist_item_id || input.playlistItemId || defaults.playlist_item_id),
    play_result: cleanString(input.play_result || input.playResult || defaults.play_result),
    planned_duration_seconds: asInteger(input.planned_duration_seconds || input.plannedDurationSeconds || defaults.planned_duration_seconds),
    played_duration_seconds: asInteger(input.played_duration_seconds || input.playedDurationSeconds || defaults.played_duration_seconds),
    qr_scan_id: cleanId(input.qr_scan_id || input.qrScanId || defaults.qr_scan_id),
    source_ref: normalizeSourceRef(input.source_ref || input.sourceRef || defaults.source_ref),
    rebuild_key: cleanString(input.rebuild_key || input.rebuildKey || defaults.rebuild_key),
    validation_status: cleanString(input.validation_status || input.validationStatus || defaults.validation_status || "invalid"),
    validation_errors: Array.isArray(input.validation_errors || defaults.validation_errors) ? (input.validation_errors || defaults.validation_errors) : []
  };
}

function validateProofOfPlayBindingContract(binding = {}, context = {}) {
  const errors = [];
  const checks = [];
  const requiredFields = [
    "tenant_id",
    "store_id",
    "screen_group_id",
    "measurement_binding_id",
    "campaign_project_id",
    "source_system",
    "source_event_id",
    "source_event_at",
    "evidence_label",
    "measurement_label",
    "data_source_class",
    "source_data_class"
  ];

  for (const field of requiredFields) {
    if (!cleanString(binding[field])) addError(errors, field, "required", `${field} is required`);
  }

  if (binding.source_system && !PROOF_OF_PLAY_SOURCE_SYSTEMS.has(binding.source_system)) {
    addError(errors, "source_system", "invalid_source_system", "source_system must be playlog or qr_scan");
  }
  if (binding.evidence_label && !PROOF_OF_PLAY_EVIDENCE_LABELS.has(binding.evidence_label)) {
    addError(errors, "evidence_label", "invalid_evidence_label", "evidence_label is not allowed");
  }
  if (binding.source_data_class && !PROOF_OF_PLAY_SOURCE_DATA_CLASSES.has(binding.source_data_class)) {
    addError(errors, "source_data_class", "invalid_source_data_class", "source_data_class is not allowed");
  }
  if (binding.measurement_label && !MEASUREMENT_LABELS.has(binding.measurement_label)) {
    addError(errors, "measurement_label", "invalid_measurement_label", "measurement_label is not allowed");
  }

  if (binding.source_system === "playlog") {
    if (binding.evidence_label !== "measured_play_evidence") {
      addError(errors, "evidence_label", "playlog_requires_play_evidence", "playlog evidence must be measured_play_evidence");
    }
    if (binding.source_data_class !== "misell_playlog") {
      addError(errors, "source_data_class", "playlog_requires_misell_playlog", "playlog evidence must use misell_playlog source_data_class");
    }
    if (binding.attribution_claim && binding.attribution_claim !== "measured_play_evidence") {
      addError(errors, "attribution_claim", "playlog_cannot_claim_response_or_roi", "playlog evidence cannot claim response, sale, visit, ROI, or lift");
    }
  }

  if (binding.source_system === "qr_scan") {
    if (binding.evidence_label !== "measured_response_only") {
      addError(errors, "evidence_label", "qr_requires_response_only", "QR evidence must be measured_response_only");
    }
    if (binding.source_data_class !== "misell_qr") {
      addError(errors, "source_data_class", "qr_requires_misell_qr", "QR evidence must use misell_qr source_data_class");
    }
    if (binding.attribution_claim !== "measured_response_only") {
      addError(errors, "attribution_claim", "qr_requires_response_only", "QR evidence must remain measured_response_only");
    }
    if (!binding.qr_link_id && !binding.qr_scan_id) {
      addError(errors, "qr_link_id", "qr_source_reference_required", "QR proof requires qr_link_id or qr_scan_id");
    }
  }

  if (binding.measurement_label === "incremental" && !binding.baseline_evidence_ref && !binding.holdout_evidence_ref) {
    addError(errors, "measurement_label", "incremental_requires_baseline_or_holdout", "incremental measurement requires baseline or holdout evidence");
  }

  if (context.project) {
    for (const field of ["tenant_id", "store_id", "screen_group_id", "campaign_project_id"]) {
      if (cleanString(binding[field]) && cleanString(context.project[field]) && cleanString(binding[field]) !== cleanString(context.project[field])) {
        addError(errors, field, "scope_mismatch", `${field} does not match project scope`);
      }
    }
  }

  if (context.measurement_binding) {
    for (const field of ["tenant_id", "store_id", "screen_group_id", "campaign_project_id", "campaign_project_scene_id", "creative_id", "ad_slot_id"]) {
      const expected = cleanString(context.measurement_binding[field]);
      if (expected && cleanString(binding[field]) && cleanString(binding[field]) !== expected) {
        addError(errors, field, "measurement_binding_scope_mismatch", `${field} does not match measurement binding`);
      }
    }
  }

  checks.push({ name: "no_roi_fabrication", passed: true });
  checks.push({ name: "no_content_manifest_creation", passed: true });
  checks.push({ name: "no_publish", passed: true });
  checks.push({ name: "no_player_device_mutation", passed: true });
  checks.push({ name: "evidence_label_contract", passed: errors.every((error) => error.field !== "evidence_label") });
  checks.push({ name: "source_data_class_contract", passed: errors.every((error) => error.field !== "source_data_class") });

  return { valid: errors.length === 0, errors, checks };
}

function visitInputKeys(value, path, forbidden) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitInputKeys(entry, `${path}[${index}]`, forbidden));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = String(key).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_INPUT_KEYS.has(normalized)) forbidden.push(childPath);
    visitInputKeys(child, childPath, forbidden);
  }
}

function normalizeSourceRef(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { ref: value };
    }
  }
  if (typeof value === "object") return value;
  return {};
}

function addError(errors, field, code, message) {
  errors.push({ field, code, message });
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 160);
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function asInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  PROOF_OF_PLAY_BINDING_VERSION,
  PROOF_OF_PLAY_SOURCE_SYSTEMS,
  PROOF_OF_PLAY_EVIDENCE_LABELS,
  PROOF_OF_PLAY_SOURCE_DATA_CLASSES,
  assertStudioD3InputBoundary,
  normalizeProofOfPlayBindingInput,
  validateProofOfPlayBindingContract
};
