"use strict";

// Contract helpers for #145 AI proposal context sources.
// This module is intentionally side-effect free so server routes, UI code, and smoke
// tests can share the same vocabulary before external AI/document processing is added.

const CONTEXT_CATEGORIES = Object.freeze([
  "customer_profile",
  "internal_notes",
  "market_signal",
  "operation_summary",
  "proposal_feedback",
  "asset_source",
  "collaboration_signal"
]);

const VISIBILITY_SCOPES = Object.freeze([
  "customer_visible",
  "operator_internal",
  "system_internal",
  "partner_limited"
]);

const SOURCE_OWNERS = Object.freeze([
  "customer",
  "misell_operator",
  "system",
  "partner",
  "external_reference"
]);

const SOURCE_TYPES = Object.freeze([
  "operator_input",
  "customer_input",
  "imported",
  "report_summary",
  "system_generated",
  "asset_upload"
]);

const CONFIDENCE_LEVELS = Object.freeze([
  "customer_confirmed",
  "operator_confirmed",
  "operator_observed",
  "market_reference",
  "system_aggregated",
  "inferred",
  "stale",
  "expired"
]);

const CONTEXT_RECORD_STATUSES = Object.freeze([
  "active",
  "archived",
  "deleted"
]);

const COST_OWNERS = Object.freeze([
  "included_monthly",
  "customer_credit",
  "misell_ops",
  "trial_grant",
  "manual_no_ai"
]);

const DOCUMENT_PROCESSING_STATUSES = Object.freeze([
  "manual_no_ai",
  "not_requested",
  "pending",
  "processing",
  "completed",
  "failed",
  "blocked_external_ai"
]);

const CONTEXT_SOURCE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const CONTEXT_SOURCE_PDF_MAX_BYTES = 100 * 1024 * 1024;

const CONTEXT_SOURCE_ASSET_EXTENSIONS = Object.freeze([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf"
]);

const CONTEXT_SOURCE_ASSET_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

const CONTEXT_SOURCE_ASSET_MIME_BY_EXTENSION = Object.freeze({
  ".jpg": Object.freeze(["image/jpeg"]),
  ".jpeg": Object.freeze(["image/jpeg"]),
  ".png": Object.freeze(["image/png"]),
  ".webp": Object.freeze(["image/webp"]),
  ".pdf": Object.freeze(["application/pdf"])
});

function assertContextContract(input, options = {}) {
  const normalized = normalizeContextContract(input, options);
  assertEnum("context_category", normalized.context_category, CONTEXT_CATEGORIES);
  assertEnum("visibility_scope", normalized.visibility_scope, VISIBILITY_SCOPES);
  assertEnum("source_owner", normalized.source_owner, SOURCE_OWNERS);
  assertEnum("source_type", normalized.source_type, SOURCE_TYPES);
  assertEnum("confidence", normalized.confidence, CONFIDENCE_LEVELS);
  assertEnum("status", normalized.status, CONTEXT_RECORD_STATUSES);
  if (options.customerInput) assertCustomerWritableContext(normalized);
  return normalized;
}

function normalizeContextContract(input, options = {}) {
  const sourceOwner = cleanString(input?.source_owner || input?.sourceOwner || (options.customerInput ? "customer" : "misell_operator"));
  return {
    context_category: cleanString(input?.context_category || input?.contextCategory || "customer_profile"),
    visibility_scope: cleanString(input?.visibility_scope || input?.visibilityScope || (options.customerInput ? "customer_visible" : "operator_internal")),
    source_owner: sourceOwner,
    source_type: cleanString(input?.source_type || input?.sourceType || (sourceOwner === "customer" ? "customer_input" : "operator_input")),
    confidence: cleanString(input?.confidence || (sourceOwner === "customer" ? "customer_confirmed" : "operator_observed")),
    item_type: cleanId(input?.item_type || input?.itemType || "context_note"),
    item_key: cleanId(input?.item_key || input?.itemKey || input?.key || "note"),
    value_json: input?.value_json || input?.valueJson || input?.value || {},
    status: cleanString(input?.status || "active")
  };
}

function assertCustomerWritableContext(context) {
  if (context.visibility_scope !== "customer_visible") {
    throw new Error("customer context input must use visibility_scope=customer_visible");
  }
  if (context.source_owner !== "customer") {
    throw new Error("customer context input must use source_owner=customer");
  }
  if (context.source_type !== "customer_input" && context.source_type !== "asset_upload") {
    throw new Error("customer context input must use source_type=customer_input or asset_upload");
  }
}

function canCustomerReadContext(session, context) {
  if (!session || !context) return false;
  if (cleanId(session.tenant_id) !== cleanId(context.tenant_id)) return false;
  const storeIds = Array.isArray(session.store_ids) ? session.store_ids.map(cleanId).filter(Boolean) : [];
  if (storeIds.length > 0 && !storeIds.includes(cleanId(context.store_id))) return false;
  const contextScreenGroupId = cleanId(context.screen_group_id || context.screenGroupId);
  if (!contextScreenGroupId) return false;
  const screenGroupIds = normalizedSessionScreenGroupIds(session);
  if (!screenGroupIds.includes(contextScreenGroupId)) return false;
  return cleanString(context.visibility_scope) === "customer_visible";
}

function assertContextSourceAssetContract(input) {
  const extension = normalizeExtension(input?.extension || input?.filename || input?.original_name || input?.originalName || input?.path);
  const mimeType = cleanString(input?.mime_type || input?.mimeType);
  const sizeBytes = normalizeSizeBytes(input?.size_bytes ?? input?.sizeBytes ?? input?.size);
  if (!CONTEXT_SOURCE_ASSET_EXTENSIONS.includes(extension)) {
    throw new Error(`context source asset extension is not allowed: ${extension || "missing"}`);
  }
  const allowedMimes = CONTEXT_SOURCE_ASSET_MIME_BY_EXTENSION[extension] || [];
  if (!mimeType) {
    throw new Error("context source asset mime_type is required");
  }
  if (!allowedMimes.includes(mimeType)) {
    throw new Error(`context source asset mime_type must match ${extension}: ${mimeType}`);
  }
  assertNoAutomaticExternalAi(input);
  const extractionStatus = cleanString(input?.extraction_status || input?.extractionStatus || "manual_no_ai");
  if (extractionStatus !== "manual_no_ai") {
    throw new Error("context source asset extraction_status must be manual_no_ai in the #145 context source slice");
  }
  const sourceOwner = cleanString(input?.source_owner || input?.sourceOwner || "customer");
  const visibilityScope = cleanString(input?.visibility_scope || input?.visibilityScope || "customer_visible");
  assertEnum("source_owner", sourceOwner, SOURCE_OWNERS);
  assertEnum("visibility_scope", visibilityScope, VISIBILITY_SCOPES);
  const maxSizeBytes = maxContextSourceAssetBytes(extension, mimeType);
  if (sizeBytes > maxSizeBytes) {
    throw new Error(`context source asset size exceeds limit: ${sizeBytes} > ${maxSizeBytes}`);
  }
  return {
    asset_id: cleanId(input?.asset_id || input?.assetId),
    context_item_id: cleanId(input?.context_item_id || input?.contextItemId),
    tenant_id: cleanId(input?.tenant_id || input?.tenantId),
    store_id: cleanId(input?.store_id || input?.storeId),
    screen_group_id: cleanId(input?.screen_group_id || input?.screenGroupId),
    source_owner: sourceOwner,
    visibility_scope: visibilityScope,
    usage_notes: cleanString(input?.usage_notes || input?.usageNotes).slice(0, 4000),
    extraction_status: extractionStatus,
    extension,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    max_size_bytes: maxSizeBytes
  };
}

function buildContextSnapshotSourceSummary(contextItems, sourceAssets) {
  const assetsByContext = new Map();
  for (const asset of sourceAssets || []) {
    const contextItemId = cleanId(asset.context_item_id || asset.contextItemId);
    if (!contextItemId) continue;
    if (!assetsByContext.has(contextItemId)) assetsByContext.set(contextItemId, []);
    assetsByContext.get(contextItemId).push({
      asset_id: cleanId(asset.asset_id || asset.assetId),
      usage_notes: cleanString(asset.usage_notes || asset.usageNotes),
      extraction_status: cleanString(asset.extraction_status || asset.extractionStatus || "manual_no_ai"),
      external_ai_used: Boolean(asset.external_ai_used || asset.externalAiUsed)
    });
  }
  return (contextItems || []).map((item) => ({
    customer_context_item_id: cleanId(item.customer_context_item_id || item.customerContextItemId),
    context_category: cleanString(item.context_category || item.contextCategory),
    visibility_scope: cleanString(item.visibility_scope || item.visibilityScope),
    source_owner: cleanString(item.source_owner || item.sourceOwner),
    source_type: cleanString(item.source_type || item.sourceType),
    confidence: cleanString(item.confidence),
    item_type: cleanString(item.item_type || item.itemType),
    item_key: cleanString(item.item_key || item.itemKey),
    value_json: item.value_json || item.valueJson || item.value || {},
    source_assets: assetsByContext.get(cleanId(item.customer_context_item_id || item.customerContextItemId)) || []
  }));
}

function normalizeCostOwner(value, fallback = "manual_no_ai") {
  const normalized = cleanString(value || fallback);
  if (!COST_OWNERS.includes(normalized)) throw new Error(`cost_owner must be one of: ${COST_OWNERS.join(", ")}`);
  return normalized;
}

function assertNoAutomaticExternalAi(input) {
  if (input?.external_ai_used || input?.externalAiUsed) throw new Error("external AI is not allowed in the #145 context source slice");
  if (input?.extraction_status === "processing" || input?.extractionStatus === "processing") {
    throw new Error("automatic document processing is not allowed in the #145 context source slice");
  }
}

function assertEnum(name, value, allowed) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

function normalizeExtension(value) {
  const raw = cleanString(value).toLowerCase();
  if (!raw) return "";
  const last = raw.includes(".") ? raw.slice(raw.lastIndexOf(".")) : `.${raw}`;
  return last.replace(/[^a-z0-9.]/g, "");
}

function maxContextSourceAssetBytes(extension, mimeType = "") {
  if (extension === ".pdf" || mimeType === "application/pdf") return CONTEXT_SOURCE_PDF_MAX_BYTES;
  return CONTEXT_SOURCE_IMAGE_MAX_BYTES;
}

function normalizeSizeBytes(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("context source asset size_bytes must be a non-negative safe integer");
  return number;
}

function normalizedSessionScreenGroupIds(session) {
  const values = [];
  if (Array.isArray(session?.screen_group_ids)) values.push(...session.screen_group_ids);
  if (Array.isArray(session?.screenGroupIds)) values.push(...session.screenGroupIds);
  if (session?.screen_group_id) values.push(session.screen_group_id);
  if (session?.screenGroupId) values.push(session.screenGroupId);
  return values.map(cleanId).filter(Boolean);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
}

module.exports = {
  CONTEXT_CATEGORIES,
  VISIBILITY_SCOPES,
  SOURCE_OWNERS,
  SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  CONTEXT_RECORD_STATUSES,
  COST_OWNERS,
  DOCUMENT_PROCESSING_STATUSES,
  CONTEXT_SOURCE_IMAGE_MAX_BYTES,
  CONTEXT_SOURCE_PDF_MAX_BYTES,
  CONTEXT_SOURCE_ASSET_EXTENSIONS,
  CONTEXT_SOURCE_ASSET_MIME_TYPES,
  CONTEXT_SOURCE_ASSET_MIME_BY_EXTENSION,
  assertContextContract,
  normalizeContextContract,
  assertCustomerWritableContext,
  canCustomerReadContext,
  assertContextSourceAssetContract,
  buildContextSnapshotSourceSummary,
  normalizeCostOwner,
  assertNoAutomaticExternalAi,
  maxContextSourceAssetBytes
};
