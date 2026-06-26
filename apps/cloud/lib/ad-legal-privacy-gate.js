"use strict";

// Deterministic policy helper for docs/99. This module classifies advertising,
// report, and claim surfaces; it does not provide legal advice or publish approval.

const POLICY_VERSION = "ad-legal-privacy-gate/v1";

const INDUSTRY_CATEGORIES = Object.freeze([
  "general",
  "medical",
  "finance",
  "recruiting",
  "beauty_health",
  "alcohol",
  "age_restricted",
  "investment",
  "other_regulated"
]);

const CLAIM_CLASSES = Object.freeze([
  "informational",
  "price_offer",
  "comparative",
  "performance_claim",
  "guaranteed_outcome",
  "incremental_claim",
  "health_or_effect_claim"
]);

const PRIVACY_CLASSES = Object.freeze([
  "no_pii",
  "aggregated_only",
  "pii_consented",
  "camera_or_biometric",
  "sensitive_profiling"
]);

const DATA_SOURCE_CLASSES = Object.freeze([
  "misell_playlog",
  "misell_qr",
  "misell_coupon",
  "misell_order",
  "advertiser_supplied",
  "pos_external",
  "camera",
  "ad_network"
]);

const MEASUREMENT_LABELS = Object.freeze([
  "measured",
  "estimated",
  "incremental"
]);

const REVIEW_STATUSES = Object.freeze([
  "draft",
  "needs_review",
  "approved",
  "changes_required",
  "rejected",
  "expired",
  "revoked",
  "deleted"
]);

const GATE_VERDICTS = Object.freeze([
  "allow",
  "allow_with_conditions",
  "block",
  "human_review_required"
]);

const REVIEWER_ROLES = Object.freeze([
  "legal",
  "privacy",
  "ad_review",
  "cto_security",
  "ceo"
]);

const REGULATED_INDUSTRY_CATEGORIES = Object.freeze([
  "medical",
  "finance",
  "recruiting",
  "beauty_health",
  "alcohol",
  "age_restricted",
  "investment",
  "other_regulated"
]);

const HUMAN_REVIEW_CLAIM_CLASSES = Object.freeze([
  "comparative",
  "performance_claim",
  "incremental_claim",
  "health_or_effect_claim"
]);

const BLOCKED_CLAIM_CLASSES = Object.freeze([
  "guaranteed_outcome"
]);

const HUMAN_REVIEW_PRIVACY_CLASSES = Object.freeze([
  "pii_consented"
]);

const BLOCKED_PRIVACY_CLASSES = Object.freeze([
  "camera_or_biometric",
  "sensitive_profiling"
]);

const MISELL_ONLY_DATA_SOURCE_CLASSES = Object.freeze([
  "misell_playlog",
  "misell_qr",
  "misell_coupon",
  "misell_order"
]);

const HUMAN_REVIEW_DATA_SOURCE_CLASSES = Object.freeze([
  "advertiser_supplied",
  "pos_external"
]);

const BLOCKED_DATA_SOURCE_CLASSES = Object.freeze([
  "camera",
  "ad_network"
]);

const ALLOWED_AUTOMATIC_REVIEW_STATUSES = Object.freeze(["draft", "needs_review"]);

function normalizeAdLegalPrivacyGateInput(input = {}) {
  return {
    gate_record_id: cleanId(input.gate_record_id || input.gateRecordId),
    tenant_id: cleanId(input.tenant_id || input.tenantId),
    store_id: cleanId(input.store_id || input.storeId),
    screen_group_id: cleanId(input.screen_group_id || input.screenGroupId),
    advertiser_id: cleanId(input.advertiser_id || input.advertiserId),
    campaign_id: cleanId(input.campaign_id || input.campaignId),
    creative_id: cleanId(input.creative_id || input.creativeId),
    report_surface_id: cleanId(input.report_surface_id || input.reportSurfaceId),
    industry_category: cleanString(input.industry_category || input.industryCategory),
    claim_class: cleanString(input.claim_class || input.claimClass),
    privacy_class: cleanString(input.privacy_class || input.privacyClass),
    data_source_classes: normalizeStringList(input.data_source_classes || input.dataSourceClasses),
    measurement_labels: normalizeStringList(input.measurement_labels || input.measurementLabels),
    review_status: cleanString(input.review_status || input.reviewStatus || "draft"),
    reviewer_role: cleanString(input.reviewer_role || input.reviewerRole),
    reviewer_user_id: cleanId(input.reviewer_user_id || input.reviewerUserId),
    legal_signoff_ref: cleanString(input.legal_signoff_ref || input.legalSignoffRef).slice(0, 500),
    conditions_json: normalizeStructuredValue(input.conditions_json || input.conditionsJson),
    expires_at: cleanString(input.expires_at || input.expiresAt),
    revoked_at: cleanString(input.revoked_at || input.revokedAt),
    deleted_at: cleanString(input.deleted_at || input.deletedAt),
    holdout_or_baseline_evidence_ref: cleanString(
      input.holdout_or_baseline_evidence_ref || input.holdoutOrBaselineEvidenceRef
    ).slice(0, 500),
    created_at: cleanString(input.created_at || input.createdAt),
    updated_at: cleanString(input.updated_at || input.updatedAt)
  };
}

function evaluateAdLegalPrivacyGate(input = {}) {
  const normalized = normalizeAdLegalPrivacyGateInput(input);
  const reasons = [];
  const required_reviews = new Set();
  const protected_gate_required = new Set();
  const blockers = [];
  const humanReviewReasons = [];

  requireField(reasons, normalized.tenant_id, "tenant_id");
  requireEnum(reasons, normalized.industry_category, INDUSTRY_CATEGORIES, "industry_category");
  requireEnum(reasons, normalized.claim_class, CLAIM_CLASSES, "claim_class");
  requireEnum(reasons, normalized.privacy_class, PRIVACY_CLASSES, "privacy_class");
  requireEnum(reasons, normalized.review_status, REVIEW_STATUSES, "review_status");
  requireNonEmptyEnumList(reasons, normalized.data_source_classes, DATA_SOURCE_CLASSES, "data_source_classes");
  requireNonEmptyEnumList(reasons, normalized.measurement_labels, MEASUREMENT_LABELS, "measurement_labels");

  if (reasons.length > 0) {
    return gateResult(normalized, "block", reasons, {
      blockers: reasons.map((reason) => reason.code),
      required_reviews: [],
      protected_gate_required: []
    });
  }

  if (BLOCKED_CLAIM_CLASSES.includes(normalized.claim_class)) {
    block(blockers, reasons, "guaranteed_outcome_blocked", "guaranteed outcome, ROAS guarantee, or performance guarantee claims are blocked");
  }

  if (normalized.claim_class === "incremental_claim" || normalized.measurement_labels.includes("incremental")) {
    if (!normalized.holdout_or_baseline_evidence_ref) {
      block(blockers, reasons, "incremental_without_baseline_blocked", "incremental claims require holdout or baseline evidence");
    } else {
      humanReview(humanReviewReasons, reasons, required_reviews, "incremental_review_required", "legal", "incremental claims require human legal review");
    }
  }

  if (REGULATED_INDUSTRY_CATEGORIES.includes(normalized.industry_category)) {
    humanReview(humanReviewReasons, reasons, required_reviews, "regulated_industry_review_required", "legal", "regulated industry categories require human legal/ad review");
    required_reviews.add("ad_review");
  }

  if (HUMAN_REVIEW_CLAIM_CLASSES.includes(normalized.claim_class) && normalized.claim_class !== "incremental_claim") {
    humanReview(humanReviewReasons, reasons, required_reviews, "claim_review_required", "legal", `${normalized.claim_class} requires human legal/ad review`);
    required_reviews.add("ad_review");
  }

  if (HUMAN_REVIEW_PRIVACY_CLASSES.includes(normalized.privacy_class)) {
    humanReview(humanReviewReasons, reasons, required_reviews, "privacy_review_required", "privacy", `${normalized.privacy_class} requires human privacy review`);
  }

  if (BLOCKED_PRIVACY_CLASSES.includes(normalized.privacy_class)) {
    block(blockers, reasons, "protected_privacy_class_blocked", `${normalized.privacy_class} is blocked until a separate protected gate`);
    protected_gate_required.add("privacy");
  }

  for (const dataSource of normalized.data_source_classes) {
    if (HUMAN_REVIEW_DATA_SOURCE_CLASSES.includes(dataSource)) {
      humanReview(humanReviewReasons, reasons, required_reviews, "external_data_source_review_required", "privacy", `${dataSource} requires human privacy/data-source review`);
    }
    if (BLOCKED_DATA_SOURCE_CLASSES.includes(dataSource)) {
      block(blockers, reasons, "protected_data_source_blocked", `${dataSource} is blocked until a separate protected gate`);
      protected_gate_required.add(dataSource === "camera" ? "privacy" : "ad_network");
    }
  }

  if (normalized.measurement_labels.includes("estimated")) {
    humanReview(humanReviewReasons, reasons, required_reviews, "estimated_label_review_required", "legal", "estimated labels require wording review before external use");
  }

  if (normalized.review_status === "approved" && !normalized.legal_signoff_ref) {
    block(blockers, reasons, "approved_without_signoff_ref_blocked", "approved gate records require legal_signoff_ref evidence");
  }

  if (normalized.reviewer_role && !REVIEWER_ROLES.includes(normalized.reviewer_role)) {
    block(blockers, reasons, "invalid_reviewer_role_blocked", "reviewer_role must be a human owner role; LLMs are not decision authorities");
  }

  if (normalized.reviewer_role && ["llm", "ai", "codex", "codex-audit"].includes(normalized.reviewer_role)) {
    block(blockers, reasons, "llm_cannot_approve", "LLMs cannot approve legal/privacy/ad-review gates");
  }

  if (normalized.review_status === "rejected" || normalized.review_status === "revoked" || normalized.review_status === "expired" || normalized.review_status === "deleted") {
    block(blockers, reasons, `${normalized.review_status}_record_blocked`, `${normalized.review_status} gate records cannot allow use`);
  }

  if (blockers.length > 0) {
    return gateResult(normalized, "block", reasons, {
      blockers,
      required_reviews: [...required_reviews],
      protected_gate_required: [...protected_gate_required]
    });
  }

  if (humanReviewReasons.length > 0) {
    if (hasSatisfiedHumanReview(normalized, required_reviews)) {
      return gateResult(normalized, "allow_with_conditions", reasons, {
        blockers,
        required_reviews: [...required_reviews],
        protected_gate_required: [...protected_gate_required]
      });
    }
    return gateResult(normalized, "human_review_required", reasons, {
      blockers,
      required_reviews: [...required_reviews],
      protected_gate_required: [...protected_gate_required]
    });
  }

  if (!ALLOWED_AUTOMATIC_REVIEW_STATUSES.includes(normalized.review_status) && normalized.review_status !== "approved") {
    return gateResult(normalized, "block", [
      reason("review_status_blocked", "review_status", `${normalized.review_status} cannot allow use`)
    ], {
      blockers: ["review_status_blocked"],
      required_reviews: [],
      protected_gate_required: []
    });
  }

  return gateResult(normalized, "allow", [
    reason("mvp_no_pii_measured_allowed", "policy", "general no-PII measured Misell-source records may pass automatic precheck")
  ], {
    blockers: [],
    required_reviews: [],
    protected_gate_required: []
  });
}

function buildAdLegalPrivacyGateRecord(input = {}, options = {}) {
  const evaluated = evaluateAdLegalPrivacyGate(input);
  const now = cleanString(options.now) || new Date().toISOString();
  const normalized = evaluated.normalized;
  return {
    schema_version: "ad-legal-privacy-gate-record/v1",
    policy_version: POLICY_VERSION,
    gate_record_id: normalized.gate_record_id || cleanId(options.gate_record_id) || "",
    tenant_id: normalized.tenant_id,
    store_id: normalized.store_id,
    screen_group_id: normalized.screen_group_id,
    advertiser_id: normalized.advertiser_id,
    campaign_id: normalized.campaign_id,
    creative_id: normalized.creative_id,
    report_surface_id: normalized.report_surface_id,
    industry_category: normalized.industry_category,
    claim_class: normalized.claim_class,
    privacy_class: normalized.privacy_class,
    data_source_classes: normalized.data_source_classes,
    measurement_labels: normalized.measurement_labels,
    review_status: normalized.review_status,
    verdict: evaluated.verdict,
    reviewer_role: normalized.reviewer_role,
    reviewer_user_id: normalized.reviewer_user_id,
    legal_signoff_ref: normalized.legal_signoff_ref,
    conditions_json: normalized.conditions_json,
    expires_at: normalized.expires_at,
    revoked_at: normalized.revoked_at,
    deleted_at: normalized.deleted_at,
    created_at: normalized.created_at || now,
    updated_at: now,
    evaluation: {
      reasons: evaluated.reasons,
      blockers: evaluated.blockers,
      required_reviews: evaluated.required_reviews,
      protected_gate_required: evaluated.protected_gate_required,
      llm_decision_authority: false,
      legal_advice: false
    }
  };
}

function isMisellOnlyDataSourceClass(value) {
  return MISELL_ONLY_DATA_SOURCE_CLASSES.includes(cleanString(value));
}

function hasSatisfiedHumanReview(normalized, requiredReviews) {
  if (normalized.review_status !== "approved") return false;
  if (!normalized.legal_signoff_ref) return false;
  if (!normalized.reviewer_role || !REVIEWER_ROLES.includes(normalized.reviewer_role)) return false;
  if (["llm", "ai", "codex", "codex-audit"].includes(normalized.reviewer_role)) return false;
  if (!requiredReviews || requiredReviews.size === 0) return true;
  if (requiredReviews.has(normalized.reviewer_role)) return true;
  if (normalized.reviewer_role === "ceo") return true;
  return false;
}

function gateResult(normalized, verdict, reasons, extra) {
  return {
    schema_version: "ad-legal-privacy-gate-evaluation/v1",
    policy_version: POLICY_VERSION,
    verdict,
    allowed: verdict === "allow" || verdict === "allow_with_conditions",
    normalized,
    reasons,
    blockers: extra.blockers || [],
    required_reviews: extra.required_reviews || [],
    protected_gate_required: extra.protected_gate_required || [],
    mvp_defaults: {
      no_pii: true,
      no_camera: true,
      no_sensitive_profiling: true,
      measured_not_promised: true
    },
    legal_advice: false,
    llm_decision_authority: false
  };
}

function requireField(reasons, value, field) {
  if (!value) reasons.push(reason("missing_required_field", field, `${field} is required`));
}

function requireEnum(reasons, value, allowed, field) {
  if (!value) {
    reasons.push(reason("missing_classification", field, `${field} is required`));
    return;
  }
  if (!allowed.includes(value)) {
    reasons.push(reason("invalid_classification", field, `${field} must be one of ${allowed.join(", ")}`));
  }
}

function requireNonEmptyEnumList(reasons, values, allowed, field) {
  if (!Array.isArray(values) || values.length === 0) {
    reasons.push(reason("missing_classification", field, `${field} must include at least one value`));
    return;
  }
  for (const value of values) {
    if (!allowed.includes(value)) {
      reasons.push(reason("invalid_classification", field, `${field} contains unsupported value ${value}`));
    }
  }
}

function humanReview(humanReviewReasons, reasons, requiredReviews, code, reviewerRole, message) {
  humanReviewReasons.push(code);
  reasons.push(reason(code, reviewerRole, message));
  requiredReviews.add(reviewerRole);
}

function block(blockers, reasons, code, message) {
  blockers.push(code);
  reasons.push(reason(code, "policy", message));
}

function reason(code, field, message) {
  return { code, field, message };
}

function normalizeStringList(value) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((entry) => cleanString(entry)).filter(Boolean))];
}

function normalizeStructuredValue(value) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeStructuredValue(parsed);
    } catch {
      return { note: cleanString(value).slice(0, 1000) };
    }
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeStructuredValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [cleanString(key).slice(0, 80), normalizeStructuredValue(child)])
    );
  }
  return {};
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 160);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim().replace(/\0/g, "") : "";
}

module.exports = {
  POLICY_VERSION,
  INDUSTRY_CATEGORIES,
  CLAIM_CLASSES,
  PRIVACY_CLASSES,
  DATA_SOURCE_CLASSES,
  MEASUREMENT_LABELS,
  REVIEW_STATUSES,
  GATE_VERDICTS,
  REVIEWER_ROLES,
  REGULATED_INDUSTRY_CATEGORIES,
  MISELL_ONLY_DATA_SOURCE_CLASSES,
  normalizeAdLegalPrivacyGateInput,
  evaluateAdLegalPrivacyGate,
  buildAdLegalPrivacyGateRecord,
  isMisellOnlyDataSourceClass
};
