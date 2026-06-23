#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFullOperationalGateReport } from "./check-full-operational-gates.mjs";
import { collectGithubPrEvidence } from "./collect-github-pr-evidence.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "misell-shirube-full-gate-"));
try {
  smokeFullAdoptionPasses();
  smokeMissingAuditBlocks();
  smokeNormalWouldBlockBlocks();
  smokeAuditCollectorAllowsIndependentAuditor();
  smokeAuditCollectorRejectsImplementationActor();
  process.stdout.write("smoke-full-operational-gates PASS\n");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function smokeFullAdoptionPasses() {
  const fixture = createFixture("pass", {
    auditValid: true,
    ownerValid: true,
    aggregate: adoptionAggregate(["RL-CELL-006", "LC-EXEC-002"]),
  });
  const report = runFixture(fixture);
  assert(report.verdict === "PASS_WITH_WARN", "full adoption should pass with expected Rapid/Lite warnings");
  assert(report.would_block === false, "full adoption expected blockers should not block");
}

function smokeMissingAuditBlocks() {
  const fixture = createFixture("missing-audit", {
    auditValid: false,
    ownerValid: true,
    aggregate: adoptionAggregate(["RL-CELL-006", "LC-EXEC-002"]),
  });
  const report = runFixture(fixture);
  assert(report.would_block === true, "missing audit should block");
  assert(hasBlocker(report, "FULL-AUDIT-002"), "missing audit blocker should be present");
}

function smokeNormalWouldBlockBlocks() {
  const fixture = createFixture("normal-block", {
    auditValid: true,
    ownerValid: true,
    adoption: false,
    aggregate: normalAggregate(["RL-PR-002"]),
  });
  const report = runFixture(fixture);
  assert(report.would_block === true, "normal Rapid/Lite blockers should block");
  assert(hasBlocker(report, "FULL-RAPID-003"), "Rapid/Lite blocker should be present");
}

function smokeAuditCollectorAllowsIndependentAuditor() {
  const fixture = createCommentsFixture("audit-collector-pass", {
    auditorActor: "codex-audit",
    auditVerdict: "PASS",
  });
  const report = collectGithubPrEvidence({
    "comments-json": fixture.comments,
    "pr-number": "999",
    "head-sha": fixture.head,
    "auditor-actors": "codex-audit",
    "audit-comment-authors": "watchout",
    "implementation-actors": "codex",
    "owner-actors": "watchout",
    "out-dir": path.join(fixture.dir, "out"),
  });
  assert(report.audit.valid === true, "allowed independent auditor should be accepted");
}

function smokeAuditCollectorRejectsImplementationActor() {
  const fixture = createCommentsFixture("audit-collector-self", {
    auditorActor: "codex",
    auditVerdict: "PASS",
  });
  const report = collectGithubPrEvidence({
    "comments-json": fixture.comments,
    "pr-number": "999",
    "head-sha": fixture.head,
    "auditor-actors": "codex-audit,codex",
    "audit-comment-authors": "watchout",
    "implementation-actors": "codex",
    "owner-actors": "watchout",
    "out-dir": path.join(fixture.dir, "out"),
  });
  assert(report.audit.valid === false, "implementation actor must not satisfy structured audit");
  assert(
    report.audit.candidates?.some((candidate) => candidate.maker_checker_separated === false),
    "maker-checker rejection should be visible",
  );
}

function createFixture(name, options) {
  const dir = path.join(tmp, name);
  const head = "0123456789abcdef0123456789abcdef01234567";
  const handoff = path.join(dir, "handoff.yaml");
  const changed = path.join(dir, "changed-files.txt");
  const aggregate = path.join(dir, "aggregate.json");
  const githubEvidence = path.join(dir, "github-evidence.json");
  const audit = path.join(dir, "audit.json");
  const owner = path.join(dir, "owner.yaml");
  const resultDir = path.join(dir, "result");

  mkdirSync(dir, { recursive: true });
  writeFileSync(handoff, renderHandoff({ adoption: options.adoption !== false, head }));
  writeFileSync(changed, [
    ".github/workflows/shirube-full-operational-gates.yml",
    "scripts/shirube/check-full-operational-gates.mjs",
  ].join("\n") + "\n");
  writeFileSync(aggregate, `${JSON.stringify(options.aggregate, null, 2)}\n`);
  writeFileSync(audit, `${JSON.stringify(auditEvidence({ valid: options.auditValid, head }), null, 2)}\n`);
  writeFileSync(owner, renderOwner({ valid: options.ownerValid, head }));
  writeFileSync(githubEvidence, `${JSON.stringify({
    schema: "shirube-github-pr-evidence/v1",
    target_pr: "999",
    target_head: head,
    audit: auditEvidence({ valid: options.auditValid, head }),
    owner_decision: ownerEvidence({ valid: options.ownerValid, head }),
  }, null, 2)}\n`);

  return { dir, head, handoff, changed, aggregate, githubEvidence, audit, owner, resultDir };
}

function createCommentsFixture(name, options) {
  const dir = path.join(tmp, name);
  const head = "0123456789abcdef0123456789abcdef01234567";
  const comments = path.join(dir, "comments.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(comments, `${JSON.stringify([
    {
      id: 1,
      html_url: "https://github.com/watchout/misell/pull/999#issuecomment-1",
      body: [
        "## Structured Audit",
        "",
        "```yaml",
        `auditor_actor: ${options.auditorActor}`,
        "target_pr: 999",
        `target_head: \"${head}\"`,
        "item_set_ref: .shirube/audit-templates/structured-audit.md",
        `overall_verdict: ${options.auditVerdict}`,
        "blocking_findings: []",
        "required_rework: []",
        "warnings: []",
        "cto_review_required: N/A",
        "owner_decision_made: false",
        "```",
      ].join("\n"),
      user: { login: "watchout" },
      created_at: "2026-06-23T00:00:00Z",
      updated_at: "2026-06-23T00:00:00Z",
    },
    {
      id: 2,
      html_url: "https://github.com/watchout/misell/pull/999#issuecomment-2",
      body: [
        "```yaml",
        "shirube_owner_decision:",
        "  verdict: APPROVED_EXACT_HEAD",
        "  target_pr: 999",
        `  exact_head_sha: \"${head}\"`,
        "  owner_actor: watchout",
        "```",
      ].join("\n"),
      user: { login: "watchout" },
      created_at: "2026-06-23T00:01:00Z",
      updated_at: "2026-06-23T00:01:00Z",
    },
  ], null, 2)}\n`);
  return { dir, head, comments };
}

function runFixture(fixture) {
  return buildFullOperationalGateReport({
    "pr-number": "999",
    "head-sha": fixture.head,
    "changed-files": fixture.changed,
    handoff: fixture.handoff,
    aggregate: fixture.aggregate,
    "github-evidence": fixture.githubEvidence,
    audit: fixture.audit,
    "owner-decision": fixture.owner,
    "result-dir": fixture.resultDir,
  });
}

function renderHandoff({ adoption, head }) {
  return [
    "schema_version: shirube-control-handoff/full-operational/v1",
    "mode: full-operational",
    "profile: misell",
    "control_handoff_id: CH-MISELL-SMOKE",
    "repo: watchout/misell",
    "repo_local_issue: https://github.com/watchout/misell/issues/999",
    `pr_head_sha: ${head}`,
    "owner:",
    "  role: repo_owner",
    "  actor: watchout",
    "next_role: audit",
    adoption ? "full_operational_adoption: true" : "full_operational_adoption: false",
    adoption ? "governance_change:" : "governance_change:",
    adoption ? "  type: shirube_full_operational_adoption" : "  type: normal_pr",
    "  protected_surfaces:",
    "    - github_actions_workflow",
    "    - shirube_gate_enforcement",
    "cell:",
    adoption ? "  cell_type: protected_stop" : "  cell_type: code_lite",
    "  allowed_paths:",
    "    - .github/workflows/**",
    "    - scripts/shirube/**",
    "  forbidden_paths:",
    "    - .env",
    "    - .env.*",
    "    - secrets/**",
    "  protected_surfaces:",
    "    - github_actions_workflow",
    "    - shirube_gate_enforcement",
    "",
  ].join("\n");
}

function adoptionAggregate(itemIds) {
  return {
    schema: "shirube-rapid-lite-report/v1",
    report_failed: false,
    would_block: itemIds.length > 0,
    gates: [
      { gate: "gate-contract", blockers: itemIds.filter((id) => id.startsWith("RL-")).map((id) => ({ item_id: id })) },
      { gate: "lifecycle", blockers: itemIds.filter((id) => id.startsWith("LC-")).map((id) => ({ item_id: id })) },
    ],
  };
}

function normalAggregate(itemIds) {
  return {
    schema: "shirube-rapid-lite-report/v1",
    report_failed: false,
    would_block: itemIds.length > 0,
    gates: [
      { gate: "gate-contract", blockers: itemIds.map((id) => ({ item_id: id })) },
    ],
  };
}

function auditEvidence({ valid, head }) {
  return {
    schema: "shirube-structured-audit-evidence/v1",
    valid,
    target_pr: "999",
    target_head: head,
    overall_verdict: valid ? "PASS" : "FAIL",
    blocking_findings_count: valid ? 0 : 1,
    required_rework_count: 0,
    auditor_actor: "auditor",
    comment_actor: "auditor",
    comment_ref: "https://github.com/watchout/misell/pull/999#issuecomment-1",
  };
}

function ownerEvidence({ valid, head }) {
  return {
    schema: "shirube-owner-decision-evidence/v1",
    valid,
    verdict: valid ? "APPROVED_EXACT_HEAD" : "CHANGES_REQUIRED",
    target_pr: "999",
    exact_head_sha: head,
    owner_actor: "watchout",
    comment_actor: "watchout",
    comment_ref: "https://github.com/watchout/misell/pull/999#issuecomment-2",
  };
}

function renderOwner({ valid, head }) {
  return [
    "schema_version: shirube-owner-decision-evidence/v1",
    `verdict: ${valid ? "APPROVED_EXACT_HEAD" : "CHANGES_REQUIRED"}`,
    "target_pr: \"999\"",
    `exact_head_sha: \"${head}\"`,
    "owner_actor: watchout",
    "decision_ref: https://github.com/watchout/misell/pull/999#issuecomment-2",
    "",
  ].join("\n");
}

function hasBlocker(report, itemId) {
  return report.blockers.some((blocker) => blocker.item_id === itemId);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
