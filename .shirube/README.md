# Shirube V3 Full Operational Gate

This directory contains the Misell Shirube V3 governance configuration.

Misell has graduated from report-only pilot to `FULL_SHIRUBE_OPERATIONAL`.
Shirube evidence is now evaluated by the GitHub check
`Shirube Full Operational Gates`.

The check is expected to fail when:

- `handoff_ref` is missing,
- changed files are outside the handoff boundary,
- forbidden paths are touched,
- a structured audit for the exact PR head is missing,
- owner `APPROVED_EXACT_HEAD` evidence is missing,
- unexpected Rapid/Lite `would_block=true` findings remain.

The workflow runs from the trusted base/default branch context. The PR head is
checked out only under `pr/` for inspection, and Shirube scripts are executed
from the trusted base checkout.

Normal development should use a per-PR control handoff:

1. copy `.shirube/control-handoffs/TEMPLATE.rapid-lite.yaml`
2. fill a concrete file under `.shirube/control-handoffs/`
3. add `handoff_ref: .shirube/control-handoffs/<file>.yaml` to the PR body
4. post structured audits using `.shirube/audit-templates/structured-audit.md`
5. post owner decision using the `shirube_owner_decision` YAML shape

Structured audits must use an allowed `auditor_actor`, be posted by an allowed
evidence poster, and satisfy maker-checker separation from the implementation
actor set.

The detailed full operational flow is documented in
`docs/96_SHIRUBE_FULL_OPERATIONAL_ADOPTION.md`.

Historical pilot documents remain in `docs/93_*`, `docs/94_*`, and `docs/95_*`
as background and migration context.
