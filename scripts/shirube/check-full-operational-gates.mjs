#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isMain,
  isObject,
  parseArgs,
  readStructuredFile,
} from "./lib.mjs";

const SCHEMA = "shirube-full-operational-gate/v1";
const PROTECTED_PATH_GLOBS = [
  ".github/workflows/**",
  ".github/pull_request_template.md",
  ".shirube/README.md",
  ".shirube/adoption-intake.yaml",
  ".shirube/audit-templates/**",
  ".shirube/gate-contracts/**",
  ".shirube/gate-pack-bridge/**",
  ".shirube/lifecycle-state.yaml",
  ".shirube/repo-spec.yaml",
  "scripts/shirube/**",
];
const PER_PR_EVIDENCE_PATH_GLOBS = [
  ".shirube/control-handoffs/CH-*.yaml",
];
const PROTECTED_SURFACE_GLOBS = {
  github_actions_workflow: [
    ".github/workflows/**",
  ],
  pr_template_governance: [
    ".github/pull_request_template.md",
  ],
  shirube_gate_enforcement: [
    ".shirube/README.md",
    ".shirube/adoption-intake.yaml",
    ".shirube/audit-templates/**",
    ".shirube/gate-contracts/**",
    ".shirube/gate-pack-bridge/**",
    ".shirube/lifecycle-state.yaml",
    ".shirube/repo-spec.yaml",
    "scripts/shirube/**",
  ],
};
const EXPECTED_ADOPTION_BLOCKERS = new Set([
  "RECOVER-004",
  "LC-ADOPT-002",
  "LC-ADOPT-003",
  "RL-CELL-006",
  "RL-MERGE-001",
  "LC-EXEC-002",
]);

export function buildFullOperationalGateReport(options) {
  const resultDir = stringOption(options["result-dir"]) ?? ".shirube-full-operational";
  mkdirSync(resultDir, { recursive: true });

  const prNumber = stringOption(options["pr-number"]);
  const headSha = stringOption(options["head-sha"]);
  const changedFiles = readLines(stringOption(options["changed-files"]));
  const handoffPath = stringOption(options.handoff);
  const aggregatePath = stringOption(options.aggregate);
  const githubEvidencePath = stringOption(options["github-evidence"]);
  const auditPath = stringOption(options.audit);
  const ownerDecisionPath = stringOption(options["owner-decision"]);

  const blockers = [];
  const warnings = [];
  const evidence = [];

  const handoff = readStructuredOrNull(handoffPath, blockers, "FULL-HANDOFF-001", "Control handoff is missing or unreadable.");
  const aggregate = readJsonOrNull(aggregatePath, blockers, "FULL-RAPID-001", "Rapid/Lite aggregate report is missing or unreadable.");
  const githubEvidence = readJsonOrNull(githubEvidencePath, blockers, "FULL-EVID-001", "GitHub PR evidence report is missing or unreadable.");
  const audit = readJsonOrNull(auditPath, blockers, "FULL-AUDIT-001", "Structured audit evidence is missing or unreadable.");
  const ownerDecision = readStructuredOrNull(ownerDecisionPath, [], "FULL-OWNER-READ", "Owner decision is unreadable.");

  addEvidence(evidence, "handoff", handoffPath, handoff);
  addEvidence(evidence, "rapid_lite_aggregate", aggregatePath, aggregate);
  addEvidence(evidence, "github_pr_evidence", githubEvidencePath, githubEvidence);
  addEvidence(evidence, "structured_audit", auditPath, audit);
  addEvidence(evidence, "owner_decision", ownerDecisionPath, ownerDecision);

  const adoption = isFullOperationalAdoption(handoff);
  const allowedPaths = asStringArray(handoff?.cell?.allowed_paths);
  const forbiddenPaths = asStringArray(handoff?.cell?.forbidden_paths);
  const perPrEvidenceTouched = changedFiles.filter((file) => matchesAnyGlob(file, PER_PR_EVIDENCE_PATH_GLOBS));
  const protectedTouched = changedFiles.filter((file) => matchesAnyGlob(file, PROTECTED_PATH_GLOBS));

  if (!prNumber) blockers.push(finding("FULL-PR-001", "PR number is required.", "pr_number"));
  if (!headSha) blockers.push(finding("FULL-PR-002", "PR head SHA is required.", "head_sha"));

  if (handoff) {
    const expectedHead = firstPresent(
      handoff.pr_head_sha,
      handoff.PR_head_SHA,
      handoff.expected_pr_head_sha,
      handoff.validation?.pr_head_sha,
      handoff.validation?.expected_pr_head_sha,
    );
    if (isPlaceholder(expectedHead)) {
      warnings.push(finding("FULL-PR-W001", "Handoff does not embed PR head; workflow-supplied head is used.", "handoff.pr_head_sha"));
    } else if (headSha && String(expectedHead) !== headSha) {
      blockers.push(finding("FULL-PR-003", "Handoff PR head does not match the workflow head.", "handoff.pr_head_sha"));
    }
  }

  for (const file of changedFiles) {
    if (allowedPaths.length > 0 && !matchesAnyGlob(file, allowedPaths)) {
      blockers.push(finding("FULL-SCOPE-001", `${file} is outside handoff allowed_paths.`, file));
    }
    if (forbiddenPaths.length > 0 && matchesAnyGlob(file, forbiddenPaths)) {
      blockers.push(finding("FULL-SCOPE-002", `${file} matches handoff forbidden_paths.`, file));
    }
  }

  if (protectedTouched.length > 0 && !adoption) {
    blockers.push(finding(
      "FULL-PROT-001",
      "Protected Shirube/GitHub governance paths require a full operational adoption handoff.",
      protectedTouched.join(", "),
    ));
  }

  if (adoption) {
    const surfaces = surfacesFrom(handoff);
    for (const required of requiredProtectedSurfaces(protectedTouched)) {
      if (!surfaces.has(required)) {
        blockers.push(finding("FULL-PROT-002", `Full adoption handoff must declare protected surface: ${required}.`, "protected_surfaces"));
      }
    }
    if (handoff?.cell?.cell_type !== "protected_stop" && handoff?.cell?.cell_type !== "governance_enforcement") {
      blockers.push(finding("FULL-PROT-003", "Full adoption handoff must use protected_stop or governance_enforcement cell_type.", "cell.cell_type"));
    }
  }

  if (!audit?.valid) {
    blockers.push(finding("FULL-AUDIT-002", "A passing structured audit for the exact PR head is required.", "structured_audit"));
  }

  if (!githubEvidence?.owner_decision?.valid && !hasOwnerDecision(ownerDecision, headSha)) {
    blockers.push(finding("FULL-OWNER-001", "Owner APPROVED_EXACT_HEAD decision for the exact PR head is required.", "owner_decision"));
  }

  if (aggregate) {
    const blockingItems = aggregateBlockerItemIds(aggregate);
    const unexpected = adoption
      ? blockingItems.filter((itemId) => !EXPECTED_ADOPTION_BLOCKERS.has(itemId))
      : blockingItems;
    if (aggregate.report_failed === true) {
      blockers.push(finding("FULL-RAPID-002", "Rapid/Lite report generation failed.", "rapid_lite_aggregate.report_failed"));
    }
    if (unexpected.length > 0 || aggregate.report_failed === true) {
      blockers.push(finding("FULL-RAPID-003", `Rapid/Lite would_block has unresolved blockers: ${unexpected.join(", ") || "report_failed"}.`, "rapid_lite_aggregate"));
    }
    if (adoption && blockingItems.some((itemId) => EXPECTED_ADOPTION_BLOCKERS.has(itemId))) {
      warnings.push(finding("FULL-RAPID-W001", "Rapid/Lite reports expected protected-surface blockers for this adoption PR.", "rapid_lite_aggregate"));
    }
  }

  const uniqueBlockers = uniqueFindings(blockers);
  const uniqueWarnings = uniqueFindings(warnings);
  const report = {
    schema: SCHEMA,
    mode: "full_operational",
    target_pr: prNumber,
    target_head: headSha,
    generated_at: new Date().toISOString(),
    verdict: uniqueBlockers.length > 0 ? "BLOCK" : uniqueWarnings.length > 0 ? "PASS_WITH_WARN" : "PASS",
    would_block: uniqueBlockers.length > 0,
    adoption_mode: adoption ? "shirube_full_operational_adoption" : "normal_pr",
    changed_files_count: changedFiles.length,
    protected_files_touched: protectedTouched,
    per_pr_evidence_files_touched: perPrEvidenceTouched,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    evidence: uniqueEvidence(evidence),
    required_next_actions: requiredNextActions(uniqueBlockers, uniqueWarnings),
  };

  writeFileSync(path.join(resultDir, "full-operational-gate.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(resultDir, "full-operational-summary.md"), renderSummary(report));
  return report;
}

function readJsonOrNull(filePath, blockers, itemId, message) {
  if (!filePath || !existsSync(filePath)) {
    blockers.push(finding(itemId, message, filePath ?? "missing"));
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    blockers.push(finding(itemId, message, filePath));
    return null;
  }
}

function readStructuredOrNull(filePath, blockers, itemId, message) {
  if (!filePath || !existsSync(filePath)) {
    blockers.push(finding(itemId, message, filePath ?? "missing"));
    return null;
  }
  try {
    return readStructuredFile(filePath);
  } catch {
    blockers.push(finding(itemId, message, filePath));
    return null;
  }
}

function readLines(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function isFullOperationalAdoption(handoff) {
  return handoff?.governance_change?.type === "shirube_full_operational_adoption" ||
    handoff?.full_operational_adoption === true ||
    handoff?.cell?.cell_type === "governance_enforcement";
}

function surfacesFrom(handoff) {
  const values = [
    handoff?.protected_surfaces,
    handoff?.cell?.protected_surfaces,
    handoff?.requested_surfaces,
    handoff?.cell?.requested_surfaces,
    handoff?.governance_change?.protected_surfaces,
  ];
  return new Set(values.flatMap(flattenSurface).map((value) => value.trim()).filter(Boolean));
}

function requiredProtectedSurfaces(files) {
  const required = [];
  for (const [surface, globs] of Object.entries(PROTECTED_SURFACE_GLOBS)) {
    if (files.some((file) => matchesAnyGlob(file, globs))) {
      required.push(surface);
    }
  }
  return required;
}

function flattenSurface(value) {
  if (Array.isArray(value)) return value.flatMap(flattenSurface);
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, entry]) => entry === true ? [key] : [key, ...flattenSurface(entry)]);
  }
  return typeof value === "string" ? [value, value.toLowerCase()] : [];
}

function aggregateBlockerItemIds(aggregate) {
  if (!Array.isArray(aggregate?.gates)) return [];
  return aggregate.gates.flatMap((gate) => {
    const blockers = Array.isArray(gate.blockers) ? gate.blockers : [];
    return blockers.map((blocker) => blocker.item_id ?? blocker.code).filter(Boolean);
  });
}

function hasOwnerDecision(ownerDecision, headSha) {
  if (!isObject(ownerDecision)) return false;
  const verdict = firstPresent(ownerDecision.verdict, ownerDecision.owner_decision?.verdict);
  const exactHead = firstPresent(
    ownerDecision.exact_head_sha,
    ownerDecision.target_head,
    ownerDecision.head_sha,
    ownerDecision.owner_decision?.exact_head_sha,
  );
  return verdict === "APPROVED_EXACT_HEAD" && exactHead === headSha;
}

function addEvidence(evidence, code, filePath, value) {
  if (filePath && value) evidence.push({ code, source: "file", detail: filePath });
}

function requiredNextActions(blockers, warnings) {
  if (blockers.length === 0 && warnings.length === 0) return [];
  return [...blockers, ...warnings].map((item) => ({
    item_id: item.item_id,
    action: item.message,
  }));
}

function renderSummary(report) {
  const lines = [
    "<!-- shirube-full-operational-gate/v1 -->",
    "",
    "## Shirube Full Operational Gate",
    "",
    `- Verdict: \`${report.verdict}\``,
    `- Would block: \`${String(report.would_block)}\``,
    `- Mode: \`${report.mode}\``,
    `- Adoption mode: \`${report.adoption_mode}\``,
    `- Target PR: \`${report.target_pr ?? ""}\``,
    `- Target head: \`${report.target_head ?? ""}\``,
    `- Changed files: \`${report.changed_files_count}\``,
    "",
    "### Blockers",
    "",
    ...findingLines(report.blockers),
    "### Warnings",
    "",
    ...findingLines(report.warnings),
    "### Evidence",
    "",
    ...report.evidence.map((item) => `- ${item.code}: \`${item.detail}\``),
    "",
  ];
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function findingLines(items) {
  if (!Array.isArray(items) || items.length === 0) return ["- none", ""];
  return [
    ...items.map((item) => `- \`${item.item_id}\`${item.path ? ` (${item.path})` : ""}: ${item.message}`),
    "",
  ];
}

function finding(itemId, message, itemPath) {
  return { item_id: itemId, message, path: itemPath };
}

function uniqueFindings(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.item_id}:${item.path}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function uniqueEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.code}:${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function firstPresent(...values) {
  for (const value of values) {
    if (!isPlaceholder(value)) return String(value);
  }
  return null;
}

function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^<[^>]+>$/.test(trimmed)) return true;
  return /^(pending|pending-.+|tbd|todo|null|none|n\/a|replace this.*)$/i.test(trimmed);
}

function matchesAnyGlob(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

function globToRegExp(glob) {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const nextNext = glob[index + 2];
    if (char === "*" && next === "*" && nextNext === "/") {
      pattern += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    pattern += escapeRegExp(char);
  }
  pattern += "$";
  return new RegExp(pattern);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function stringOption(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

if (isMain(import.meta.url)) {
  const { options } = parseArgs(process.argv.slice(2));
  const report = buildFullOperationalGateReport(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.would_block ? 1 : 0;
}
