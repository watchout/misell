# 95. Shirube Partial Adoption Guard

Status: Accepted for pilot

Date: 2026-06-23

## Decision

Misell and sibling repositories may use Shirube V3 concepts before full overlay
adoption, but partial use must be explicitly classified and bounded.

Do not describe a repository as `Shirube V3 complete`, `enforced`, or `fully
controlled` unless a later owner-approved overlay/enforcement PR has actually
made that true.

## Repository Status Vocabulary

Every repository using Shirube concepts must be classified as one of:

- `FULL_OVERLAY_PENDING`: Shirube formal overlay is not installed yet; only
  gate-pack ideas are being used.
- `PARTIAL_SHIRUBE_PILOT`: Some gates, handoff, or owner decision controls are
  in use, but there is no full overlay.
- `RAPID_LITE_REPORT_ONLY`: `.shirube` and report-only workflow are present.
- `OWNER_BLOCK`: Owner commits not to merge while `would_block=true`.
- `NOT_SHIRUBE_CONTROLLED`: Shirube-like review may happen, but the repo is not
  under Shirube control.

Misell's status after PR #182 is `RAPID_LITE_REPORT_ONLY`.

## Minimum PR Evidence

Any PR claiming Shirube partial control must include:

1. Control source: issue, comment, handoff, or spec reference.
2. Scope and non-scope.
3. Allowed paths and forbidden paths.
4. Protected surface declaration.
5. Exact head SHA.
6. Validation evidence.
7. Owner decision for the exact head.
8. Post-merge evidence requirement.

Without these, the PR may use Shirube language informally but must not be
treated as Shirube-controlled.

## Gate Pack Bridge

Repositories without `.shirube` must use a Gate Pack Bridge block in the PR body
or a durable GitHub comment.

Template:

```yaml
shirube_gate_pack:
  schema_version: shirube-gate-pack-bridge/v1
  mode: partial_shirube_pilot
  target_repo: owner/repo
  target_pr: 0
  control_source:
    type: github_issue
    ref: owner/control-repo#0
  scope:
    - "<this PR changes ...>"
  non_scope:
    - runtime architecture change
    - DB migration
    - branch protection
    - required check activation
  allowed_paths:
    - "src/safe-area/**"
  forbidden_paths:
    - ".github/workflows/**"
    - "migrations/**"
    - ".env*"
    - "secrets/**"
  protected_surfaces:
    touched: false
    declared:
      - none
  validation:
    commands:
      - "npm test"
      - "npm run lint"
    result: PASS
  exact_head_sha: "<PR_HEAD_SHA>"
  owner_decision:
    verdict: APPROVED_EXACT_HEAD
    actor: "<owner>"
    decision_ref: "<comment-url>"
  post_merge:
    required: true
```

This is not a full Shirube overlay. It is the bridge used until an overlay
adoption PR exists.

## Multi-Repo Ledger

The team must keep a central adoption ledger in a control issue, control repo,
or team README.

Minimum table:

```text
Repo | Shirube status | Control source | Current mode | Owner | Last exact-head decision | Next step
```

The template/example is `.shirube/repo-adoption-ledger.example.md`.

## Operating Rules

During partial adoption:

- LLM judgment alone must not be called merge-ready.
- Owner approval without exact head is invalid.
- Protected surfaces must be declared.
- Auth, DB, workflow, deploy, secret, required check, and branch protection work
  is not lightweight.
- Adoption PRs and runtime PRs must not be bundled.
- Repositories without `.shirube` are `gate-pack-bridge`, not adopted.
- `BLOCKED` or `would_block=true` requires owner exception or rework before
  merge.
- Each repository should move toward a dedicated overlay adoption PR.

## Safe-To-Use Components

The following Shirube V3 components may be used across repositories now:

- Repository Premise Spec thinking
- control handoff
- allowed paths / forbidden paths
- exact-head owner decision
- post-merge evidence
- soft-delete principle
- duplicate logic warning
- hardcoded variable warning
- LLM final authority ban
- protected surface declaration

## Cautious Components

Do not casually roll out:

- required checks
- branch protection or ruleset changes
- CI hard-blocking
- workflow auto-distribution
- bulk multi-repo changes
- V3 complete/enforced claims

## ADF Continuation

The ai-dev-framework/Shirube side should continue separately:

- enforcement graduation
- Gate Pack Bridge standardization
- Control Plane Overlay / Adoption Driver

Misell should consume those only after they are stable enough for an explicit
owner-approved PR.
