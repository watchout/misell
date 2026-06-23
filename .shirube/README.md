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

Promotion to required checks requires a later owner-approved PR after several
real Misell PRs have run through this report-only workflow with acceptable false
positive rate and runtime.
