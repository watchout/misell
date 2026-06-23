# Shirube Multi-Repo Adoption Ledger

This is the minimum ledger shape for tracking partial Shirube adoption across
repositories. Keep the authoritative copy in a control issue, control repo, or
team README. This file is a template/example for Misell and sibling repos.

| Repo | Shirube Status | Control Source | Current Mode | Owner | Last Exact-Head Decision | Next Step |
| --- | --- | --- | --- | --- | --- | --- |
| watchout/misell | RAPID_LITE_REPORT_ONLY | watchout/misell#182 | report-only pilot | watchout | pending | audit and merge #182 |
| watchout/ai-dev-framework | RAPID_LITE_REPORT_ONLY | watchout/ai-dev-framework#458 | self-dogfood | watchout | see repo | #484 / overlay pack |
| owner/repo-without-overlay | PARTIAL_SHIRUBE_PILOT | owner/control-repo#0 | gate-pack-bridge | owner | pending | add overlay adoption PR |
| owner/repo-not-controlled | NOT_SHIRUBE_CONTROLLED | none | none | owner | none | create adoption intake |

## Status Vocabulary

- `FULL_OVERLAY_PENDING`: Not formally adopted yet; using only gate-pack ideas.
- `PARTIAL_SHIRUBE_PILOT`: Some gates, handoff, or owner decision controls are in use.
- `RAPID_LITE_REPORT_ONLY`: `.shirube` and report-only workflow are present.
- `OWNER_BLOCK`: Owner commits not to merge while `would_block=true`.
- `NOT_SHIRUBE_CONTROLLED`: Shirube-like review may happen, but the repo is not under Shirube control.
