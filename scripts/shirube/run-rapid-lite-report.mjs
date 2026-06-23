#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isMain,
  isObject,
  parseArgs,
  readStructuredFile,
} from "./lib.mjs";

const SCHEMA = "shirube-rapid-lite-report/v1";
const MARKER = "<!-- shirube-rapid-lite-gates-report/v1 -->";
const DEFAULT_RESULT_DIR = ".shirube-rapid-lite";

export function buildRapidLiteReport(options) {
  const resultDir = stringOption(options["result-dir"]) ?? DEFAULT_RESULT_DIR;
  mkdirSync(resultDir, { recursive: true });

  const changedFilesPath = stringOption(options["changed-files"]);
  const inputFailurePath = stringOption(options["input-failure"]);
  const prBodyPath = stringOption(options["pr-body"]);
  const diffRoot = stringOption(options["diff-root"]) ?? ".";
  const changedFilesResult = readChangedFiles(changedFilesPath);
  const changedFiles = changedFilesResult.files;
  const prBody = prBodyPath && existsSync(prBodyPath) ? readFileSync(prBodyPath, "utf8") : "";
  const discovery = discoverRefs({ prBody, changedFiles });
  const refs = discovery.refs;
  const records = [];

  if (changedFilesResult.failure) records.push(failureRecord("input-collection", changedFilesResult.failure));
  if (inputFailurePath) records.push(readInputFailureRecord(inputFailurePath));
  records.push(...discovery.records);

  const adoption = runAdoption({ resultDir, refs, changedFilesPath });
  records.push(adoption);

  const gateContract = runGateContract({ resultDir, refs, changedFilesPath });
  records.push(gateContract);

  const designRules = runDesignRules({ resultDir, refs, changedFilesPath, prBodyPath, diffRoot });
  records.push(designRules);

  const lifecycle = runLifecycle({
    resultDir,
    refs,
    changedFilesPath,
    adoptionReportPath: adoption.status === "ran" ? adoption.output_path : refs.adoptionReport,
    gateContractReportPath: gateContract.status === "ran" ? gateContract.output_path : refs.gateContractReport,
    designRuleReportPath: designRules.status === "ran" ? designRules.output_path : refs.designRuleReport,
  });
  records.splice(1, 0, lifecycle);

  const aggregate = aggregateReport({ resultDir, refs, records, changedFiles });
  writeFileSync(path.join(resultDir, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
  writeFileSync(path.join(resultDir, "summary.md"), renderSummary(aggregate));
  return aggregate;
}

function runAdoption({ resultDir, refs, changedFilesPath }) {
  if (!refs.adoptionPlan) return skipped("adoption", "No adoption intake plan was found.");
  const args = [
    "scripts/shirube/check-adoption.mjs",
    "--adoption-plan",
    refs.adoptionPlan,
  ];
  addArg(args, "--existing-state", refs.existingState);
  addArg(args, "--legacy-inventory", refs.legacyInventory);
  addArg(args, "--repo-spec", refs.repoSpec);
  addArg(args, "--spec-reconciliation", refs.specReconciliation);
  addArg(args, "--handoff", refs.handoff);
  addArg(args, "--changed-files", changedFilesPath);
  args.push("--format", "json");
  return runGate({ gate: "adoption", args, outputPath: path.join(resultDir, "adoption.json") });
}

function runGateContract({ resultDir, refs, changedFilesPath }) {
  if (!refs.handoff) return skipped("gate-contract", "No Rapid/Lite control handoff was found.");
  const args = [
    "scripts/shirube/check-gate-contract.mjs",
  ];
  addArg(args, "--matrix", refs.matrix);
  addArg(args, "--repo-spec", refs.repoSpec);
  addArg(args, "--framework-lock", refs.frameworkLock);
  args.push("--handoff", refs.handoff);
  addArg(args, "--changed-files", changedFilesPath);
  addArg(args, "--owner-decision", refs.ownerDecision);
  args.push("--format", "json");
  return runGate({ gate: "gate-contract", args, outputPath: path.join(resultDir, "gate-contract.json") });
}

function runDesignRules({ resultDir, refs, changedFilesPath, prBodyPath, diffRoot }) {
  if (!refs.rulePack) return skipped("design-rules", "No design rule pack was found.");
  const args = [
    "scripts/shirube/check-design-rules.mjs",
    "--rule-pack",
    refs.rulePack,
  ];
  addArg(args, "--changed-files", changedFilesPath);
  addArg(args, "--diff-root", diffRoot);
  addArg(args, "--handoff", refs.handoff);
  addArg(args, "--pr-body", prBodyPath);
  args.push("--format", "json");
  return runGate({ gate: "design-rules", args, outputPath: path.join(resultDir, "design-rules.json") });
}

function runLifecycle({ resultDir, refs, changedFilesPath, adoptionReportPath, gateContractReportPath, designRuleReportPath }) {
  if (!refs.lifecycleState) return skipped("lifecycle", "No lifecycle state was found.");
  const args = [
    "scripts/shirube/check-lifecycle.mjs",
    "--state",
    refs.lifecycleState,
  ];
  addArg(args, "--adoption-report", adoptionReportPath);
  addArg(args, "--repo-spec", refs.repoSpec);
  addArg(args, "--framework-lock", refs.frameworkLock);
  addArg(args, "--handoff", refs.handoff);
  addArg(args, "--gate-contract-report", gateContractReportPath);
  addArg(args, "--design-rule-report", designRuleReportPath);
  addArg(args, "--owner-decision", refs.ownerDecision);
  addArg(args, "--post-merge", refs.postMerge);
  addArg(args, "--changed-files", changedFilesPath);
  args.push("--format", "json");
  return runGate({ gate: "lifecycle", args, outputPath: path.join(resultDir, "lifecycle.json") });
}

function runGate({ gate, args, outputPath }) {
  const command = ["node", ...args].join(" ");
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  writeFileSync(outputPath, stdout.trim() ? `${stdout.trim()}\n` : "{}\n");
  if (stderr.trim()) writeFileSync(`${outputPath}.stderr.txt`, `${stderr.trim()}\n`);

  let report = null;
  let parseError = null;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  if (!report) {
    const finding = {
      code: "malformed_gate_json",
      message: parseError ?? "Gate command did not produce JSON.",
    };
    report = {
      schema: "shirube-rapid-lite-gate-run/v1",
      verdict: "FAILURE",
      report_failed: true,
      would_block: true,
      blockers: [finding],
      warnings: [],
      required_next_actions: [finding],
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  const reportFailed = report.report_failed === true || report.verdict === "FAILURE" || (result.status ?? 0) !== 0;
  return {
    gate,
    status: "ran",
    command,
    output_path: outputPath,
    exit_code: result.status ?? 1,
    verdict: report.verdict ?? "UNKNOWN",
    report_failed: reportFailed,
    current_phase: report.current_phase ?? null,
    disposition: report.disposition ?? report.adoption?.disposition ?? null,
    would_block: reportFailed || report.would_block === true || report.verdict === "BLOCKED",
    blockers: findings(report, "blockers"),
    warnings: findings(report, "warnings"),
    required_next_actions: Array.isArray(report.required_next_actions) ? report.required_next_actions : [],
    report,
  };
}

function skipped(gate, reason) {
  return {
    gate,
    status: "skipped",
    reason,
    output_path: null,
    exit_code: null,
    verdict: "SKIPPED",
    report_failed: false,
    current_phase: null,
    disposition: null,
    would_block: false,
    blockers: [],
    warnings: [],
    required_next_actions: [],
  };
}

function aggregateReport({ resultDir, refs, records, changedFiles }) {
  const ran = records.filter((record) => record.status === "ran");
  const verdict = aggregateVerdict(ran.map((record) => record.verdict));
  const reportFailed = ran.some((record) => record.report_failed || record.verdict === "FAILURE");
  const wouldBlock = reportFailed || ran.some((record) => record.would_block || record.verdict === "BLOCKED");
  return {
    schema: SCHEMA,
    report_only: true,
    generated_at: new Date().toISOString(),
    result_dir: resultDir,
    verdict,
    report_failed: reportFailed,
    would_block: wouldBlock,
    owner_must_not_merge: wouldBlock,
    gates: records.map((record) => ({
      gate: record.gate,
      status: record.status,
      reason: record.reason ?? null,
      command: record.command ?? null,
      output_path: record.output_path,
      exit_code: record.exit_code,
      verdict: record.verdict,
      report_failed: record.report_failed,
      current_phase: record.current_phase,
      disposition: record.disposition,
      would_block: record.would_block,
      blockers: record.blockers,
      warnings: record.warnings,
      required_next_actions: record.required_next_actions,
    })),
    discovered_inputs: refs,
    changed_files_count: changedFiles.length,
    changed_files: changedFiles,
  };
}

function renderSummary(report) {
  const lines = [
    MARKER,
    "",
    "## Shirube Rapid/Lite Gates Report",
    "",
    `- Verdict: \`${report.verdict}\``,
    `- Report failed: \`${String(report.report_failed)}\``,
    `- Would block: \`${String(report.would_block)}\``,
    `- Owner must not merge: \`${String(report.owner_must_not_merge)}\``,
    `- Report-only: \`${String(report.report_only)}\``,
    `- Changed files: \`${report.changed_files_count}\``,
    "",
    "This workflow is report-only. `BLOCKED` findings are recorded as PR-visible evidence and uploaded JSON artifacts; they do not fail this workflow or change required checks.",
    "",
    "### Gate Summary",
    "",
    "| Gate | Status | Verdict | Report failed | Current phase | Disposition | Would block |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.gates.map((gate) => `| ${gate.gate} | ${gate.status}${gate.reason ? `<br>${escapeTable(gate.reason)}` : ""} | ${gate.verdict ?? ""} | ${String(gate.report_failed)} | ${gate.current_phase ?? ""} | ${gate.disposition ?? ""} | ${String(gate.would_block)} |`),
    "",
    "### Findings",
    "",
  ];

  for (const gate of report.gates) {
    lines.push(`#### ${gate.gate}`);
    lines.push("");
    appendFindingList(lines, "Blockers", gate.blockers);
    appendFindingList(lines, "Warnings", gate.warnings);
    appendActions(lines, gate.required_next_actions);
  }

  lines.push("### Artifact Outputs");
  lines.push("");
  for (const gate of report.gates) {
    if (gate.output_path) lines.push(`- ${gate.gate}: \`${gate.output_path}\``);
  }
  lines.push("");
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function appendFindingList(lines, title, findingsList) {
  lines.push(`**${title}**`);
  lines.push("");
  if (!Array.isArray(findingsList) || findingsList.length === 0) {
    lines.push("- none");
    lines.push("");
    return;
  }
  for (const item of findingsList.slice(0, 20)) {
    const id = item.item_id ?? item.rule_id ?? item.code ?? "finding";
    const message = item.message ?? item.action ?? "";
    const location = item.path ? ` (${item.path})` : "";
    lines.push(`- \`${id}\`${location}: ${message}`);
  }
  if (findingsList.length > 20) lines.push(`- ... ${findingsList.length - 20} more`);
  lines.push("");
}

function appendActions(lines, actions) {
  lines.push("**Required next actions**");
  lines.push("");
  if (!Array.isArray(actions) || actions.length === 0) {
    lines.push("- none");
    lines.push("");
    return;
  }
  for (const action of actions.slice(0, 20)) {
    if (typeof action === "string") {
      lines.push(`- ${action}`);
    } else {
      const id = action.item_id ?? action.code ?? "action";
      lines.push(`- \`${id}\`: ${action.action ?? action.message ?? ""}`);
    }
  }
  if (actions.length > 20) lines.push(`- ... ${actions.length - 20} more`);
  lines.push("");
}

function discoverRefs({ prBody, changedFiles }) {
  const explicit = {
    adoptionPlan: refFromBody(prBody, ["adoption_plan_ref", "adoption_plan", "adoption-plan", "adoption plan"]),
    existingState: refFromBody(prBody, ["existing_state_ref", "existing_state", "existing-state", "existing state"]),
    legacyInventory: refFromBody(prBody, ["legacy_inventory_ref", "legacy_inventory", "legacy-inventory"]),
    specReconciliation: refFromBody(prBody, ["spec_reconciliation_ref", "spec_reconciliation", "spec-reconciliation"]),
    lifecycleState: refFromBody(prBody, ["lifecycle_state_ref", "lifecycle_state", "lifecycle-state"]),
    adoptionReport: refFromBody(prBody, ["adoption_report_ref", "adoption_report", "adoption-report"]),
    gateContractReport: refFromBody(prBody, ["gate_contract_report_ref", "gate_contract_report", "gate-contract-report"]),
    designRuleReport: refFromBody(prBody, ["design_rule_report_ref", "design_rule_report", "design-rule-report"]),
    repoSpec: refFromBody(prBody, ["repo_spec_ref", "repo_spec", "repo-spec", "premise_ref"]),
    frameworkLock: refFromBody(prBody, ["framework_lock_ref", "framework_lock", "framework-lock"]),
    handoff: refFromBody(prBody, ["handoff_ref", "handoff", "control_handoff_ref", "control_handoff", "control-handoff"]),
    ownerDecision: refFromBody(prBody, ["owner_decision_ref", "owner_decision", "owner-decision"]),
    postMerge: refFromBody(prBody, ["post_merge_ref", "post_merge", "post-merge"]),
    matrix: refFromBody(prBody, ["matrix_ref", "gate_contract_matrix_ref", "gate_contract_matrix"]),
    rulePack: refFromBody(prBody, ["rule_pack_ref", "rule_pack", "rule-pack", "design_rule_pack_ref"]),
  };

  const schemaMatches = schemasFromFiles(walkFiles(changedFiles));
  const records = [];
  const refs = {
    adoptionPlan: resolveRef({ name: "adoption_plan", explicit: explicit.adoptionPlan, candidates: bySchema(schemaMatches, "shirube-adoption-intake/v1"), defaults: [".shirube/adoption-intake.yaml", ".shirube/adoption/intake.yaml"], records }),
    existingState: resolveRef({ name: "existing_state", explicit: explicit.existingState, candidates: bySchema(schemaMatches, "shirube-existing-state-scan/v1"), defaults: [".shirube/existing-state-scan.yaml", ".shirube/adoption/existing-state-scan.yaml"], records }),
    legacyInventory: resolveRef({ name: "legacy_inventory", explicit: explicit.legacyInventory, defaults: [".shirube/legacy-inventory.yaml"], records }),
    specReconciliation: resolveRef({ name: "spec_reconciliation", explicit: explicit.specReconciliation, candidates: bySchema(schemaMatches, "shirube-spec-reconciliation-plan/v1"), defaults: [".shirube/spec-reconciliation-plan.yaml"], records }),
    lifecycleState: resolveRef({ name: "lifecycle_state", explicit: explicit.lifecycleState, candidates: bySchema(schemaMatches, "shirube-lifecycle-state/rapid-lite/v1"), defaults: [".shirube/lifecycle-state.yaml", ".shirube/lifecycle-state.rapid-lite.yaml"], records }),
    adoptionReport: resolveRef({ name: "adoption_report", explicit: explicit.adoptionReport, defaults: [".shirube/reports/adoption.json"], records }),
    gateContractReport: resolveRef({ name: "gate_contract_report", explicit: explicit.gateContractReport, defaults: [".shirube/reports/gate-contract.json"], records }),
    designRuleReport: resolveRef({ name: "design_rule_report", explicit: explicit.designRuleReport, defaults: [".shirube/reports/design-rules.json"], records }),
    repoSpec: resolveRef({ name: "repo_spec", explicit: explicit.repoSpec, defaults: [".shirube/repo-spec.yaml"], records }),
    frameworkLock: resolveRef({ name: "framework_lock", explicit: explicit.frameworkLock, defaults: [".shirube/shirube-framework-lock.yaml"], records }),
    handoff: resolveRef({ name: "handoff", explicit: explicit.handoff, candidates: bySchema(schemaMatches, "shirube-control-handoff/rapid-lite/v1"), defaults: [".shirube/control-handoff.yaml"], records }),
    ownerDecision: resolveRef({ name: "owner_decision", explicit: explicit.ownerDecision, defaults: [".shirube/evidence/owner-decision.yaml"], records }),
    postMerge: resolveRef({ name: "post_merge", explicit: explicit.postMerge, defaults: [".shirube/evidence/post-merge.yaml"], records }),
    matrix: resolveRef({ name: "matrix", explicit: explicit.matrix, defaults: [".shirube/gate-contracts/shirube-v3-rapid-lite-gate-contract-matrix.yaml"], records }),
    rulePack: firstExisting(explicit.rulePack, ".shirube/design-rule-packs/shirube-default-design-rules.yaml"),
  };
  return { refs, records };
}

function refFromBody(body, keys) {
  if (!body) return null;
  for (const key of keys) {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${escapeRegExp(key)})\\s*:\\s*([^\\n]+?)\\s*(?=\\n|$)`, "i");
    const match = body.match(pattern);
    const value = sanitizeRef(match?.[1]);
    if (value) return value;
  }
  return null;
}

function sanitizeRef(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^["'`]|["'`]$/g, "");
  if (!cleaned || /^https?:\/\//i.test(cleaned) || cleaned === "null") return null;
  return cleaned.split(/\s+/)[0];
}

function schemasFromFiles(files) {
  const matches = [];
  for (const file of [...new Set(files)].sort((a, b) => a.localeCompare(b))) {
    if (!existsSync(file) || !/\.(ya?ml|json)$/i.test(file)) continue;
    try {
      const body = readStructuredFile(file);
      const schema = isObject(body) ? body.schema_version : null;
      if (schema) matches.push({ file, schema });
    } catch {
      // Input discovery must not fail the report-only workflow.
    }
  }
  return matches;
}

function bySchema(matches, schema) {
  return matches.filter((entry) => entry.schema === schema).map((entry) => entry.file);
}

function firstExisting(...values) {
  return values.flat().filter(Boolean).find((value) => existsSync(value)) ?? null;
}

function walkFiles(root) {
  return Array.isArray(root) ? root.filter(Boolean) : [];
}

function resolveRef({ name, explicit, candidates = [], defaults = [], records }) {
  if (explicit) return explicit;
  const currentPrCandidates = [...new Set(candidates.flat().filter(Boolean).filter((value) => existsSync(value)))]
    .sort((a, b) => a.localeCompare(b));
  if (currentPrCandidates.length > 1) {
    records.push(discoveryAmbiguityRecord(name, currentPrCandidates));
    return null;
  }
  if (currentPrCandidates.length === 1) return currentPrCandidates[0];
  return firstExisting(...defaults);
}

function discoveryAmbiguityRecord(name, candidates) {
  const finding = {
    item_id: "RL-DISC-001",
    code: "ambiguous_current_pr_artifact",
    message: `Multiple current-PR ${name} candidates were found; use an explicit PR body ref.`,
    path: name,
    candidates,
  };
  return {
    gate: "discovery",
    status: "ran",
    reason: null,
    output_path: null,
    exit_code: 0,
    verdict: "BLOCKED",
    report_failed: false,
    current_phase: null,
    disposition: null,
    would_block: true,
    blockers: [finding],
    warnings: [],
    required_next_actions: [
      {
        item_id: finding.item_id,
        action: finding.message,
      },
    ],
  };
}

function readChangedFiles(filePath) {
  if (!filePath) return { files: [], failure: null };
  if (!existsSync(filePath)) {
    return {
      files: [],
      failure: {
        code: "changed_files_missing",
        message: `Changed-files input does not exist: ${filePath}`,
        path: filePath,
      },
    };
  }
  try {
    return {
      files: readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .sort((a, b) => a.localeCompare(b)),
      failure: null,
    };
  } catch (error) {
    return {
      files: [],
      failure: {
        code: "changed_files_unreadable",
        message: error instanceof Error ? error.message : String(error),
        path: filePath,
      },
    };
  }
}

function findings(report, key) {
  const primary = Array.isArray(report[key]) ? report[key] : [];
  if (key === "blockers" && Array.isArray(report.hard_blocks)) return [...primary, ...report.hard_blocks];
  return primary;
}

function aggregateVerdict(verdicts) {
  if (verdicts.includes("FAILURE")) return "FAILURE";
  if (verdicts.includes("BLOCKED")) return "BLOCKED";
  if (verdicts.includes("PASS_WITH_WARN")) return "PASS_WITH_WARN";
  if (verdicts.includes("PASS")) return "PASS";
  return "SKIPPED";
}

function failureRecord(gate, finding) {
  return {
    gate,
    status: "ran",
    reason: null,
    output_path: null,
    exit_code: 1,
    verdict: "FAILURE",
    report_failed: true,
    current_phase: null,
    disposition: null,
    would_block: true,
    blockers: [finding],
    warnings: [],
    required_next_actions: [
      {
        code: finding.code,
        message: finding.message,
      },
    ],
  };
}

function readInputFailureRecord(filePath) {
  if (!existsSync(filePath)) {
    return failureRecord("input-collection", {
      code: "input_failure_missing",
      message: `Input failure artifact does not exist: ${filePath}`,
      path: filePath,
    });
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return failureRecord("input-collection", {
      code: parsed.code ?? "input_collection_failed",
      message: parsed.message ?? parsed.error ?? "Input collection failed.",
      path: parsed.path ?? filePath,
    });
  } catch (error) {
    return failureRecord("input-collection", {
      code: "input_failure_unreadable",
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
    });
  }
}

function addArg(args, key, value) {
  if (value) args.push(key, value);
}

function stringOption(value) {
  return typeof value === "string" ? value : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|");
}

function main() {
  const { options } = parseArgs(process.argv.slice(2));
  if (options.format !== "json") {
    process.stdout.write(`${JSON.stringify({
      schema: SCHEMA,
      verdict: "FAILURE",
      would_block: false,
      required_next_actions: [{ code: "unsupported_format", message: "--format json is required." }],
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const report = buildRapidLiteReport(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  main();
}
