# Shirube V3 Report-Only Pilot

This directory contains the Misell pilot configuration for Shirube V3
Rapid/Lite.

The pilot is intentionally non-blocking:

- existing GitHub Actions `Gate 0` remains the required mechanical gate
- existing GitHub audit comments remain the semantic review record
- existing `needs:cto-security` / `route:ceo-approval` labels remain the
  protected authority gates
- Shirube records PR-visible evidence and JSON artifacts only
- Shirube findings do not fail CI and do not change branch protection

The first useful signal is whether Shirube can identify scope drift, missing
handoff evidence, owner decision gaps, hard-delete risk, LLM-authority wording,
duplicated logic, and scattered configurable values without slowing normal
Misell PR flow.

Normal development should use a per-PR control handoff:

1. copy `.shirube/control-handoffs/TEMPLATE.rapid-lite.yaml`
2. fill a concrete file under `.shirube/control-handoffs/`
3. add `handoff_ref: .shirube/control-handoffs/<file>.yaml` to the PR body
4. post structured audits using `.shirube/audit-templates/structured-audit.md`

The detailed operating flow is documented in
`docs/94_SHIRUBE_V3_DEVELOPMENT_AND_AUDIT_FLOW.md`.

Partial multi-repo adoption rules are documented in
`docs/95_SHIRUBE_PARTIAL_ADOPTION_GUARD.md`. Repositories without `.shirube`
should use `.shirube/gate-pack-bridge/TEMPLATE.yaml` as a bridge and must not
claim full Shirube V3 control.

Promotion to required checks requires a later owner-approved PR after several
real Misell PRs have run through this report-only workflow with acceptable false
positive rate and runtime.
