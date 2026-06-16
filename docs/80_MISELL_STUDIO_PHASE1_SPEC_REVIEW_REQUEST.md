# 80. Misell Studio Phase 1 Spec Review Request

## Purpose

This file records the pre-implementation review request for Misell Studio Phase
1. The formal specification docs now live in:

- `docs/67_MISELL_STUDIO_NOVISIGN_BENCHMARK_SPEC.md`
- `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md`
- `docs/70_MULTI_SCREEN_ORIENTATION_CONTENT_MODEL.md`
- `docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md`
- `docs/76_RBAC_AND_SELF_SERVICE_OPERATION_SPEC.md`

The `80` series is used for review evidence and implementation handoff notes.

## Direction Reviewed By Spec

Misell Studio Phase 1 should provide the customer-paid NoviSign-like core for
Misell's 3-screen signage:

```text
Assets -> Layout -> Playlist -> Schedule -> Preview -> Publish -> Device Status -> Simple Report
```

Core rules:

- one shared Misell Studio UI
- RBAC/menu/action guards instead of separate customer/operator/advertiser apps
- template-based 3-screen layout editing first
- no Phase 1 freeform editor
- no AI Edge in this scope
- normal content may self-publish
- ad/media content requires Misell/operator approval
- Studio generates publish manifests
- Player consumes the current content-policy route and caches locally
- every publish records publish history
- Misell operator can emergency-stop a display wall

## Spec Verdict

Spec verdict: `CONDITIONAL`.

The direction is approved as a formal spec skeleton. Complete freeze required
ARC/CTO decisions for:

- canonical RBAC roles and compatibility aliases
- `site/display_wall/screen` mapping to existing `stores/screen_groups/devices`
- manifest model and publish history
- ad/media approval model
- doc numbering conflicts

## Spec Decisions Accepted

- Phase 1 may supersede split-admin wording with one UI plus RBAC.
- Advertiser/Partner portals should be deferred, not deleted from roadmap.
- PR #100 sponsorship/ad management is not a Phase 1 blocker.
- Phase 1 must not introduce a parallel manifest system unless ARC explicitly
  proves the existing content manifest flow cannot support it.
- Player local-cache playback during network failure must be an acceptance
  criterion.
- Ad/media publish guard must fail closed.
