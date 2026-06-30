"use strict";

// Contract helpers for #211 Studio Execution B1.
// This layer models mock/manual generation jobs and asset provenance only.
// It must not call external providers, read secrets, consume credits, publish,
// create content manifests, or depend on MCP runtime tooling.

const crypto = require("crypto");

const PROVIDER_CONTRACT_VERSION = "studio-provider-job-b1-v1";
const PROVIDER_IDS = Object.freeze(["manual_upload", "mock_provider"]);
const PROVIDER_CAPABILITIES = Object.freeze([
  "manual_upload",
  "mock_fixture",
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
  "reference_only"
]);
const PROVIDER_CAPABILITIES_BY_ID = Object.freeze({
  manual_upload: ["manual_upload", "reference_only"],
  mock_provider: ["mock_fixture", "text_to_image", "image_to_image", "text_to_video", "image_to_video", "reference_only"]
});
const ASSET_ROLES = Object.freeze(["background", "b_roll", "atmosphere", "stock_like_insert", "reference_only"]);
const GENERATION_JOB_STATUSES = Object.freeze([
  "queued",
  "running",
  "asset_review_required",
  "succeeded",
  "failed",
  "timeout",
  "needs_operator_review",
  "failed_terminal"
]);
const TERMINAL_GENERATION_JOB_STATUSES = Object.freeze(["succeeded", "failed_terminal"]);
const ERROR_CLASSES = Object.freeze([
  "quota_exceeded",
  "timeout",
  "network_error",
  "provider_rejected",
  "content_policy_rejected",
  "asset_download_failed",
  "qa_failed",
  "unknown_provider_error"
]);
const ASSET_SOURCE_TYPES = Object.freeze([
  "user_upload",
  "generated",
  "stock",
  "template",
  "partner_provided",
  "advertiser_provided",
  "manual_upload",
  "mock_fixture"
]);
const LICENSE_STATUSES = Object.freeze([
  "unknown",
  "customer_provided",
  "partner_approved",
  "generated_terms_checked",
  "stock_license_confirmed",
  "internal_only"
]);
const RIGHTS_REVIEW_STATUSES = Object.freeze([
  "draft",
  "asset_review_required",
  "approved",
  "rejected",
  "revoked",
  "expired"
]);

const FORBIDDEN_INPUT_KEYS = new Set([
  "api_key",
  "apikey",
  "authorization",
  "bearer_token",
  "client_secret",
  "content_manifest_id",
  "credit_ledger",
  "mcp_runtime",
  "mcp_runtime_dependency",
  "openai_api_key",
  "paid_provider_call",
  "password",
  "publish",
  "schedule_activation",
  "secret",
  "token",
  "webhook_secret"
]);
const REAL_PROVIDER_IDS = new Set([
  "fal",
  "replicate",
  "higgsfield",
  "minimax",
  "runway",
  "veo",
  "sora",
  "kling",
  "seedance",
  "luma",
  "openai_sora",
  "google_veo",
  "local_comfyui"
]);

function defaultProviderCatalog(now = "") {
  return [
    {
      provider_id: "manual_upload",
      provider_type: "manual",
      display_name: "Manual upload",
      capabilities: PROVIDER_CAPABILITIES_BY_ID.manual_upload,
      external_network_allowed: false,
      secrets_required: false,
      mcp_runtime_dependency: false,
      status: "active",
      created_at: now,
      updated_at: now
    },
    {
      provider_id: "mock_provider",
      provider_type: "mock",
      display_name: "Mock provider",
      capabilities: PROVIDER_CAPABILITIES_BY_ID.mock_provider,
      external_network_allowed: false,
      secrets_required: false,
      mcp_runtime_dependency: false,
      status: "active",
      created_at: now,
      updated_at: now
    }
  ];
}

function assertStudioB1InputBoundary(input) {
  const walk = (value, pathLabel = "") => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${pathLabel}[${index}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (FORBIDDEN_INPUT_KEYS.has(normalizedKey)) {
        throw new Error(`${pathLabel ? `${pathLabel}.` : ""}${key} is out of scope for Studio Execution B1`);
      }
      if (normalizedKey === "external_provider_call" && Boolean(child)) {
        throw new Error("external provider calls are out of scope for Studio Execution B1");
      }
      if (normalizedKey === "external_ai_used" && Boolean(child)) {
        throw new Error("external AI is out of scope for Studio Execution B1");
      }
      if (normalizedKey === "content_manifest_created" && Boolean(child)) {
        throw new Error("content_manifest creation is out of scope for Studio Execution B1");
      }
      if (normalizedKey === "credit_consumed" && Boolean(child)) {
        throw new Error("credit consumption is out of scope for Studio Execution B1");
      }
      if ((normalizedKey === "provider_id" || normalizedKey === "generated_by_provider") && REAL_PROVIDER_IDS.has(stringValue(child))) {
        throw new Error(`${child} provider integration is out of scope for Studio Execution B1`);
      }
      walk(child, pathLabel ? `${pathLabel}.${key}` : key);
    }
  };
  walk(input);
}

function buildGenerationJobContract(input = {}, options = {}) {
  assertStudioB1InputBoundary(input);
  const providerId = normalizeProviderId(input.provider_id || input.providerId || options.provider_id || "mock_provider");
  const capability = normalizeCapability(input.capability || options.capability || (providerId === "manual_upload" ? "manual_upload" : "mock_fixture"), providerId);
  const requestedAssetRole = normalizeAssetRole(input.requested_asset_role || input.requestedAssetRole || "background");
  const idempotencyKey = boundedString(input.idempotency_key || input.idempotencyKey || options.idempotency_key, 180);
  if (!idempotencyKey) throw new Error("idempotency_key is required");
  const inputSnapshot = normalizeInputSnapshot(input.input_snapshot || input.inputSnapshot || {
    prompt: boundedString(input.prompt || "", 2000),
    reference_asset_ids: normalizeIdList(input.reference_asset_ids || input.referenceAssetIds),
    requested_asset_role: requestedAssetRole,
    capability,
    provider_id: providerId
  });
  const referenceAssetIds = normalizeIdList(input.reference_asset_ids || input.referenceAssetIds || inputSnapshot.reference_asset_ids);
  const prompt = boundedString(input.prompt || inputSnapshot.prompt || "", 2000);
  const inputSha256 = sha256Hex(stableStringify({
    provider_id: providerId,
    capability,
    requested_asset_role: requestedAssetRole,
    input_snapshot: inputSnapshot,
    reference_asset_ids: referenceAssetIds
  }));
  return {
    schema_version: "studio-generation-job/b1",
    ai_generation_job_id: boundedString(input.ai_generation_job_id || input.aiGenerationJobId || options.ai_generation_job_id, 120),
    tenant_id: boundedString(input.tenant_id || input.tenantId || options.tenant_id, 120),
    store_id: boundedString(input.store_id || input.storeId || options.store_id, 120),
    screen_group_id: boundedString(input.screen_group_id || input.screenGroupId || options.screen_group_id, 120),
    campaign_project_id: boundedString(input.campaign_project_id || input.campaignProjectId || options.campaign_project_id, 120),
    campaign_project_revision: integerValue(input.campaign_project_revision || input.campaignProjectRevision || options.campaign_project_revision, 1),
    campaign_project_scene_id: boundedString(input.campaign_project_scene_id || input.campaignProjectSceneId || options.campaign_project_scene_id, 120),
    requested_asset_role: requestedAssetRole,
    provider_id: providerId,
    provider_model: boundedString(input.provider_model || input.providerModel || `${providerId}-b1`, 120),
    capability,
    input_snapshot: inputSnapshot,
    input_sha256: inputSha256,
    prompt_hash: prompt ? sha256Hex(prompt) : "",
    reference_asset_ids: referenceAssetIds,
    idempotency_key: idempotencyKey,
    status: "queued",
    error_class: "",
    error_message: "",
    provider_job_id: "",
    output_asset_id: boundedString(input.output_asset_id || input.outputAssetId || "", 160),
    cost_estimate_units: 0,
    cost_actual_units: null,
    actor_type: boundedString(input.actor_type || input.actorType || options.actor_type || "operator", 80),
    actor_id: boundedString(input.actor_id || input.actorId || options.actor_id || "admin", 120),
    retry_count: 0,
    max_retries: boundedInteger(input.max_retries ?? input.maxRetries ?? options.max_retries ?? 1, 0, 3),
    no_external_provider_call: true,
    no_paid_provider_call: true,
    no_mcp_runtime_dependency: true,
    no_secret_material: true,
    no_credit_consumption: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
}

function validateGenerationJobContract(job = {}) {
  const errors = [];
  if (!stringValue(job.tenant_id)) pushError(errors, "tenant_id", "required", "tenant_id is required");
  if (!stringValue(job.store_id)) pushError(errors, "store_id", "required", "store_id is required");
  if (!stringValue(job.screen_group_id)) pushError(errors, "screen_group_id", "required", "screen_group_id is required");
  if (!stringValue(job.idempotency_key)) pushError(errors, "idempotency_key", "required", "idempotency_key is required");
  if (!PROVIDER_IDS.includes(stringValue(job.provider_id))) pushError(errors, "provider_id", "unsupported", "B1 only supports manual_upload and mock_provider");
  if (!PROVIDER_CAPABILITIES.includes(stringValue(job.capability))) pushError(errors, "capability", "unsupported", "capability is not supported");
  if (!ASSET_ROLES.includes(stringValue(job.requested_asset_role))) pushError(errors, "requested_asset_role", "unsupported", "requested_asset_role is not supported");
  if (!GENERATION_JOB_STATUSES.includes(stringValue(job.status))) pushError(errors, "status", "unsupported", "status is not supported");
  if (stringValue(job.error_class) && !ERROR_CLASSES.includes(stringValue(job.error_class))) {
    pushError(errors, "error_class", "unsupported", "error_class is not supported");
  }
  if (job.no_external_provider_call !== true) pushError(errors, "no_external_provider_call", "required", "external provider calls are not allowed in B1");
  if (job.no_paid_provider_call !== true) pushError(errors, "no_paid_provider_call", "required", "paid provider calls are not allowed in B1");
  if (job.no_mcp_runtime_dependency !== true) pushError(errors, "no_mcp_runtime_dependency", "required", "Cloud runtime must not depend on MCP tools in B1");
  if (job.no_credit_consumption !== true) pushError(errors, "no_credit_consumption", "required", "B1 must not consume credits");
  if (job.no_content_manifest_creation !== true) pushError(errors, "no_content_manifest_creation", "required", "B1 must not create content manifests");
  if (job.no_publish !== true) pushError(errors, "no_publish", "required", "B1 must not publish");
  return { valid: errors.length === 0, errors };
}

function buildAssetProvenanceContract(input = {}, options = {}) {
  assertStudioB1InputBoundary(input);
  const sourceType = normalizeSourceType(input.source_type || input.sourceType || options.source_type || "mock_fixture");
  const generatedByProvider = boundedString(input.generated_by_provider || input.generatedByProvider || options.generated_by_provider || "", 120);
  if (generatedByProvider && !PROVIDER_IDS.includes(generatedByProvider)) {
    throw new Error("B1 provenance only supports mock_provider/manual_upload generated_by_provider");
  }
  const rightsReviewStatus = normalizeRightsReviewStatus(
    input.rights_review_status || input.rightsReviewStatus || options.rights_review_status || defaultRightsReviewStatus(sourceType)
  );
  const licenseStatus = normalizeLicenseStatus(input.license_status || input.licenseStatus || options.license_status || defaultLicenseStatus(sourceType));
  return {
    schema_version: "studio-asset-provenance/b1",
    asset_provenance_id: boundedString(input.asset_provenance_id || input.assetProvenanceId || options.asset_provenance_id, 120),
    asset_id: boundedString(input.asset_id || input.assetId || options.asset_id, 160),
    tenant_id: boundedString(input.tenant_id || input.tenantId || options.tenant_id, 120),
    store_id: boundedString(input.store_id || input.storeId || options.store_id, 120),
    screen_group_id: boundedString(input.screen_group_id || input.screenGroupId || options.screen_group_id, 120),
    campaign_project_id: boundedString(input.campaign_project_id || input.campaignProjectId || options.campaign_project_id, 120),
    ai_generation_job_id: boundedString(input.ai_generation_job_id || input.aiGenerationJobId || options.ai_generation_job_id, 120),
    source_type: sourceType,
    license_status: licenseStatus,
    commercial_use_allowed: Boolean(input.commercial_use_allowed ?? input.commercialUseAllowed ?? options.commercial_use_allowed ?? false),
    rights_review_status: rightsReviewStatus,
    generated_by_provider: generatedByProvider,
    provider_model: boundedString(input.provider_model || input.providerModel || options.provider_model || "", 120),
    provider_job_id: boundedString(input.provider_job_id || input.providerJobId || options.provider_job_id || "", 160),
    prompt_hash: boundedString(input.prompt_hash || input.promptHash || options.prompt_hash || "", 160),
    reference_asset_ids: normalizeIdList(input.reference_asset_ids || input.referenceAssetIds || options.reference_asset_ids),
    source_asset_ids: normalizeIdList(input.source_asset_ids || input.sourceAssetIds || options.source_asset_ids),
    created_by_actor_type: boundedString(input.created_by_actor_type || input.createdByActorType || options.created_by_actor_type || "operator", 80),
    created_by_actor_id: boundedString(input.created_by_actor_id || input.createdByActorId || options.created_by_actor_id || "admin", 120),
    reviewed_by_actor_id: boundedString(input.reviewed_by_actor_id || input.reviewedByActorId || options.reviewed_by_actor_id || "", 120),
    review_notes: boundedString(input.review_notes || input.reviewNotes || options.review_notes || "", 2000),
    publish_candidate_allowed: false,
    no_external_provider_call: true,
    no_secret_material: true,
    no_credit_consumption: true,
    no_content_manifest_creation: true,
    no_publish: true
  };
}

function validateAssetProvenanceContract(provenance = {}) {
  const errors = [];
  if (!stringValue(provenance.asset_id)) pushError(errors, "asset_id", "required", "asset_id is required");
  if (!stringValue(provenance.tenant_id)) pushError(errors, "tenant_id", "required", "tenant_id is required");
  if (!stringValue(provenance.store_id)) pushError(errors, "store_id", "required", "store_id is required");
  if (!stringValue(provenance.screen_group_id)) pushError(errors, "screen_group_id", "required", "screen_group_id is required");
  if (!ASSET_SOURCE_TYPES.includes(stringValue(provenance.source_type))) pushError(errors, "source_type", "unsupported", "source_type is not supported");
  if (!LICENSE_STATUSES.includes(stringValue(provenance.license_status))) pushError(errors, "license_status", "unsupported", "license_status is not supported");
  if (!RIGHTS_REVIEW_STATUSES.includes(stringValue(provenance.rights_review_status))) pushError(errors, "rights_review_status", "unsupported", "rights_review_status is not supported");
  if (stringValue(provenance.generated_by_provider) && !PROVIDER_IDS.includes(stringValue(provenance.generated_by_provider))) {
    pushError(errors, "generated_by_provider", "unsupported", "B1 only permits manual_upload/mock_provider provenance");
  }
  if (provenance.publish_candidate_allowed === true && !canAssetEnterPublishCandidate(provenance)) {
    pushError(errors, "publish_candidate_allowed", "not_allowed", "asset provenance is not publish-candidate eligible");
  }
  return { valid: errors.length === 0, errors };
}

function canAssetEnterPublishCandidate(provenance = {}) {
  if (stringValue(provenance.rights_review_status) !== "approved") return false;
  if (provenance.commercial_use_allowed !== true) return false;
  const licenseStatus = stringValue(provenance.license_status);
  const sourceType = stringValue(provenance.source_type);
  if (sourceType === "generated") return licenseStatus === "generated_terms_checked";
  if (sourceType === "stock") return licenseStatus === "stock_license_confirmed";
  if (sourceType === "partner_provided" || sourceType === "advertiser_provided") return licenseStatus === "partner_approved";
  if (sourceType === "user_upload" || sourceType === "manual_upload") return licenseStatus === "customer_provided";
  return sourceType === "template" && licenseStatus === "internal_only";
}

function normalizeJobTransition(currentStatus, input = {}) {
  const status = stringValue(input.status || input.next_status || input.nextStatus);
  if (!GENERATION_JOB_STATUSES.includes(status)) throw new Error("next status is not supported");
  if (TERMINAL_GENERATION_JOB_STATUSES.includes(stringValue(currentStatus))) {
    throw new Error("terminal generation jobs cannot be transitioned");
  }
  const allowed = allowedNextStatuses(currentStatus);
  if (!allowed.includes(status)) throw new Error(`cannot transition generation job from ${currentStatus} to ${status}`);
  return {
    status,
    error_class: normalizeErrorClass(input.error_class || input.errorClass || ""),
    error_message: boundedString(input.error_message || input.errorMessage || "", 1000),
    provider_job_id: boundedString(input.provider_job_id || input.providerJobId || "", 160),
    output_asset_id: boundedString(input.output_asset_id || input.outputAssetId || "", 160),
    retry_increment: Boolean(input.retry_increment || input.retryIncrement)
  };
}

function allowedNextStatuses(currentStatus) {
  switch (stringValue(currentStatus)) {
    case "queued":
      return ["running", "failed", "timeout", "needs_operator_review", "failed_terminal"];
    case "running":
      return ["asset_review_required", "succeeded", "failed", "timeout", "needs_operator_review", "failed_terminal"];
    case "asset_review_required":
      return ["succeeded", "failed", "needs_operator_review", "failed_terminal"];
    case "failed":
    case "timeout":
    case "needs_operator_review":
      return ["running", "failed_terminal"];
    default:
      return [];
  }
}

function normalizeProviderId(value) {
  const providerId = stringValue(value);
  if (REAL_PROVIDER_IDS.has(providerId)) throw new Error(`${providerId} provider integration is out of scope for Studio Execution B1`);
  if (!PROVIDER_IDS.includes(providerId)) throw new Error("provider_id must be manual_upload or mock_provider");
  return providerId;
}

function normalizeCapability(value, providerId) {
  const capability = stringValue(value);
  if (!PROVIDER_CAPABILITIES.includes(capability)) throw new Error("capability is not supported by Studio Execution B1");
  if (!PROVIDER_CAPABILITIES_BY_ID[providerId]?.includes(capability)) {
    throw new Error(`${capability} is not supported by ${providerId}`);
  }
  return capability;
}

function normalizeAssetRole(value) {
  const role = stringValue(value);
  if (!ASSET_ROLES.includes(role)) throw new Error("requested_asset_role is not supported by Studio Execution B1");
  return role;
}

function normalizeSourceType(value) {
  const sourceType = stringValue(value);
  if (!ASSET_SOURCE_TYPES.includes(sourceType)) throw new Error("source_type is not supported");
  return sourceType;
}

function normalizeLicenseStatus(value) {
  const status = stringValue(value);
  if (!LICENSE_STATUSES.includes(status)) throw new Error("license_status is not supported");
  return status;
}

function normalizeRightsReviewStatus(value) {
  const status = stringValue(value);
  if (!RIGHTS_REVIEW_STATUSES.includes(status)) throw new Error("rights_review_status is not supported");
  return status;
}

function normalizeErrorClass(value) {
  const errorClass = stringValue(value);
  if (!errorClass) return "";
  if (!ERROR_CLASSES.includes(errorClass)) throw new Error("error_class is not supported");
  return errorClass;
}

function defaultRightsReviewStatus(sourceType) {
  if (sourceType === "template" || sourceType === "mock_fixture") return "approved";
  return "asset_review_required";
}

function defaultLicenseStatus(sourceType) {
  if (sourceType === "template" || sourceType === "mock_fixture") return "internal_only";
  if (sourceType === "user_upload" || sourceType === "manual_upload") return "customer_provided";
  if (sourceType === "generated") return "unknown";
  return "unknown";
}

function normalizeInputSnapshot(value) {
  assertStudioB1InputBoundary(value);
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") return { text: boundedString(value, 2000) };
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;
  return { value };
}

function normalizeIdList(value) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => boundedString(entry, 160)).filter(Boolean).slice(0, 50);
}

function pushError(errors, field, code, message) {
  errors.push({ field, code, message, severity: "block" });
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stringValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function boundedString(value, maxLength) {
  return stringValue(value).slice(0, maxLength);
}

function integerValue(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
}

function boundedInteger(value, min, max) {
  const number = integerValue(value, min);
  return Math.max(min, Math.min(max, number));
}

function normalizeKey(key) {
  return stringValue(key).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

module.exports = {
  PROVIDER_CONTRACT_VERSION,
  PROVIDER_IDS,
  PROVIDER_CAPABILITIES,
  PROVIDER_CAPABILITIES_BY_ID,
  ASSET_ROLES,
  GENERATION_JOB_STATUSES,
  ERROR_CLASSES,
  ASSET_SOURCE_TYPES,
  LICENSE_STATUSES,
  RIGHTS_REVIEW_STATUSES,
  defaultProviderCatalog,
  assertStudioB1InputBoundary,
  buildGenerationJobContract,
  validateGenerationJobContract,
  buildAssetProvenanceContract,
  validateAssetProvenanceContract,
  canAssetEnterPublishCandidate,
  normalizeJobTransition
};
