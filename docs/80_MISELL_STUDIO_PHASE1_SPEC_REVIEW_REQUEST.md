# 80. Misell Studio Phase 1 Spec Review Request

## Purpose

This file records the pre-implementation review request for Misell Studio Phase
1. The formal specification docs now live in:

- `docs/67_MISELL_STUDIO_NOVISIGN_BENCHMARK_SPEC.md`
- `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md`
- `docs/70_MULTI_SCREEN_ORIENTATION_CONTENT_MODEL.md`
- `docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md`
- `docs/76_RBAC_AND_SELF_SERVICE_OPERATION_SPEC.md`
- `docs/91_CANONICAL_DOMAIN_VOCABULARY_ADR.md` from PR #150

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
- Misell operator can emergency-stop a ScreenGroup

## Canonical Vocabulary Update

The cross-PR vocabulary decision is recorded in #152 and `docs/91_CANONICAL_DOMAIN_VOCABULARY_ADR.md`.

Canonical vocabulary:

```text
Tenant
Store
ScreenGroup
Device
```

Canonical IDs:

```text
tenant_id
store_id
screen_group_id
device_id
```

`site`, `display_wall`, and `screen` are not long-term canonical scope terms.
For this PR, they are compatibility aliases or supporting implementation details:

- `site` -> Store alias / UI label
- `display_wall` -> ScreenGroup alias / UI label
- `screen` -> ScreenSlot under ScreenGroup
- `screen_device_bindings` -> DeviceBinding under ScreenSlot

Allowed supporting model:

```text
ScreenGroup
  └── ScreenSlot(left/center/right/wide logical slot)
       └── DeviceBinding / connector / EDID / resolution mapping
```

## Spec Verdict

Spec verdict: `CONDITIONAL`.

The direction is approved as a formal spec skeleton. Complete freeze required
ARC/CTO decisions for:

- canonical RBAC roles and compatibility aliases
- Store/ScreenGroup canonical mapping and `site/display_wall/screen` alias boundaries
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
- New scopes must use `tenant_id`, `store_id`, `screen_group_id`, and `device_id` as canonical IDs.
