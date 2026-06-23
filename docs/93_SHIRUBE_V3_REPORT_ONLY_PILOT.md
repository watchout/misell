# 93. Shirube V3 Report-Only Pilot

Status: Accepted for pilot

Date: 2026-06-23

## Decision

Misell will adopt Shirube V3 Rapid/Lite as a report-only governance and evidence
layer before considering any required-check or branch-protection integration.

The pilot is allowed because it does not change product runtime behavior,
deployment, branch protection, required checks, security approval labels, or
merge authority.

## Scope

This pilot adds:

- `.shirube/repo-spec.yaml`
- `.shirube/adoption-intake.yaml`
- `.shirube/existing-state-scan.yaml`
- `.shirube/control-handoff.yaml`
- `.shirube/lifecycle-state.yaml`
- `.shirube/design-rule-packs/shirube-default-design-rules.yaml`
- `.shirube/gate-contracts/shirube-v3-rapid-lite-gate-contract-matrix.yaml`
- vendored Rapid/Lite report scripts under `scripts/shirube`
- a pull-request workflow that posts one report-only PR comment and uploads JSON
  artifacts

## Non-Scope

This pilot must not:

- replace Misell Gate 0
- become a required check
- modify branch protection or rulesets
- approve or deny merges by itself
- replace GitHub structured audit comments
- replace `needs:cto-security` or `route:ceo-approval`
- run product code, mutate databases, deploy, publish, or operate devices
- call external AI

## Authority Model

Existing authority remains unchanged:

- Mechanical CI: existing `Gate 0`
- Semantic audit: GitHub structured audit comments
- Protected security/CEO decisions: labels and approval comments
- Merge: repository owner/human authority

Shirube may produce:

- advisory `PASS`, `PASS_WITH_WARN`, or `BLOCKED` findings
- `would_block` evidence in a PR comment
- JSON artifacts for later audit

Shirube may not convert these findings into enforced branch protection until a
separate owner-approved graduation PR.

## Policy Coverage

The Misell rule pack is aligned with
`docs/92_DETERMINISTIC_CONTROL_AND_DATA_POLICY_ADR.md` and reports on:

- LLM-as-authority wording
- hard delete without soft-delete/retention policy
- low-generality domain shapes
- duplicated business logic
- scattered configurable values
- protected surface changes without an explicit Cell declaration

These checks are intentionally imperfect and advisory during the pilot.

## Promotion Criteria

Before making any Shirube check required, at least three real Misell PRs should
run through the report-only workflow and the owner should confirm:

- false positives are acceptable
- runtime is acceptable
- report comments improve review quality
- Shirube findings do not duplicate or confuse existing audit comments
- the upstream Shirube V3 enforcement model is stable enough for Misell

Graduation must be a separate PR. That PR must explicitly state which checks
become required and must not bundle product feature work.

## Development and Audit Flow

Misell development and audit work should follow
`docs/94_SHIRUBE_V3_DEVELOPMENT_AND_AUDIT_FLOW.md` after this pilot is merged.

In short:

- every normal PR gets a repo-local Rapid/Lite control handoff
- the PR body includes `handoff_ref`
- implementation stays inside the handoff boundary
- audit comments include exact head and verdict
- owner decision remains a human GitHub decision during the report-only pilot

## Rollback

Rollback is straightforward because the pilot is non-runtime:

- remove `.github/workflows/shirube-rapid-lite-gates-report.yml`
- remove `.shirube/**`
- remove `scripts/shirube/**`
- remove the npm script added for local report generation

No data migration or production rollback is required.
