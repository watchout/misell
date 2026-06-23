"use strict";

// Contract helpers for #146 Campaign Generator foundation.
// This slice is deterministic: it never calls external AI, renders media, publishes,
// or creates content manifests.

const CAMPAIGN_PROJECT_STATUSES = Object.freeze(["draft", "validated", "archived", "deleted"]);
const CAMPAIGN_PROJECT_SCENE_STATUSES = Object.freeze(["draft", "valid", "invalid", "deleted"]);
const CAMPAIGN_PROJECT_SOURCE_TYPES = Object.freeze(["campaign_proposal", "campaign_brief", "free_input"]);

const CAMPAIGN_BRIEF_FIELDS = Object.freeze([
  "objective",
  "target_audience",
  "store_context",
  "offer_or_message",
  "cta",
  "success_metrics",
  "constraints",
  "source_proposal_id",
  "source_context_snapshot_id",
  "created_by_user_id"
]);

const SCENE_DRAFT_FIELDS = Object.freeze([
  "scene_order",
  "scene_type",
  "headline",
  "body_text",
  "visual_direction",
  "cta_text",
  "duration_seconds",
  "asset_requirements",
  "validation_status",
  "validation_errors"
]);

const OUT_OF_SCOPE_KEYS = Object.freeze([
  "ai_prompt",
  "content_id",
  "content_manifest_id",
  "external_ai_provider",
  "generated_media",
  "manifest",
  "media_generation",
  "publish",
  "published_at",
  "render",
  "render_job_id"
]);

const GUARANTEED_CLAIM_PATTERNS = Object.freeze([
  /\bguarantee(?:d|s)?\b/i,
  /\bwill\s+(?:increase|improve|double|triple|grow|boost)\b/i,
  /\b(?:100%|always|never fail)\b/i,
  /必ず/,
  /絶対/,
  /確実に/,
  /保証/,
  /売上(?:が|を)?(?:必ず|確実に)?(?:上が|伸び|増え)/,
  /来店(?:が|を)?(?:必ず|確実に)?(?:増え|伸び)/
]);

const PII_PATTERNS = Object.freeze([
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?\d[\d\s().-]{8,}\d)/,
  /\b\d{3}-\d{4}\b/
]);

function normalizeCampaignBriefInput(input = {}, defaults = {}) {
  assertNoOutOfScopeCampaignGeneratorInput(input);
  const brief = {
    objective: textField(input, defaults, "objective", 2000),
    target_audience: textField(input, defaults, "target_audience", 1200),
    store_context: textField(input, defaults, "store_context", 3000),
    offer_or_message: textField(input, defaults, "offer_or_message", 2000),
    cta: textField(input, defaults, "cta", 1000),
    success_metrics: structuredListField(input, defaults, "success_metrics"),
    constraints: structuredListField(input, defaults, "constraints"),
    source_proposal_id: idField(input, defaults, "source_proposal_id"),
    source_context_snapshot_id: idField(input, defaults, "source_context_snapshot_id"),
    created_by_user_id: textField(input, defaults, "created_by_user_id", 120)
  };
  return brief;
}

function normalizeSceneDraftInput(input = {}, existing = {}) {
  assertNoOutOfScopeCampaignGeneratorInput(input);
  const merged = { ...(existing || {}), ...(input || {}) };
  const sceneOrder = integerField(merged, "scene_order", integerField(existing, "scene_order", null));
  const durationSeconds = integerField(merged, "duration_seconds", integerField(existing, "duration_seconds", 0));
  return {
    scene_order: sceneOrder,
    scene_type: stringValue(aliasValue(merged, "scene_type")).slice(0, 80),
    headline: stringValue(aliasValue(merged, "headline")).slice(0, 300),
    body_text: stringValue(aliasValue(merged, "body_text")).slice(0, 2000),
    visual_direction: stringValue(aliasValue(merged, "visual_direction")).slice(0, 2000),
    cta_text: stringValue(aliasValue(merged, "cta_text")).slice(0, 400),
    duration_seconds: durationSeconds,
    asset_requirements: normalizeStructuredList(aliasValue(merged, "asset_requirements")),
    validation_status: stringValue(aliasValue(merged, "validation_status") || existing.validation_status || "draft").slice(0, 40) || "draft",
    validation_errors: normalizeStructuredList(aliasValue(merged, "validation_errors"))
  };
}

function validateSceneDraft(scene = {}) {
  const normalized = normalizeSceneDraftInput(scene);
  const errors = [];
  requireText(errors, normalized.scene_type, "scene_type");
  requireText(errors, normalized.headline, "headline");
  requireText(errors, normalized.body_text, "body_text");
  requireText(errors, normalized.visual_direction, "visual_direction");
  requireText(errors, normalized.cta_text, "cta_text");
  if (!Number.isSafeInteger(normalized.scene_order) || normalized.scene_order < 1) {
    errors.push(errorEntry("scene_order", "required", "scene_order must be a positive integer"));
  }
  if (!Number.isSafeInteger(normalized.duration_seconds) || normalized.duration_seconds <= 0) {
    errors.push(errorEntry("duration_seconds", "invalid", "duration_seconds must be greater than 0"));
  }
  if (!normalized.cta_text) {
    errors.push(errorEntry("cta_text", "missing_cta", "cta_text is required"));
  }
  for (const field of ["headline", "body_text", "visual_direction", "cta_text"]) {
    const value = normalized[field];
    if (containsGuaranteedOutcomeClaim(value)) {
      errors.push(errorEntry(field, "guaranteed_outcome_claim", "guaranteed outcome or definitive performance claims are not allowed"));
    }
    if (containsDirectPii(value)) {
      errors.push(errorEntry(field, "direct_pii", "direct PII is not allowed in scene text"));
    }
  }
  return {
    scene: normalized,
    valid: errors.length === 0,
    errors
  };
}

function assertNoOutOfScopeCampaignGeneratorInput(value, path = "") {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertNoOutOfScopeCampaignGeneratorInput(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = stringValue(key).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (normalizedKey === "external_ai_used" && Boolean(child)) {
      throw new Error("external AI is out of scope for the Campaign Generator foundation");
    }
    if (OUT_OF_SCOPE_KEYS.includes(normalizedKey)) {
      throw new Error(`${path ? `${path}.` : ""}${key} is out of scope for the Campaign Generator foundation`);
    }
    assertNoOutOfScopeCampaignGeneratorInput(child, path ? `${path}.${key}` : key);
  }
}

function containsGuaranteedOutcomeClaim(value) {
  const text = stringValue(value);
  return GUARANTEED_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function containsDirectPii(value) {
  const text = stringValue(value);
  return PII_PATTERNS.some((pattern) => pattern.test(text));
}

function requireText(errors, value, field) {
  if (!stringValue(value)) errors.push(errorEntry(field, "required", `${field} is required`));
}

function errorEntry(field, code, message) {
  return { field, code, message };
}

function textField(input, defaults, field, maxLength) {
  return stringValue(aliasValue(input, field) ?? aliasValue(defaults, field)).slice(0, maxLength);
}

function idField(input, defaults, field) {
  return cleanId(aliasValue(input, field) ?? aliasValue(defaults, field));
}

function structuredListField(input, defaults, field) {
  return normalizeStructuredList(aliasValue(input, field) ?? aliasValue(defaults, field));
}

function aliasValue(input, field) {
  if (!input || typeof input !== "object") return undefined;
  const camel = field.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  return input[field] ?? input[camel];
}

function normalizeStructuredList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map(normalizeStructuredValue).filter((entry) => entry !== "");
  if (typeof value === "object") return [normalizeStructuredValue(value)];
  return [stringValue(value).slice(0, 1000)].filter(Boolean);
}

function normalizeStructuredValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeStructuredValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [stringValue(key).slice(0, 80), normalizeStructuredValue(child)])
    );
  }
  return stringValue(value).slice(0, 1000);
}

function integerField(input, field, fallback) {
  const value = aliasValue(input, field);
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function cleanId(value) {
  return stringValue(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim().replace(/\0/g, "") : "";
}

module.exports = {
  CAMPAIGN_PROJECT_STATUSES,
  CAMPAIGN_PROJECT_SCENE_STATUSES,
  CAMPAIGN_PROJECT_SOURCE_TYPES,
  CAMPAIGN_BRIEF_FIELDS,
  SCENE_DRAFT_FIELDS,
  normalizeCampaignBriefInput,
  normalizeSceneDraftInput,
  validateSceneDraft,
  assertNoOutOfScopeCampaignGeneratorInput,
  containsGuaranteedOutcomeClaim,
  containsDirectPii
};
