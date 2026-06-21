# 82. Misell Studio Phase 1 PR1 Implementation Handoff

## Status

Misell Studio Phase 1 is `CONDITIONAL GO`.

PR1 may be opened as draft/protected. It is not production activation and not a
customer rollout.

Labels:

- `route:protected`
- `gate:0`
- `needs:cto-security`
- `needs:legal-privacy` or explicit legal/privacy carry-forward

## PR1 Scope

PR1 is only the RBAC/domain contract and migration foundation before Studio UI:

1. canonical role constants and compatibility aliases
2. RBAC action guard contract
3. tenant-scope resolution contract
4. additive Store/ScreenGroup canonical domain mapping contract
5. legacy migration fixture for one `screen_group` with 3 devices
6. ScreenSlot / DeviceBinding supporting model for left/center/right output mapping
7. manifest extension contract shape
8. lightweight ad/media approval contract
9. fail-closed publish guard tests

## Canonical Vocabulary

#152 and `docs/91_CANONICAL_DOMAIN_VOCABULARY_ADR.md` select Option A.

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
If this PR keeps them in migration or helper code, they must be documented as:

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

## Non-Goals

- Studio dashboard UI
- asset upload UI
- layout editor UI
- schedule UI
- advanced ad optimization
- PR #100 billing/campaign integration
- AI Edge
- SSO
- freeform editor
- accounting

## Required Tests

PR1 must cover:

- role alias normalization
- RBAC deny-by-default action guard matrix
- tenant isolation fail-closed behavior
- cross-tenant read, write, publish, approval, device-status, and report-style
  access
- legacy 3-device screen group mapping to left/center/right ScreenSlots
- manifest JSON contract shape using canonical Store/ScreenGroup scope or clearly documented aliases
- ad/media fail-closed publish guard
- approval binding to tenant/store/screen-group/content hash
- emergency operator-only path
- emergency actor id, timestamp, and audit reason requirements

## Acceptance Criteria

- New code can authorize against the canonical role/action matrix.
- Legacy `store_admin` and `store_viewer` normalize to canonical customer roles.
- Tenant scope is derived from authenticated membership, not request bodies.
- The legacy 3-device screen group fixture maps deterministically to left/center/right ScreenSlots.
- Manifest contract extends existing content manifest flow.
- No parallel manifest system is introduced.
- `site/display_wall/screen` are not exposed as long-term canonical top-level scopes.
- Ad/media publish guard fails closed.
- Publish history contract records version, rollback, and approval evidence.
- PR can pass Gate 0 with the required new tests.
