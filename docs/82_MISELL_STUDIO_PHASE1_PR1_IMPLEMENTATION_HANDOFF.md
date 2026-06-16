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
4. additive domain mapping contract for `site/display_wall/screen`
5. legacy migration fixture for one `screen_group` with 3 devices
6. manifest extension contract shape
7. lightweight ad/media approval contract
8. fail-closed publish guard tests

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
- legacy 3-device screen group mapping to left/center/right screens
- manifest JSON contract shape
- ad/media fail-closed publish guard
- approval binding to tenant/site/display-wall/content hash
- emergency operator-only path
- emergency actor id, timestamp, and audit reason requirements

## Acceptance Criteria

- New code can authorize against the canonical role/action matrix.
- Legacy `store_admin` and `store_viewer` normalize to canonical customer roles.
- Tenant scope is derived from authenticated membership, not request bodies.
- The legacy 3-device screen group fixture maps deterministically to a
  3-screen display wall.
- Manifest contract extends existing content manifest flow.
- No parallel manifest system is introduced.
- Ad/media publish guard fails closed.
- Publish history contract records version, rollback, and approval evidence.
- PR can pass Gate 0 with the required new tests.
