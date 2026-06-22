# MVP Canonical Architecture Decisions

Status: implemented baseline ADR

This document is the current single reference for the MVP runtime vocabulary and responsibility boundaries implemented in `main`.

## Canonical Scope Vocabulary

Use these names as canonical DB/API/reporting terms:

| Concept | Canonical ID | Notes |
| --- | --- | --- |
| Tenant / customer organization | `tenant_id` | Top-level customer scope. |
| Store / facility | `store_id` | Store-level operations, QR, counter orders, reporting, staff URL scope. |
| Screen group | `screen_group_id` | One signage group, including 3-screen layouts. |
| Screen slot | `screen_slot_id` | Logical left/center/right/wide slot under a screen group. |
| Device | `device_id` | Physical player endpoint. |
| Content manifest | `content_id` | Runtime playlist and asset manifest scope. |
| Asset | `asset_id` | Cloud/player asset identity. |
| Event | `event_id` | Idempotency key for logs/events. |
| Campaign | `campaign_id` | Campaign/reporting linkage. |
| Offer | `offer_id` | Stable QR/counter order offer identity. |
| Offer revision | `offer_revision_id` | Immutable commercial snapshot for orders. |
| QR link | `qr_link_id` / `qr_token` | Public QR entrypoint and token. |
| Counter order | `counter_order_id` | Issued reception number order. |
| Device command | `device_command_id` | Remote command queue item. |

## Legacy Alias Mapping

Legacy or boundary terms are allowed only as aliases:

| Alias | Canonical |
| --- | --- |
| `site_id` | `store_id` |
| `display_wall_id` | `screen_group_id` |
| `screen_id` | `screen_slot_id` |

New runtime tables, API payloads, report scopes, and player contracts should prefer canonical names. Alias fields may be accepted at boundaries for compatibility, but should normalize before persistence or authorization checks.

## Implemented Runtime Boundaries

Cloud is the source of truth for tenants, stores, devices, content manifests, QR links, offers, counter orders, reporting read models, backup evidence, and command queues.

Player keeps local execution state: active content evidence, asset state, outbound event queue, and local rollback/support evidence. Player does not connect directly to the Cloud database.

Public QR/order routes are intentionally unauthenticated, but bounded by rate-limit guardrails and must not store raw IP addresses.

Store staff access uses store-scoped token + PIN and can only see or update counter orders for its own store.

Customer access uses tenant-scoped token + PIN and server-side tenant/store scope enforcement. Customer reports expose potential/estimated counter-order value, not settled POS sales.

Remote device commands are pull-based from the device, fixed allowlist only, audited, and do not expose arbitrary shell execution.

Cloud backup access remains CLI/host-ops only. Customer/admin self-service download, decrypt, restore, or delete APIs are out of scope for MVP+.

## Implemented References

- `apps/cloud/server.js`: canonical DB/API runtime, QR/counter order flow, reporting read model, customer/store scoped access, command queue, backup ops evidence.
- `apps/player/lib/local-state.js`: local SQLite state and outbound event queue.
- `apps/player/scripts/sync-content.sh`: content policy apply flow.
- `apps/player/scripts/sync-assets.sh`: asset hash verification and quarantine.
- `docs/83_CLOUD_LOCAL_BACKUP_AND_ROLLBACK_SPEC.md`
- `docs/84_DEVICE_REMOTE_OPERATIONS_AND_RECOVERY_SPEC.md`

## Unresolved Follow-Ups

- Customer and partner RBAC expansion beyond token+PIN MVP.
- Display profile calibration and output health diagnostics.
- Incident management lifecycle and support boundary UI.
- Release-bundle content apply with versioned release directories and symlink rollback.
- Partner/ad scoped reporting and manifest ad-slot schema.
