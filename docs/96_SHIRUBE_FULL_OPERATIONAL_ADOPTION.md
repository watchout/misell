# 96. Shirube Full Operational Adoption

Status: Proposed for enforcement adoption

Date: 2026-06-23

## Decision

Misell will graduate from Shirube V3 report-only pilot to
`FULL_SHIRUBE_OPERATIONAL`.

This means Shirube is no longer only a PR comment or advisory artifact. The
GitHub workflow `Shirube Full Operational Gates` must fail when required
Shirube evidence is missing or inconsistent.

## Required PR Evidence

Every normal Misell PR must include:

- `handoff_ref` pointing to a repo-local control handoff.
- Scope and non-scope in the PR body.
- Allowed and forbidden paths in the handoff.
- Protected-surface declaration.
- Exact PR head evidence.
- Validation command evidence.
- Structured audit for the exact head.
- Owner `APPROVED_EXACT_HEAD` decision for the exact head before merge.
- Post-merge evidence after merge.

## GitHub Enforcement

The full operational workflow must:

- collect PR changed files,
- resolve the PR handoff,
- run from a trusted base/default-branch workflow context,
- execute Shirube scripts from the trusted base/default branch,
- checkout the PR head only into an inspection directory and never execute code
  from that checkout,
- collect GitHub PR comments,
- convert structured audit comments into machine-readable evidence,
- convert owner decision comments into machine-readable evidence,
- run the existing Rapid/Lite report,
- fail the check when unexpected `would_block=true` findings remain,
- fail the check when structured audit evidence is missing,
- fail the check when owner exact-head approval is missing.

The workflow can post a summary comment and upload JSON artifacts, but unlike
the report-only pilot, the final workflow step exits non-zero when the gate
would block.

The workflow uses `pull_request_target` for PR updates and `issue_comment` for
PR comments. Audit or owner decision comments therefore cause the trusted
base-branch workflow to re-evaluate against the current PR head.

## Structured Audit Requirement

Audits must use `.shirube/audit-templates/structured-audit.md`.

The audit is admissible only when:

- `target_pr` matches the PR number,
- `target_head` matches the exact PR head,
- `overall_verdict` is `PASS` or `PASS_WITH_WARN`,
- `blocking_findings` is empty,
- `required_rework` is empty,
- `auditor_actor` is in the configured auditor allowlist,
- the GitHub comment author is in the configured audit evidence poster
  allowlist,
- `auditor_actor` is not in the implementation actor set.

Free-form review comments may still be useful, but they do not satisfy the
full operational gate.

## Owner Decision Requirement

Owner approval must be a GitHub PR comment with a YAML block:

```yaml
shirube_owner_decision:
  verdict: APPROVED_EXACT_HEAD
  target_pr: 0
  exact_head_sha: "<40-char sha>"
  owner_actor: watchout
```

The workflow checks that:

- the target PR matches,
- the exact head matches,
- the verdict is `APPROVED_EXACT_HEAD`,
- the comment author is an allowed owner actor.

Owner approval without exact head is invalid.

## Protected Governance Changes

Changes to `.github/workflows/**`, Shirube gate scripts, PR templates, branch
protection, rulesets, required checks, or enforcement behavior are protected
governance changes.

They must not be bundled with product runtime work.

This adoption PR intentionally changes GitHub workflow governance but does not
mutate branch protection or rulesets through API. After the PR passes and is
merged, the owner may configure GitHub branch protection/rulesets to require
`Shirube Full Operational Gates`.

The adoption PR itself is audited as a protected governance change. Once merged,
future PRs cannot bypass the required gate by editing `.github/workflows/**` or
`scripts/shirube/**`, because those edits are part of the PR head inspection
input, not the executed gate implementation.

## Relationship To Existing Gates

Shirube full operational gates do not replace:

- existing Misell `Gate 0`,
- Cloud/Player smoke tests,
- security/CEO approval labels,
- protected human decisions.

If gates disagree, the stricter active gate wins.

## Rollback

Rollback is a normal governance revert:

- restore the previous report-only workflow,
- remove full operational scripts,
- revert docs and templates,
- remove `Shirube Full Operational Gates` from required checks if the owner has
  enabled it in branch protection/rulesets.

No product data migration or runtime rollback is required.
