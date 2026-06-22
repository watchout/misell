import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CONTEXT_RECORD_STATUSES,
  CONTEXT_SOURCE_ASSET_EXTENSIONS,
  CONTEXT_SOURCE_IMAGE_MAX_BYTES,
  CONTEXT_SOURCE_ASSET_MIME_TYPES,
  CONTEXT_SOURCE_PDF_MAX_BYTES,
  assertContextContract,
  assertContextSourceAssetContract,
  assertNoAutomaticExternalAi,
  buildContextSnapshotSourceSummary,
  canCustomerReadContext,
  normalizeCostOwner
} = require("../lib/ai-campaign-context-contract.js");

const session = {
  tenant_id: "TEN-CTX",
  store_ids: ["STO-CTX"],
  role: "customer_editor"
};

const customerContext = assertContextContract({
  tenant_id: "TEN-CTX",
  store_id: "STO-CTX",
  screen_group_id: "SG-CTX",
  context_category: "asset_source",
  visibility_scope: "customer_visible",
  source_owner: "customer",
  source_type: "customer_input",
  confidence: "customer_confirmed",
  item_type: "menu_pdf",
  item_key: "summer_menu",
  value: {
    summary: "夏メニューの推し商品。自動OCRは使わず顧客が手入力した要約。",
    usage_notes: "価格訴求は公開前に確認する"
  }
}, { customerInput: true });

assert(canCustomerReadContext(session, {
  tenant_id: "TEN-CTX",
  store_id: "STO-CTX",
  visibility_scope: customerContext.visibility_scope
}), "customer_visible context should be customer-readable inside scope");

assert(!canCustomerReadContext(session, {
  tenant_id: "TEN-CTX",
  store_id: "STO-CTX",
  visibility_scope: "operator_internal"
}), "operator_internal context must not be customer-readable");

assert(!canCustomerReadContext(session, {
  tenant_id: "TEN-OTHER",
  store_id: "STO-CTX",
  visibility_scope: "customer_visible"
}), "cross-tenant context must not be customer-readable");

const pdfAsset = assertContextSourceAssetContract({
  context_item_id: "ctx-summer-menu",
  asset_id: "asset-summer-menu-pdf",
  tenant_id: "TEN-CTX",
  store_id: "STO-CTX",
  screen_group_id: "SG-CTX",
  filename: "summer-menu.pdf",
  mime_type: "application/pdf",
  size_bytes: CONTEXT_SOURCE_PDF_MAX_BYTES,
  source_owner: "customer",
  visibility_scope: "customer_visible",
  usage_notes: "夏メニューPDF。要約は手入力。",
  extraction_status: "manual_no_ai"
});

const imageAsset = assertContextSourceAssetContract({
  context_item_id: "ctx-logo",
  asset_id: "asset-logo-png",
  tenant_id: "TEN-CTX",
  store_id: "STO-CTX",
  screen_group_id: "SG-CTX",
  filename: "brand-logo.png",
  mime_type: "image/png",
  size_bytes: CONTEXT_SOURCE_IMAGE_MAX_BYTES,
  usage_notes: "ロゴ利用可。余白を確保する。",
  extraction_status: "manual_no_ai"
});

expectError(() => assertContextSourceAssetContract({ filename: "unsafe.exe", mime_type: "application/octet-stream" }), "extension");
expectError(() => assertContextSourceAssetContract({ filename: "unsafe.svg", mime_type: "image/svg+xml" }), "extension");
expectError(() => assertContextSourceAssetContract({ filename: "source.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "extension");
expectError(() => assertContextSourceAssetContract({ filename: "deck.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), "extension");
expectError(() => assertContextSourceAssetContract({ filename: "notes.txt", mime_type: "text/plain" }), "extension");
expectError(() => assertContextSourceAssetContract({ filename: "too-large.pdf", mime_type: "application/pdf", size_bytes: CONTEXT_SOURCE_PDF_MAX_BYTES + 1 }), "size");
expectError(() => assertContextSourceAssetContract({ filename: "too-large.png", mime_type: "image/png", size_bytes: CONTEXT_SOURCE_IMAGE_MAX_BYTES + 1 }), "size");
expectError(() => assertContextContract({
  context_category: "internal_notes",
  visibility_scope: "operator_internal",
  source_owner: "misell_operator",
  source_type: "operator_input",
  confidence: "operator_observed"
}, { customerInput: true }), "customer context input");
expectError(() => assertNoAutomaticExternalAi({ external_ai_used: true }), "external AI");
expectError(() => assertNoAutomaticExternalAi({ extraction_status: "processing" }), "automatic document processing");
expectError(() => normalizeCostOwner("unknown"), "cost_owner");

const snapshot = buildContextSnapshotSourceSummary([
  {
    customer_context_item_id: "ctx-summer-menu",
    context_category: customerContext.context_category,
    visibility_scope: customerContext.visibility_scope,
    source_owner: customerContext.source_owner,
    source_type: customerContext.source_type,
    confidence: customerContext.confidence,
    item_type: customerContext.item_type,
    item_key: customerContext.item_key,
    value_json: customerContext.value_json
  },
  {
    customer_context_item_id: "ctx-internal-note",
    context_category: "internal_notes",
    visibility_scope: "operator_internal",
    source_owner: "misell_operator",
    source_type: "operator_input",
    confidence: "operator_observed",
    item_type: "sales_note",
    item_key: "collab_candidate",
    value_json: { summary: "社内検討用。顧客APIには出さない。" }
  }
], [pdfAsset, imageAsset]);

const pdfSummary = snapshot.find((item) => item.customer_context_item_id === "ctx-summer-menu");
assert(pdfSummary.source_assets.length === 1, "PDF source asset should be linked to the context snapshot summary");
assert(pdfSummary.source_assets[0].extraction_status === "manual_no_ai", "source asset must remain manual_no_ai in this slice");
assert(pdfSummary.source_assets[0].external_ai_used === false, "source asset must not use external AI in this slice");
assert(CONTEXT_SOURCE_ASSET_EXTENSIONS.includes(".pdf"), "PDF extension must be part of context source asset contract");
assert(!CONTEXT_SOURCE_ASSET_EXTENSIONS.includes(".docx"), "DOCX must not be part of the MVP context source asset contract");
assert(CONTEXT_SOURCE_ASSET_MIME_TYPES.includes("application/pdf"), "PDF mime type must be part of context source asset contract");
assert(!CONTEXT_SOURCE_ASSET_MIME_TYPES.includes("text/plain"), "plain text upload must not be part of the MVP context source asset contract");
assert(CONTEXT_RECORD_STATUSES.includes("deleted"), "context records should support soft-delete status");
assert(normalizeCostOwner("manual_no_ai") === "manual_no_ai", "manual_no_ai cost owner should be accepted");

console.log(JSON.stringify({
  ok: true,
  customer_visible_scope: true,
  operator_internal_hidden: true,
  pdf_context_source_asset: true,
  image_context_source_asset: true,
  upload_size_limits: true,
  mvp_forbidden_file_types: true,
  soft_delete_status_contract: true,
  manual_no_ai_only: true,
  cost_owner_contract: true,
  snapshot_source_summary: true
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(fn, expected) {
  try {
    fn();
  } catch (error) {
    if (!String(error.message || error).includes(expected)) {
      throw new Error(`Expected error containing ${expected}, got: ${error.message || error}`);
    }
    return;
  }
  throw new Error(`Expected error containing ${expected}`);
}
