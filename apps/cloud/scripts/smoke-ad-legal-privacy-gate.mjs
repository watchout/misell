import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  POLICY_VERSION,
  INDUSTRY_CATEGORIES,
  CLAIM_CLASSES,
  PRIVACY_CLASSES,
  DATA_SOURCE_CLASSES,
  MEASUREMENT_LABELS,
  evaluateAdLegalPrivacyGate,
  buildAdLegalPrivacyGateRecord,
  isMisellOnlyDataSourceClass
} = require("../lib/ad-legal-privacy-gate.js");

const base = {
  gate_record_id: "gate-smoke-001",
  tenant_id: "TEN-AD-GATE",
  store_id: "STORE-AD-GATE",
  screen_group_id: "SG-AD-GATE",
  advertiser_id: "ADV-AD-GATE",
  campaign_id: "CMP-AD-GATE",
  creative_id: "CRE-AD-GATE",
  report_surface_id: "RPT-AD-GATE",
  industry_category: "general",
  claim_class: "informational",
  privacy_class: "no_pii",
  data_source_classes: ["misell_playlog", "misell_qr", "misell_coupon", "misell_order"],
  measurement_labels: ["measured"],
  review_status: "draft"
};

assert(POLICY_VERSION === "ad-legal-privacy-gate/v1", "policy version should be stable");
assert(INDUSTRY_CATEGORIES.includes("other_regulated"), "industry vocabulary must include regulated fallback");
assert(CLAIM_CLASSES.includes("guaranteed_outcome"), "claim vocabulary must include blocked guarantee class");
assert(PRIVACY_CLASSES.includes("camera_or_biometric"), "privacy vocabulary must include protected camera class");
assert(DATA_SOURCE_CLASSES.includes("ad_network"), "data source vocabulary must include ad network");
assert(MEASUREMENT_LABELS.includes("incremental"), "measurement vocabulary must include incremental");
assert(isMisellOnlyDataSourceClass("misell_qr"), "misell_qr should be a Misell-only data source");
assert(!isMisellOnlyDataSourceClass("pos_external"), "pos_external must not be Misell-only");

const allowed = evaluateAdLegalPrivacyGate(base);
assert(allowed.verdict === "allow" && allowed.allowed === true, `expected MVP precheck allow: ${JSON.stringify(allowed)}`);
assert(allowed.mvp_defaults.no_pii === true && allowed.mvp_defaults.no_camera === true, "MVP defaults should be no-PII/no-camera");
assert(allowed.legal_advice === false && allowed.llm_decision_authority === false, "helper must not claim legal advice or LLM authority");

const missing = evaluateAdLegalPrivacyGate({ ...base, industry_category: "" });
assert(missing.verdict === "block", "missing industry category must block");
assertReason(missing, "missing_classification");

const regulated = evaluateAdLegalPrivacyGate({ ...base, industry_category: "medical" });
assert(regulated.verdict === "human_review_required", `regulated category must require human review: ${JSON.stringify(regulated)}`);
assert(regulated.required_reviews.includes("legal") && regulated.required_reviews.includes("ad_review"), "regulated category should require legal/ad review");

const approvedRegulated = evaluateAdLegalPrivacyGate({
  ...base,
  industry_category: "medical",
  review_status: "approved",
  reviewer_role: "legal",
  legal_signoff_ref: "https://github.com/watchout/misell/issues/197#legal-smoke"
});
assert(approvedRegulated.verdict === "allow_with_conditions", `approved regulated gate should allow with conditions: ${JSON.stringify(approvedRegulated)}`);

const guaranteed = evaluateAdLegalPrivacyGate({ ...base, claim_class: "guaranteed_outcome" });
assert(guaranteed.verdict === "block", "guaranteed outcome claims must block");
assertReason(guaranteed, "guaranteed_outcome_blocked");

const incrementalWithoutBaseline = evaluateAdLegalPrivacyGate({
  ...base,
  claim_class: "incremental_claim",
  measurement_labels: ["measured", "incremental"]
});
assert(incrementalWithoutBaseline.verdict === "block", "incremental claim without holdout/baseline must block");
assertReason(incrementalWithoutBaseline, "incremental_without_baseline_blocked");

const incrementalWithBaseline = evaluateAdLegalPrivacyGate({
  ...base,
  claim_class: "incremental_claim",
  measurement_labels: ["measured", "incremental"],
  holdout_or_baseline_evidence_ref: "github://misell/evidence/holdout-smoke"
});
assert(incrementalWithBaseline.verdict === "human_review_required", "incremental claim with baseline should still require human review");

const camera = evaluateAdLegalPrivacyGate({
  ...base,
  privacy_class: "camera_or_biometric",
  data_source_classes: ["misell_playlog", "camera"]
});
assert(camera.verdict === "block", "camera or biometric data must block until protected gate");
assert(camera.protected_gate_required.includes("privacy"), "camera should require protected privacy gate");

const posExternal = evaluateAdLegalPrivacyGate({
  ...base,
  data_source_classes: ["misell_playlog", "pos_external"],
  measurement_labels: ["measured", "estimated"]
});
assert(posExternal.verdict === "human_review_required", "external POS/estimated data should require human review");
assert(posExternal.required_reviews.includes("privacy") && posExternal.required_reviews.includes("legal"), "external estimated data should require privacy/legal review");

const llmApproval = evaluateAdLegalPrivacyGate({
  ...base,
  industry_category: "finance",
  review_status: "approved",
  reviewer_role: "codex",
  legal_signoff_ref: "fake-ai-approval"
});
assert(llmApproval.verdict === "block", "LLM reviewer must not approve gates");
assertReason(llmApproval, "invalid_reviewer_role_blocked");

const approvedWithoutEvidence = evaluateAdLegalPrivacyGate({
  ...base,
  industry_category: "finance",
  review_status: "approved",
  reviewer_role: "legal"
});
assert(approvedWithoutEvidence.verdict === "block", "approved gate without signoff evidence must block");
assertReason(approvedWithoutEvidence, "approved_without_signoff_ref_blocked");

const record = buildAdLegalPrivacyGateRecord({
  ...base,
  creative_text: "Do not echo this customer-provided creative body.",
  source_story_detail: "Do not echo external source claims.",
  conditions_json: { wording: "measured only", noGuarantee: true }
}, { now: "2026-06-26T00:00:00.000Z" });
assert(record.schema_version === "ad-legal-privacy-gate-record/v1", "record schema should be explicit");
assert(record.verdict === "allow", "record should preserve evaluated verdict");
assert(record.deleted_at === "" && record.revoked_at === "", "record should carry soft-delete/revocation fields");
assert(record.evaluation.llm_decision_authority === false, "record must say LLM has no decision authority");
assert(record.evaluation.legal_advice === false, "record must say it is not legal advice");
const serializedRecord = JSON.stringify(record);
assert(!serializedRecord.includes("Do not echo"), "gate record must not echo raw creative/source text");
assert(serializedRecord.includes("measured only"), "conditions_json should keep operator-approved constraints");

console.log(JSON.stringify({
  ok: true,
  policy_version: POLICY_VERSION,
  mvp_no_pii_measured_allow: true,
  missing_classification_blocks: true,
  regulated_category_human_review: true,
  regulated_category_with_signoff_allows_with_conditions: true,
  guaranteed_outcome_blocks: true,
  incremental_requires_holdout_and_review: true,
  camera_blocks_until_protected_gate: true,
  external_data_source_requires_review: true,
  llm_not_decision_authority: true,
  gate_record_soft_delete_shape: true,
  no_raw_creative_text_echo: true
}, null, 2));

function assertReason(result, code) {
  assert(result.reasons.some((entry) => entry.code === code), `expected reason ${code}: ${JSON.stringify(result)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
