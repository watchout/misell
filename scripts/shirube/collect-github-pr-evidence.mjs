#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isMain,
  isObject,
  parseArgs,
  parseStructuredText,
} from "./lib.mjs";

const SCHEMA = "shirube-github-pr-evidence/v1";
const AUDIT_SCHEMA = "shirube-structured-audit-evidence/v1";
const OWNER_SCHEMA = "shirube-owner-decision-evidence/v1";
const OWNER_MARKER = "shirube-owner-decision/v1";

export function collectGithubPrEvidence(options) {
  const prNumber = stringOption(options["pr-number"]);
  const headSha = stringOption(options["head-sha"]);
  const commentsPath = stringOption(options["comments-json"]);
  const outDir = stringOption(options["out-dir"]) ?? ".shirube-full-operational";
  const ownerActors = new Set(csvOption(options["owner-actors"]));
  const auditorActors = new Set(csvOption(options["auditor-actors"]));
  const auditCommentAuthors = new Set(csvOption(options["audit-comment-authors"]));
  const implementationActors = new Set(csvOption(options["implementation-actors"]));

  mkdirSync(outDir, { recursive: true });

  const comments = readComments(commentsPath);
  const audit = findStructuredAudit({
    comments,
    prNumber,
    headSha,
    auditorActors,
    auditCommentAuthors,
    implementationActors,
  });
  const ownerDecision = findOwnerDecision({ comments, prNumber, headSha, ownerActors });

  const auditPath = path.join(outDir, "structured-audit.json");
  const ownerPath = path.join(outDir, "owner-decision.yaml");
  const summaryPath = path.join(outDir, "github-evidence-summary.md");
  const aggregatePath = path.join(outDir, "github-pr-evidence.json");

  writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  if (ownerDecision.valid) {
    writeFileSync(ownerPath, renderOwnerDecisionYaml(ownerDecision));
  }

  const aggregate = {
    schema: SCHEMA,
    target_pr: prNumber,
    target_head: headSha,
    audit_ref: auditPath,
    owner_decision_ref: ownerDecision.valid ? ownerPath : null,
    audit,
    owner_decision: ownerDecision,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(aggregate));

  return aggregate;
}

function readComments(filePath) {
  if (!filePath) return [];
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw)) return [];
  return raw.map((comment) => ({
    id: comment.id ?? null,
    html_url: comment.html_url ?? comment.url ?? null,
    body: comment.body ?? "",
    user: comment.user ?? {},
    created_at: comment.created_at ?? null,
    updated_at: comment.updated_at ?? null,
  }));
}

function findStructuredAudit({ comments, prNumber, headSha, auditorActors, auditCommentAuthors, implementationActors }) {
  const candidates = [];
  for (const comment of comments) {
    for (const block of yamlBlocks(comment.body)) {
      const doc = parseYamlBlock(block);
      if (!doc) continue;
      const audit = normalizeAuditDoc(doc);
      if (!audit) continue;
      const result = validateAudit({ audit, comment, prNumber, headSha, auditorActors, auditCommentAuthors, implementationActors });
      candidates.push(result);
    }
  }
  const valid = candidates
    .filter((candidate) => candidate.valid)
    .sort(byUpdatedAt)
    .at(-1);
  return valid ?? {
    schema: AUDIT_SCHEMA,
    valid: false,
    reason: "missing_valid_structured_audit",
    candidates,
  };
}

function findOwnerDecision({ comments, prNumber, headSha, ownerActors }) {
  const candidates = [];
  for (const comment of comments) {
    for (const block of yamlBlocks(comment.body)) {
      const doc = parseYamlBlock(block);
      if (!doc) continue;
      const decision = normalizeOwnerDecisionDoc(doc, comment.body);
      if (!decision) continue;
      const result = validateOwnerDecision({ decision, comment, prNumber, headSha, ownerActors });
      candidates.push(result);
    }
  }
  const valid = candidates
    .filter((candidate) => candidate.valid)
    .sort(byUpdatedAt)
    .at(-1);
  return valid ?? {
    schema: OWNER_SCHEMA,
    valid: false,
    reason: "missing_valid_owner_decision",
    candidates,
  };
}

function yamlBlocks(body) {
  const blocks = [];
  const fence = /```(?:ya?ml)\s*\n([\s\S]*?)```/giu;
  let match = fence.exec(body);
  while (match) {
    blocks.push(match[1]);
    match = fence.exec(body);
  }
  return blocks;
}

function parseYamlBlock(text) {
  try {
    const value = parseStructuredText(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeAuditDoc(doc) {
  const audit = doc.shirube_structured_audit ?? doc.structured_audit ?? doc;
  if (!isObject(audit)) return null;
  const hasAuditShape = audit.target_head !== undefined ||
    audit.overall_verdict !== undefined ||
    audit.blocking_findings !== undefined ||
    audit.required_rework !== undefined ||
    audit.item_set_ref !== undefined;
  return hasAuditShape ? audit : null;
}

function normalizeOwnerDecisionDoc(doc, body) {
  const decision = doc.shirube_owner_decision ?? doc.owner_decision ?? doc;
  if (!isObject(decision)) return null;
  const hasMarker = body.includes(OWNER_MARKER);
  const hasDecisionShape = decision.verdict !== undefined &&
    (decision.exact_head_sha !== undefined || decision.target_head !== undefined || decision.head_sha !== undefined);
  return hasMarker || hasDecisionShape ? decision : null;
}

function validateAudit({ audit, comment, prNumber, headSha, auditorActors, auditCommentAuthors, implementationActors }) {
  const verdict = stringValue(audit.overall_verdict);
  const targetPr = stringValue(audit.target_pr);
  const targetHead = stringValue(audit.target_head);
  const auditorActor = stringValue(audit.auditor_actor);
  const blockingFindings = asArray(audit.blocking_findings);
  const requiredRework = asArray(audit.required_rework);
  const commentActor = comment.user?.login ?? "";
  const allowedAuditor = auditorActors.size === 0 || auditorActors.has(auditorActor);
  const allowedCommentAuthor = auditCommentAuthors.size === 0 || auditCommentAuthors.has(commentActor);
  const makerCheckerSeparated = Boolean(auditorActor) && !implementationActors.has(auditorActor);
  const valid = (verdict === "PASS" || verdict === "PASS_WITH_WARN") &&
    targetMatches(targetPr, prNumber) &&
    targetHead === headSha &&
    blockingFindings.length === 0 &&
    requiredRework.length === 0 &&
    Boolean(auditorActor) &&
    allowedAuditor &&
    allowedCommentAuthor &&
    makerCheckerSeparated;
  return {
    schema: AUDIT_SCHEMA,
    valid,
    reason: valid ? null : "audit_did_not_satisfy_full_operational_gate",
    target_pr: targetPr,
    target_head: targetHead,
    overall_verdict: verdict,
    blocking_findings_count: blockingFindings.length,
    required_rework_count: requiredRework.length,
    auditor_actor: auditorActor,
    comment_actor: commentActor,
    allowed_auditor: allowedAuditor,
    allowed_comment_author: allowedCommentAuthor,
    maker_checker_separated: makerCheckerSeparated,
    comment_ref: comment.html_url,
    updated_at: comment.updated_at ?? comment.created_at,
  };
}

function validateOwnerDecision({ decision, comment, prNumber, headSha, ownerActors }) {
  const verdict = stringValue(decision.verdict);
  const targetPr = stringValue(decision.target_pr);
  const targetHead = stringValue(decision.exact_head_sha ?? decision.target_head ?? decision.head_sha);
  const ownerActor = stringValue(decision.owner_actor ?? decision.actor);
  const commentActor = comment.user?.login ?? "";
  const allowedOwner = ownerActors.size === 0 || ownerActors.has(commentActor) || ownerActors.has(ownerActor);
  const actorMatches = !ownerActor || !commentActor || ownerActor === commentActor;
  const valid = verdict === "APPROVED_EXACT_HEAD" &&
    targetMatches(targetPr, prNumber) &&
    targetHead === headSha &&
    allowedOwner &&
    actorMatches;
  return {
    schema: OWNER_SCHEMA,
    valid,
    reason: valid ? null : "owner_decision_did_not_satisfy_full_operational_gate",
    verdict,
    target_pr: targetPr,
    exact_head_sha: targetHead,
    owner_actor: ownerActor || commentActor,
    comment_actor: commentActor,
    allowed_owner: allowedOwner,
    actor_matches: actorMatches,
    comment_ref: comment.html_url,
    updated_at: comment.updated_at ?? comment.created_at,
  };
}

function renderOwnerDecisionYaml(decision) {
  return [
    "schema_version: shirube-owner-decision-evidence/v1",
    `verdict: ${quoteYaml(decision.verdict)}`,
    `target_pr: ${quoteYaml(decision.target_pr)}`,
    `exact_head_sha: ${quoteYaml(decision.exact_head_sha)}`,
    `owner_actor: ${quoteYaml(decision.owner_actor)}`,
    `decision_ref: ${quoteYaml(decision.comment_ref)}`,
    `recorded_at: ${quoteYaml(decision.updated_at ?? new Date().toISOString())}`,
    "",
  ].join("\n");
}

function renderSummary(aggregate) {
  return [
    "## Shirube GitHub PR Evidence",
    "",
    `- Target PR: \`${aggregate.target_pr ?? ""}\``,
    `- Target head: \`${aggregate.target_head ?? ""}\``,
    `- Structured audit valid: \`${String(aggregate.audit.valid)}\``,
    `- Owner decision valid: \`${String(aggregate.owner_decision.valid)}\``,
    `- Owner decision ref: \`${aggregate.owner_decision_ref ?? "missing"}\``,
    "",
  ].join("\n");
}

function byUpdatedAt(left, right) {
  return String(left.updated_at ?? "").localeCompare(String(right.updated_at ?? ""));
}

function targetMatches(value, expected) {
  if (!expected) return true;
  return String(value ?? "").replace(/^#/u, "") === String(expected).replace(/^#/u, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function csvOption(value) {
  return stringValue(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stringOption(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ""));
}

if (isMain(import.meta.url)) {
  const { options } = parseArgs(process.argv.slice(2));
  const report = collectGithubPrEvidence(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
