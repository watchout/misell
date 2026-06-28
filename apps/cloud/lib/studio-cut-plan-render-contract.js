"use strict";

// Contract helpers for #210 Studio Execution A1.
// This layer creates deterministic cut-plan/render-manifest state only.
// It must not call external AI, render MP4, publish, or create content manifests.

const crypto = require("crypto");
const {
  containsGuaranteedOutcomeClaim,
  containsDirectPii
} = require("./campaign-generator-contract");

const CUT_PLAN_STATUSES = Object.freeze(["draft", "validated", "invalid", "superseded", "deleted"]);
const CUT_PLAN_VALIDATION_STATUSES = Object.freeze(["pending", "passed", "failed", "deleted"]);
const RENDER_MANIFEST_OUTPUT_TYPES = Object.freeze(["html_preview"]);
const RENDER_MANIFEST_QA_STATUSES = Object.freeze(["pending", "passed", "failed", "deleted"]);
const RENDERER = "html";
const RENDERER_VERSION = "misell-html-renderer-a1-v1";
const QA_SUITE_VERSION = "studio-render-qa-a1-v1";
const DEFAULT_LAYOUT_TEMPLATE_ID = "tri-screen-readable-v1";
const DEFAULT_TEMPLATE_VERSION = "tri-screen-readable-v1";
const DEFAULT_CANVAS_WIDTH = 5760;
const DEFAULT_CANVAS_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const DEFAULT_MIN_FONT_PX = 42;
const DEFAULT_MAX_LINE_LENGTH_CHARS = 34;

function defaultLayoutTemplate(now = "") {
  return {
    layout_template_id: DEFAULT_LAYOUT_TEMPLATE_ID,
    template_version: DEFAULT_TEMPLATE_VERSION,
    screen_mode: "left_center_right",
    canvas_width: DEFAULT_CANVAS_WIDTH,
    canvas_height: DEFAULT_CANVAS_HEIGHT,
    fps: DEFAULT_FPS,
    safe_area_px: { top: 72, right: 96, bottom: 72, left: 96 },
    bezel_policy: "avoid_critical_copy",
    regions: [
      { region_id: "left_headline", screen: "left", x: 96, y: 120, width: 1728, height: 420, allowed_content: "text" },
      { region_id: "center_body", screen: "center", x: 2016, y: 120, width: 1728, height: 560, allowed_content: "text" },
      { region_id: "right_cta", screen: "right", x: 3936, y: 160, width: 1728, height: 420, allowed_content: "cta" },
      { region_id: "right_qr", screen: "right", x: 4590, y: 620, width: 420, height: 420, allowed_content: "qr" }
    ],
    min_font_px: DEFAULT_MIN_FONT_PX,
    max_line_length_chars: DEFAULT_MAX_LINE_LENGTH_CHARS,
    contrast_policy: "wcag_like_threshold",
    status: "active",
    created_at: now,
    updated_at: now
  };
}

function buildCutPlanContract(project = {}, scenes = [], layoutTemplate = defaultLayoutTemplate(), options = {}) {
  const activeScenes = scenes
    .filter((scene) => stringValue(scene.status) !== "deleted")
    .sort((a, b) => numberValue(a.scene_order) - numberValue(b.scene_order));
  const sourceSceneIds = activeScenes.map((scene) => stringValue(scene.campaign_project_scene_id));
  const campaignProjectRevision = revisionFromProject(project);
  const templateVersion = stringValue(layoutTemplate.template_version) || DEFAULT_TEMPLATE_VERSION;
  const cutPlanSeed = stableStringify({
    campaign_project_id: stringValue(project.campaign_project_id),
    campaign_project_revision: campaignProjectRevision,
    source_scene_ids: sourceSceneIds,
    scene_fingerprints: activeScenes.map(sceneFingerprint),
    layout_template_id: stringValue(layoutTemplate.layout_template_id) || DEFAULT_LAYOUT_TEMPLATE_ID,
    template_version: templateVersion,
    renderer_version: RENDERER_VERSION
  });
  const cutPlanVersion = `cut-plan-a1-${sha256Hex(cutPlanSeed).slice(0, 16)}`;
  const sceneOrder = activeScenes.map((scene, index) => ({
    scene_id: stringValue(scene.campaign_project_scene_id),
    order_index: index + 1,
    scene_order: numberValue(scene.scene_order),
    duration_seconds: numberValue(scene.duration_seconds)
  }));
  const copyBindings = {
    headline: activeScenes.map((scene) => copyBinding(scene, "headline", "left", "left_headline", "headline")),
    body: activeScenes.map((scene) => copyBinding(scene, "body_text", "center", "center_body", "body")),
    cta: activeScenes.map((scene) => copyBinding(scene, "cta_text", "right", "right_cta", "cta")),
    legal: [],
    price: []
  };
  const screenBindings = {
    left: copyBindings.headline.map(screenBindingFromCopy),
    center: copyBindings.body.map(screenBindingFromCopy),
    right: copyBindings.cta.map(screenBindingFromCopy),
    wide: null
  };
  const assetRequirements = activeScenes.flatMap((scene) => normalizeList(scene.asset_requirements).map((requirement) => ({
    scene_id: stringValue(scene.campaign_project_scene_id),
    requirement
  })));
  const cutPlan = {
    schema_version: "studio-cut-plan/a1",
    cut_plan_id: stringValue(options.cut_plan_id),
    tenant_id: stringValue(project.tenant_id),
    store_id: stringValue(project.store_id),
    screen_group_id: stringValue(project.screen_group_id),
    campaign_project_id: stringValue(project.campaign_project_id),
    campaign_project_revision: campaignProjectRevision,
    source_scene_ids: sourceSceneIds,
    cut_plan_version: cutPlanVersion,
    status: "draft",
    layout_template_id: stringValue(layoutTemplate.layout_template_id) || DEFAULT_LAYOUT_TEMPLATE_ID,
    scene_order: sceneOrder,
    screen_bindings: screenBindings,
    copy_bindings: copyBindings,
    visual_direction: {
      scenes: activeScenes.map((scene) => ({
        scene_id: stringValue(scene.campaign_project_scene_id),
        visual_direction: stringValue(scene.visual_direction)
      }))
    },
    asset_requirements: assetRequirements,
    brand_constraints: {
      constraints: normalizeList(project.constraints),
      source: "campaign_project.constraints"
    },
    forbidden_elements: [
      "guaranteed_outcome_claim",
      "direct_pii",
      "critical_copy_across_bezel",
      "primary_text_in_generated_media"
    ],
    measurement_goal: normalizeList(project.success_metrics)[0] || "",
    expected_action: stringValue(project.cta),
    validation_status: "pending",
    validation_errors: [],
    deterministic_identity: {
      campaign_project_revision: campaignProjectRevision,
      cut_plan_version: cutPlanVersion,
      template_version: templateVersion,
      renderer_version: RENDERER_VERSION,
      source_scene_ids: sourceSceneIds,
      source_asset_ids: [],
      generated_asset_ids: []
    },
    no_external_ai: true,
    no_provider_job: true,
    no_media_generation: true,
    no_mp4_export: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
  return cutPlan;
}

function validateCutPlanContract(cutPlan = {}, layoutTemplate = defaultLayoutTemplate()) {
  const errors = [];
  if (!stringValue(cutPlan.tenant_id)) pushError(errors, "tenant_id", "required", "tenant_id is required");
  if (!stringValue(cutPlan.store_id)) pushError(errors, "store_id", "required", "store_id is required");
  if (!stringValue(cutPlan.screen_group_id)) pushError(errors, "screen_group_id", "required", "screen_group_id is required");
  if (!stringValue(cutPlan.campaign_project_id)) pushError(errors, "campaign_project_id", "required", "campaign_project_id is required");
  if (!stringValue(cutPlan.layout_template_id)) pushError(errors, "layout_template_id", "required", "layout_template_id is required");
  if (stringValue(cutPlan.layout_template_id) !== stringValue(layoutTemplate.layout_template_id)) {
    pushError(errors, "layout_template_id", "mismatch", "layout_template_id must match the selected layout template");
  }
  validateLayoutTemplate(layoutTemplate, errors);

  const sceneOrder = Array.isArray(cutPlan.scene_order) ? cutPlan.scene_order : [];
  if (sceneOrder.length === 0) pushError(errors, "scene_order", "required", "at least one scene is required");
  for (const [index, scene] of sceneOrder.entries()) {
    if (!stringValue(scene.scene_id)) pushError(errors, `scene_order[${index}].scene_id`, "required", "scene_id is required");
    if (!Number.isSafeInteger(numberValue(scene.order_index)) || numberValue(scene.order_index) < 1) {
      pushError(errors, `scene_order[${index}].order_index`, "invalid", "order_index must be a positive integer");
    }
    if (!Number.isFinite(numberValue(scene.duration_seconds)) || numberValue(scene.duration_seconds) <= 0) {
      pushError(errors, `scene_order[${index}].duration_seconds`, "invalid", "duration_seconds must be greater than 0");
    }
  }

  const expectedAction = stringValue(cutPlan.expected_action);
  const ctaBindings = Array.isArray(cutPlan.copy_bindings?.cta) ? cutPlan.copy_bindings.cta : [];
  if (expectedAction && ctaBindings.length === 0) {
    pushError(errors, "copy_bindings.cta", "missing_cta", "CTA bindings are required when expected_action is set");
  }
  for (const group of ["headline", "body", "cta", "legal", "price"]) {
    const bindings = Array.isArray(cutPlan.copy_bindings?.[group]) ? cutPlan.copy_bindings[group] : [];
    for (const [index, binding] of bindings.entries()) {
      const text = stringValue(binding.text);
      if (!stringValue(binding.scene_id)) pushError(errors, `copy_bindings.${group}[${index}].scene_id`, "required", "scene_id is required");
      if (!text && group !== "legal" && group !== "price") {
        pushError(errors, `copy_bindings.${group}[${index}].text`, "required", `${group} text is required`);
      }
      if (containsGuaranteedOutcomeClaim(text)) {
        pushError(errors, `copy_bindings.${group}[${index}].text`, "guaranteed_outcome_claim", "guaranteed outcome or definitive performance claims are not allowed");
      }
      if (containsDirectPii(text)) {
        pushError(errors, `copy_bindings.${group}[${index}].text`, "direct_pii", "direct PII is not allowed in render copy");
      }
      if (["legal", "price", "cta"].includes(group) && stringValue(binding.rendered_by) !== "deterministic_renderer") {
        pushError(errors, `copy_bindings.${group}[${index}].rendered_by`, "not_deterministic", "price, legal, and CTA copy must be rendered by the deterministic renderer");
      }
      if (stringValue(binding.screen) === "bezel") {
        pushError(errors, `copy_bindings.${group}[${index}].screen`, "critical_copy_across_bezel", "critical copy must not be assigned across bezels");
      }
    }
  }
  if (cutPlan.no_external_ai !== true) pushError(errors, "no_external_ai", "required", "cut plan must record no_external_ai=true");
  if (cutPlan.no_mp4_export !== true) pushError(errors, "no_mp4_export", "required", "A1 cut plan must not export MP4");
  if (cutPlan.no_content_manifest_creation !== true) pushError(errors, "no_content_manifest_creation", "required", "A1 cut plan must not create content manifests");
  if (cutPlan.no_publish !== true) pushError(errors, "no_publish", "required", "A1 cut plan must not publish");
  return {
    valid: errors.length === 0,
    errors
  };
}

function buildHtmlPreviewRenderState(cutPlan = {}, layoutTemplate = defaultLayoutTemplate()) {
  const scenes = (Array.isArray(cutPlan.scene_order) ? cutPlan.scene_order : []).map((scene) => {
    const sceneId = stringValue(scene.scene_id);
    return {
      scene_id: sceneId,
      order_index: numberValue(scene.order_index),
      duration_seconds: numberValue(scene.duration_seconds),
      screens: {
        left: renderTextFor(cutPlan, "headline", sceneId),
        center: renderTextFor(cutPlan, "body", sceneId),
        right: renderTextFor(cutPlan, "cta", sceneId)
      }
    };
  });
  return {
    schema_version: "studio-html-preview-render-state/a1",
    renderer: RENDERER,
    renderer_version: RENDERER_VERSION,
    source_of_truth: "html_preview_state",
    mp4_is_export_artifact_only: true,
    layout_template: {
      layout_template_id: stringValue(layoutTemplate.layout_template_id),
      template_version: stringValue(layoutTemplate.template_version),
      screen_mode: stringValue(layoutTemplate.screen_mode),
      canvas_width: numberValue(layoutTemplate.canvas_width),
      canvas_height: numberValue(layoutTemplate.canvas_height),
      fps: numberValue(layoutTemplate.fps),
      regions: Array.isArray(layoutTemplate.regions) ? layoutTemplate.regions : []
    },
    deterministic_identity: cutPlan.deterministic_identity || {},
    campaign_project_id: stringValue(cutPlan.campaign_project_id),
    cut_plan_id: stringValue(cutPlan.cut_plan_id),
    cut_plan_version: stringValue(cutPlan.cut_plan_version),
    scenes
  };
}

function buildRenderManifestContract(cutPlan = {}, layoutTemplate = defaultLayoutTemplate(), options = {}) {
  const outputType = stringValue(options.output_type || "html_preview");
  if (!RENDER_MANIFEST_OUTPUT_TYPES.includes(outputType)) {
    throw new Error("A1 render manifest only supports html_preview output_type");
  }
  const renderState = buildHtmlPreviewRenderState(cutPlan, layoutTemplate);
  const outputSha256 = sha256Hex(stableStringify(renderState));
  const durationSeconds = (Array.isArray(cutPlan.scene_order) ? cutPlan.scene_order : [])
    .reduce((sum, scene) => sum + Math.max(0, numberValue(scene.duration_seconds)), 0);
  return {
    schema_version: "studio-render-manifest/a1",
    render_manifest_id: stringValue(options.render_manifest_id),
    tenant_id: stringValue(cutPlan.tenant_id),
    store_id: stringValue(cutPlan.store_id),
    screen_group_id: stringValue(cutPlan.screen_group_id),
    campaign_project_id: stringValue(cutPlan.campaign_project_id),
    campaign_project_revision: numberValue(cutPlan.campaign_project_revision),
    cut_plan_id: stringValue(cutPlan.cut_plan_id),
    cut_plan_version: stringValue(cutPlan.cut_plan_version),
    layout_template_id: stringValue(layoutTemplate.layout_template_id),
    template_version: stringValue(layoutTemplate.template_version),
    renderer: RENDERER,
    renderer_version: RENDERER_VERSION,
    scene_ids: Array.isArray(cutPlan.source_scene_ids) ? cutPlan.source_scene_ids : [],
    source_asset_ids: cutPlan.deterministic_identity?.source_asset_ids || [],
    generated_asset_ids: [],
    provider_job_ids: [],
    output_type: outputType,
    output_ref: `render-state:${outputSha256}`,
    output_sha256: outputSha256,
    resolution_width: numberValue(layoutTemplate.canvas_width),
    resolution_height: numberValue(layoutTemplate.canvas_height),
    fps: numberValue(layoutTemplate.fps),
    duration_seconds: durationSeconds,
    screen_layout: stringValue(layoutTemplate.screen_mode),
    qa_status: "pending",
    qa_errors: [],
    render_state: renderState,
    no_external_ai: true,
    no_provider_job: true,
    no_media_generation: true,
    no_mp4_export: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
}

function runRenderQaContract(cutPlan = {}, layoutTemplate = defaultLayoutTemplate(), manifest = {}) {
  const errors = [];
  const cutPlanValidation = validateCutPlanContract(cutPlan, layoutTemplate);
  for (const error of cutPlanValidation.errors) errors.push({ ...error, check_id: "cut_plan_validation" });
  if (stringValue(manifest.output_type) !== "html_preview") {
    pushError(errors, "output_type", "unsupported", "A1 QA only supports html_preview output");
  }
  if (stringValue(manifest.renderer) !== RENDERER) {
    pushError(errors, "renderer", "unsupported", "A1 QA only supports deterministic HTML renderer");
  }
  if (numberValue(manifest.resolution_width) !== numberValue(layoutTemplate.canvas_width) ||
    numberValue(manifest.resolution_height) !== numberValue(layoutTemplate.canvas_height)) {
    pushError(errors, "resolution", "mismatch", "render manifest resolution must match layout template");
  }
  if (numberValue(manifest.duration_seconds) <= 0) {
    pushError(errors, "duration_seconds", "invalid", "render duration must be greater than 0");
  }
  if (Array.isArray(manifest.generated_asset_ids) && manifest.generated_asset_ids.length > 0) {
    pushError(errors, "generated_asset_ids", "out_of_scope", "generated assets are out of scope for A1");
  }
  if (Array.isArray(manifest.provider_job_ids) && manifest.provider_job_ids.length > 0) {
    pushError(errors, "provider_job_ids", "out_of_scope", "provider jobs are out of scope for A1");
  }
  return {
    qa_suite_version: QA_SUITE_VERSION,
    status: errors.length === 0 ? "passed" : "failed",
    checks: qaChecksFromErrors(errors),
    blocked_reasons: errors.filter((error) => error.severity !== "warn").map((error) => error.code),
    errors
  };
}

function renderTextFor(cutPlan, group, sceneId) {
  const binding = (cutPlan.copy_bindings?.[group] || []).find((entry) => stringValue(entry.scene_id) === sceneId);
  if (!binding) return null;
  return {
    text: stringValue(binding.text),
    region_id: stringValue(binding.region_id),
    screen: stringValue(binding.screen),
    rendered_by: stringValue(binding.rendered_by)
  };
}

function copyBinding(scene, field, screen, regionId, contentType) {
  return {
    scene_id: stringValue(scene.campaign_project_scene_id),
    scene_order: numberValue(scene.scene_order),
    field,
    screen,
    region_id: regionId,
    allowed_content: contentType,
    text: stringValue(scene[field]),
    rendered_by: "deterministic_renderer"
  };
}

function screenBindingFromCopy(binding) {
  return {
    scene_id: binding.scene_id,
    scene_order: binding.scene_order,
    region_id: binding.region_id,
    field: binding.field,
    text_ref: `${binding.scene_id}:${binding.field}`,
    rendered_by: binding.rendered_by
  };
}

function validateLayoutTemplate(layoutTemplate, errors) {
  const regionIds = new Set();
  const regions = Array.isArray(layoutTemplate.regions) ? layoutTemplate.regions : [];
  if (!regions.length) pushError(errors, "layout_template.regions", "required", "layout template must define regions");
  for (const [index, region] of regions.entries()) {
    const regionId = stringValue(region.region_id);
    if (!regionId) pushError(errors, `layout_template.regions[${index}].region_id`, "required", "region_id is required");
    if (regionIds.has(regionId)) pushError(errors, `layout_template.regions[${index}].region_id`, "duplicate", "region_id must be unique");
    regionIds.add(regionId);
    if (!["left", "center", "right", "wide"].includes(stringValue(region.screen))) {
      pushError(errors, `layout_template.regions[${index}].screen`, "invalid", "region screen must be left, center, right, or wide");
    }
  }
  if (numberValue(layoutTemplate.canvas_width) <= 0 || numberValue(layoutTemplate.canvas_height) <= 0) {
    pushError(errors, "layout_template.resolution", "invalid", "layout template resolution must be positive");
  }
  if (numberValue(layoutTemplate.min_font_px) < 24) {
    pushError(errors, "layout_template.min_font_px", "too_small", "minimum font size is too small for signage");
  }
  if (numberValue(layoutTemplate.max_line_length_chars) > 42) {
    pushError(errors, "layout_template.max_line_length_chars", "too_long", "line length must stay readable for signage");
  }
}

function qaChecksFromErrors(errors) {
  if (!errors.length) {
    return [
      { check_id: "schema", result: "passed", severity: "block", evidence: { valid: true } },
      { check_id: "resolution", result: "passed", severity: "block", evidence: { valid: true } },
      { check_id: "three_screen_assignment", result: "passed", severity: "block", evidence: { valid: true } },
      { check_id: "copy_safety", result: "passed", severity: "block", evidence: { valid: true } },
      { check_id: "source_of_truth", result: "passed", severity: "block", evidence: { deterministic_renderer: true } }
    ];
  }
  return errors.map((error) => ({
    check_id: error.check_id || error.code || "validation",
    result: "failed",
    severity: error.severity || "block",
    evidence: error
  }));
}

function sceneFingerprint(scene = {}) {
  return {
    scene_id: stringValue(scene.campaign_project_scene_id),
    scene_order: numberValue(scene.scene_order),
    scene_type: stringValue(scene.scene_type),
    headline: stringValue(scene.headline),
    body_text: stringValue(scene.body_text),
    cta_text: stringValue(scene.cta_text),
    duration_seconds: numberValue(scene.duration_seconds),
    asset_requirements: normalizeList(scene.asset_requirements)
  };
}

function revisionFromProject(project = {}) {
  const updatedAt = Date.parse(stringValue(project.updated_at));
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(stringValue(project.created_at));
  if (Number.isFinite(createdAt)) return createdAt;
  return numberValue(project.id);
}

function pushError(errors, field, code, message, severity = "block") {
  errors.push({ field, code, message, severity });
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim().replace(/\0/g, "") : "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

module.exports = {
  CUT_PLAN_STATUSES,
  CUT_PLAN_VALIDATION_STATUSES,
  RENDER_MANIFEST_OUTPUT_TYPES,
  RENDER_MANIFEST_QA_STATUSES,
  RENDERER,
  RENDERER_VERSION,
  QA_SUITE_VERSION,
  DEFAULT_LAYOUT_TEMPLATE_ID,
  DEFAULT_TEMPLATE_VERSION,
  defaultLayoutTemplate,
  buildCutPlanContract,
  validateCutPlanContract,
  buildHtmlPreviewRenderState,
  buildRenderManifestContract,
  runRenderQaContract,
  stableStringify,
  sha256Hex
};
