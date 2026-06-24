# 97. Shirube V3 Overlay Refresh

Status: Proposed

Date: 2026-06-24

## Decision

Misell will apply the newer Shirube V3 overlay artifacts from
`watchout/ai-dev-framework@6917720d0ea02fe96f3b7752aa802bc135ec1b19` as an
additive governance layer.

This does not replace the existing `Shirube Full Operational Gates` workflow.
The existing full operational gate remains the hard gate for Misell PRs.

## What Changes

- Add a pinned ADF reusable Rapid/Lite report-only workflow caller.
- Add execution-context, enforcement-policy, control-state, and source-mirror
  artifacts under `.shirube`.
- Refresh the framework lock and repo spec to the pinned ADF commit.
- Update the structured audit template so audits can be itemized against a
  checklist.

## Non-Scope

- No runtime, API, DB, device, billing, package, deploy, or secret changes.
- No branch protection, ruleset, or required-check mutation.
- No replacement of `Shirube Full Operational Gates`.
- No copying of new ADF scripts into `scripts/shirube/**`.
- No claim that the reusable caller is an enforcing gate.

## Operating Model

Misell uses two Shirube signals after this refresh:

- `Shirube Full Operational Gates`: existing Misell hard gate.
- `Shirube Rapid/Lite Gates Report`: additive report-only ADF overlay signal.

If the two disagree, the stricter active gate wins. Owner exact-head decision,
structured audit, Gate 0, and any security/CEO gate remain authoritative.

The reusable ADF Rapid/Lite caller does not currently collect GitHub PR
audit/owner comments. Exact-head owner decision and structured audit
admissibility therefore remain enforced by the existing Misell full operational
gate.

## Audit Requirement

Governance cells should ask for an itemized audit. The audit should answer the
handoff acceptance criteria, stop conditions, path scope, protected surfaces,
validation evidence, owner decision boundary, and post-merge requirement.

Executable checklist items need command, diff, CI, or gate evidence. Prose alone
does not satisfy executable evidence.

## Future Work

Replacing Misell's local full operational gate with an ADF reusable full gate is
not part of this refresh. That requires a later protected governance cell after
ADF exposes equivalent trusted full-operational enforcement.
