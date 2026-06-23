# 94. Shirube V3 Development and Audit Flow

Status: Superseded for Misell by `docs/96_SHIRUBE_FULL_OPERATIONAL_ADOPTION.md`

Date: 2026-06-23

## Purpose

This document defines how Misell development and audit work proceeded while
Shirube V3 Rapid/Lite was in report-only pilot mode.

Current Misell PRs use the full operational GitHub-gated flow in
`docs/96_SHIRUBE_FULL_OPERATIONAL_ADOPTION.md`.

The flow changes the working discipline, not the merge authority. Existing Gate
0, GitHub structured audit, and security/CEO gates remain authoritative until a
separate owner-approved graduation PR changes that.

## Development Flow

1. Start from current `main`.
2. Create or identify the repo-local GitHub issue/PR anchor.
3. Create a Rapid/Lite control handoff for the work.
   - Use `.shirube/control-handoffs/TEMPLATE.rapid-lite.yaml`.
   - Store concrete handoffs under `.shirube/control-handoffs/`.
   - Give each handoff a unique `control_handoff_id` and `CELL-ID`.
4. State the exact implementation boundary before editing code.
   - `goal`
   - `non_scope`
   - `allowed_paths`
   - `forbidden_paths`
   - `stop_conditions`
   - required validation commands
5. Open a draft PR.
6. Include `handoff_ref: .shirube/control-handoffs/<file>.yaml` in the PR body.
7. Implement only inside the handoff boundary.
8. Run the validation commands listed in the handoff.
9. Let GitHub run existing Gate 0 and the Shirube report-only workflow.
10. If Shirube reports `BLOCKED`, treat it as review evidence:
    - fix real scope/evidence gaps
    - document expected report-only bootstrap findings
    - do not merge while a human audit or existing Gate 0 blocks the PR

## Audit Flow

1. Audit the exact PR head, not a moving branch name.
2. Use the handoff as the audit boundary.
3. Verify:
   - changed files are inside `allowed_paths`
   - no `forbidden_paths` were touched
   - non-scope behavior was not introduced
   - required validation evidence exists
   - Gate 0 passed
   - Shirube report comment/artifacts exist
   - protected security/CEO labels are present when required
4. Post a structured audit comment on GitHub.
   - Use `.shirube/audit-templates/structured-audit.md`.
   - Include `target_head`.
   - Include `overall_verdict`.
   - List blocking findings first.
5. If rework is needed, keep the PR draft or blocked until a scoped re-audit is
   posted against the new head.
6. If audit passes, the owner may mark ready for review or merge according to
   the existing repository process.

## Owner Decision

Rapid/Lite expects an owner exact-head decision before merge.

During the report-only pilot, this owner decision may be recorded as a GitHub PR
comment instead of a committed evidence file. The Shirube workflow may still
show `owner_decision_missing` because it does not yet parse GitHub comments as
machine-readable owner decision input.

That is acceptable only while the workflow is report-only. Once Shirube is
promoted toward enforcement, owner decision evidence must become machine
readable.

## Escalation Out of Rapid/Lite

Do not use Rapid/Lite as the controlling lane when the PR includes:

- auth or permission changes
- security boundary changes
- DB migration or destructive data changes
- production/deploy changes
- branch protection, ruleset, or required-check activation
- secret read/write
- remote device operation changes
- irreversible customer-impacting operations

Those changes require a Standard/Enterprise-style handoff or explicit
security/CEO gate before implementation.

## Relationship to Existing Misell Process

Shirube V3 report-only flow supplements, but does not replace:

- Gate 0
- GitHub structured audit comments
- security/CEO approval labels
- owner merge decision

If these disagree during the pilot, the stricter human/governance decision wins.

## Post-Merge

After merge:

- record the merge commit in the PR conversation or follow-up evidence
- run any post-merge smoke if the handoff requires it
- close or update the linked issue
- create follow-up issues for non-blocking warnings that should not be bundled
  into the same PR
