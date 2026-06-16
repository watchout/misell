# 81. Misell Studio Phase 1 ARC And CTO-Security Verdict

## ARC Verdict

ARC verdict: `CONDITIONAL GO`.

Implementation may start, but Phase 1 PRs are protected work:

- `route:protected`
- `gate:0`
- `needs:cto-security`

Out of scope remains fixed:

- AI Edge
- freeform editor
- SSO
- advanced ad optimization
- accounting

## Canonical RBAC

| Role | Scope | Mapping |
| --- | --- | --- |
| `misell_owner` | all tenants | keep |
| `misell_operator` | all tenants | keep; ad/media approval and emergency stop |
| `device_ops` | assigned/all devices | keep; device/status/sync only |
| `customer_admin` | tenant | migrate from `store_admin` |
| `customer_editor` | tenant | new |
| `customer_viewer` | tenant read-only | migrate from `store_viewer` |
| `advertiser` | own advertiser/campaign | keep; own material submission only |

`store_admin` and `store_viewer` are compatibility aliases only. New Phase 1
code must use `customer_admin` and `customer_viewer`.

Tenant isolation is mandatory. API authorization must derive tenant scope from
authenticated membership/session, never from request body/query authority.

## Canonical Domain Model

```text
tenant -> site -> display_wall -> screen -> device binding
```

Storage mapping:

- `tenant` -> `tenants`
- `site` -> `stores`
- `display_wall` -> `screen_groups`
- `screen` -> new `screens` table
- physical player -> existing `devices`
- binding -> new `screen_device_bindings`

Migration is additive only. Existing `stores`, `screen_groups`, and `devices`
remain valid. A legacy 3-device screen group fixture must map deterministically
to left/center/right screens; if order cannot be inferred, migration must fail
instead of guessing.

## Manifest And Approval Decisions

Do not create a parallel manifest system. Extend:

- `content_manifests`
- `cloud_assets`
- `content_manifest_assets`
- `device_asset_states`

Add:

- `publish_history`
- manifest scope fields: `tenant_id`, `site_id`, `display_wall_id`, optional
  `screen_id`
- `manifest_schema_version`
- monotonic `manifest_version`
- `content_hash`

Ad/media approval uses a lightweight `content_approvals` model with:

- `content_type`: `normal`, `ad`, `sponsor`, `emergency`
- `approval_status`: `not_required`, `draft`, `pending`, `approved`,
  `rejected`, `revoked`, `expired`
- `subject_type`: `asset`, `layout`, `playlist_item`, `manifest_item`

Publish guard must fail closed. Normal content requires explicit
`not_required`; ad/sponsor requires `approved`; unknown, missing, pending,
rejected, revoked, expired, or hash mismatch blocks publish.

## CTO-Security Verdict

CTO-security verdict: `CONDITIONAL GO to open PR1 on GitHub as draft/protected`.

This is not a merge approval. Final security approval requires:

- PR URL
- exact head SHA
- diff
- Gate 0 evidence

Required before merge:

- tenant isolation tests cover cross-tenant read, write, publish, approval,
  device-status, and report access
- RBAC matrix is deny-by-default with explicit allow rows
- legacy aliases normalize at boundary only
- publish guard binds approval to immutable content identity: content type,
  manifest/content hash, tenant/site/display-wall scope, approval status,
  expiration, and revocation
- emergency publish requires `misell_owner` or `misell_operator`, audit reason,
  actor id, and timestamp
- migration remains additive; no destructive rename/drop
- current `GET /api/device/content-policy` route remains compatible

Legal/privacy may be carry-forward for PR1 if it only defines the technical
fail-closed approval contract. Add `needs:legal-privacy` before activation if
ad policy, prohibited categories, sponsor claims, rejection reasons, advertiser
data, reporting, or attribution are included.
