# 91. Canonical Domain Vocabulary ADR

## Status

Decision proposed / accepted for implementation planning.

This ADR resolves the vocabulary conflict between:

- PR #114: `tenant -> site -> display_wall -> screen -> device binding`
- PR #150: `Tenant / Store / ScreenGroup / Device`

The decision is to use the existing ID vocabulary as canonical and treat Studio-specific display concepts as supporting implementation details.

## Decision

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

Studio-specific display concepts are allowed only as supporting concepts scoped under the canonical IDs.

```text
ScreenGroup
  └── ScreenSlot(left/center/right/wide logical slot)
       └── DeviceBinding / connector / EDID / resolution mapping
```

## Rationale

Misell already uses `tenant_id`, `store_id`, `screen_group_id`, and `device_id` across player, cloud monitoring, heartbeat, playlog, QR, reporting, content delivery, and operations specs.

Renaming these to `site`, `display_wall`, and `screen` as new canonical entities would add translation layers across DB, API, RBAC, manifest, reporting, and AI Campaign context building.

The product should avoid parallel systems and vocabulary drift. New Studio concepts should extend the existing domain model instead of replacing it.

## Canonical mapping

| Existing / canonical | UI label examples | Non-canonical aliases | Notes |
| --- | --- | --- | --- |
| Tenant | 契約/組織 | organization | Customer contract boundary |
| Store | 店舗/施設 | site | Existing `store_id` remains canonical |
| ScreenGroup | 3連画面 / screen group | display_wall | Existing `screen_group_id` remains canonical |
| ScreenSlot | 左画面 / 中央画面 / 右画面 / wide | screen | Logical slot inside ScreenGroup |
| Device | 端末 | player terminal | Existing `device_id` remains canonical |
| DeviceBinding | 出力割当 / connector binding | screen_device_binding | Implementation detail |

## Implementation guidance

### DB/API

- New APIs should use `tenant_id`, `store_id`, `screen_group_id`, and `device_id` for scope.
- New Studio tables may use `screen_slots` and `device_bindings` as supporting tables.
- If existing PRs introduce `site`, `display_wall`, or `screen`, those terms must be either renamed before merge or documented as aliases/supporting concepts.
- Do not introduce separate top-level scope IDs that compete with `store_id` or `screen_group_id`.

### RBAC / scope

RBAC and partner/customer scopes should use canonical IDs.

```json
{
  "tenant_id": "tenant_001",
  "store_ids": ["store_001"],
  "screen_group_ids": ["sg_001"],
  "permissions": ["content:read", "schedule:update"]
}
```

If screen-slot-level permissions become necessary, they must be nested under `screen_group_id`.

### Manifest / content delivery

ContentManifest and PlaylistItem should remain scoped to Store/ScreenGroup/Device concepts.

AI Campaign, Media campaigns, and Studio-generated content must publish through the existing ContentManifest path.

No separate display-wall manifest or AI-specific manifest should be introduced.

### Reporting

Reports should aggregate by:

- tenant_id
- store_id
- screen_group_id
- device_id
- content_id
- campaign_project_id where applicable
- media_campaign_id where applicable

`site` and `display_wall` must not appear as competing report dimensions unless they are UI aliases for Store/ScreenGroup.

### AI Campaign / Context Builder

AI Campaign context must use canonical scope:

```text
Tenant -> Store -> ScreenGroup -> Device
```

Supporting screen slot information can be included as layout/context metadata.

```json
{
  "screen_group_id": "sg_001",
  "slots": [
    { "slot": "left", "device_id": "dev_left", "connector": "HDMI-1" },
    { "slot": "center", "device_id": "dev_center", "connector": "HDMI-2" },
    { "slot": "right", "device_id": "dev_right", "connector": "HDMI-3" }
  ]
}
```

## Migration guidance for PR #114

PR #114 may keep its implementation if the following conditions are met before merge or in a follow-up patch approved by arc/CTO:

- `site` is documented as an alias or UI label for Store, not a new canonical scope.
- `display_wall` is documented as an alias or UI label for ScreenGroup, not a new canonical scope.
- `screen` is treated as `ScreenSlot` or physical output slot scoped under ScreenGroup.
- `screen_device_bindings` or equivalent binding tables include canonical `tenant_id`, `store_id`, and `screen_group_id` references.
- No API or RBAC scope exposes `site_id` or `display_wall_id` as the long-term canonical identifier unless an explicit migration ADR supersedes this one.

## Impact on PR #150

PR #150 is already aligned with this ADR because it uses:

```text
Tenant / Store / ScreenGroup / Device
```

and treats AI Campaign as an extension of existing manifest, render, credit, and reporting flows.

## Non-goals

This ADR does not decide:

- AI Campaign pricing
- AI generation quota
- legal/privacy handling of customer context
- AI camera terminology
- final UI wording for Japanese labels

Those remain governed by their own specs and approval gates.

## Acceptance checklist

- [ ] #114 is updated or documented to use Store/ScreenGroup canonical mapping
- [ ] #150 keeps Store/ScreenGroup vocabulary
- [ ] #126 or the canonical architecture issue references this ADR
- [ ] New specs stop introducing top-level `site` / `display_wall` as canonical terms
- [ ] DB/API/RBAC/manifest/reporting docs use the same canonical scope model
