# misell-cloud

Cloud monitoring MVP for Misell signage devices.

## Requirements

- Node.js 20+
- npm

## Local Development

```bash
npm install
npm start
```

URLs:

- Admin: http://localhost:3200/admin
- Health: http://localhost:3200/api/health

Default admin auth:

- User: `admin`
- Password: `change-me`

Set a real password and token pepper before any shared deployment.

```bash
ADMIN_USER=admin ADMIN_PASSWORD='replace-this' DEVICE_TOKEN_PEPPER='replace-this-too' npm start
```

By default the server binds to `127.0.0.1`. For a hosted environment, set `HOST=0.0.0.0` behind HTTPS.

## Alert Notifications

Webhook notifications are disabled by default. Set a webhook URL to notify external operations tools when alerts open, change, or resolve.

```bash
ALERT_WEBHOOK_URL=https://example.com/misell-alert-webhook
ALERT_WEBHOOK_MIN_SEVERITY=warning
ALERT_WEBHOOK_NOTIFY_RESOLVED=1
ALERT_WEBHOOK_TIMEOUT_MS=5000
```

The payload includes both `text` and `content` for Slack/Discord-style receivers, plus structured `alert` and `cloud` fields.

Test the configured webhook:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  http://localhost:3200/api/admin/alert-notifications/test
```

## macOS Launch Agent

For the Mac mini used over Tailscale:

```bash
scripts/setup-macos-launchagent.sh
scripts/setup-macos-launchagent.sh --apply
```

The script stores secrets in `~/.config/misell-cloud/env` and starts `com.misell.cloud`.

Runtime files are kept outside the Git checkout:

- SQLite DB: `~/.local/share/misell-cloud/data/misell-cloud.sqlite`
- LaunchAgent logs: `~/.local/share/misell-cloud/logs/`

For Mac mini operation, keep the app itself as a clean checkout of GitHub `main`, and keep DB/secrets/logs under `~/.config/misell-cloud` and `~/.local/share/misell-cloud`.

Read the admin password locally:

```bash
sed -n 's/^ADMIN_PASSWORD=//p' ~/.config/misell-cloud/env
```

## Scripts

```bash
npm run check
npm audit --audit-level=moderate
```

## Backup

Create a manual SQLite backup:

```bash
scripts/backup-sqlite.sh
```

Install a macOS LaunchAgent for daily backups:

```bash
scripts/setup-macos-backup-launchagent.sh
scripts/setup-macos-backup-launchagent.sh --apply
```

Backups are stored under `~/.local/share/misell-cloud/backups` by default. The default retention is 30 days.

## Register a Device

```bash
curl -u admin:change-me \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "TEN-DEMO",
    "store_id": "STO-DEMO-001",
    "location_id": "LOC-DEMO-001",
    "screen_group_id": "SG-DEMO-001",
    "device_id": "DEV-DEMO-001",
    "device_name": "misell-demo",
    "release_channel": "stable"
  }' \
  http://localhost:3200/api/admin/devices
```

The response returns `device_token` once. Store it in the terminal env file.

## Manage Device Tokens

Device tokens are stored as hashes. The plain token is shown only when a device is registered or rotated.

Revoke a token immediately:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"reason":"terminal lost"}' \
  http://localhost:3200/api/admin/devices/DEV-DEMO-001/token/revoke
```

Rotate a token and copy the returned `device_token` into the terminal env file:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"reason":"scheduled rotation"}' \
  http://localhost:3200/api/admin/devices/DEV-DEMO-001/token/rotate
```

After updating `MISELL_DEVICE_TOKEN` on the terminal, restart the heartbeat timer and player service.

## Device Heartbeat

```bash
curl -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d @heartbeat.json \
  http://localhost:3200/api/device/heartbeat
```

Terminal integration:

```bash
MISELL_HEARTBEAT_URL=http://cloud-host:3200/api/device/heartbeat
MISELL_DEVICE_TOKEN=<shown-once-token>
```

Then run on the terminal:

```bash
scripts/emit-heartbeat.sh
```

## Device Log Bundles

Terminals can upload a bounded evidence bundle with recent service status, journal output, and local Misell logs:

```bash
scripts/collect-device-evidence.sh --upload --label incident --reason "kiosk did not start"
```

When `MISELL_HEARTBEAT_URL` ends with `/api/device/heartbeat`, the script derives `MISELL_LOGS_URL` as `/api/device/logs`.

## Store Commerce and QR Foundation

Cloud is the source of truth for store settings, offer definitions, QR links, counter orders, and device event idempotency. Terminals should treat local state as execution/cache state and backfill events with stable `event_id` values.

Store settings are scoped per store and currently include timezone, business day start time, order issue cutoff time, pickup window, currency, and tax included flag. This allows stores with different closing and cutoff times to share the same Cloud schema.

Offers use immutable revisions. `offers.current_offer_revision_id` points at the active revision, and each `offer_revision` snapshots item names, quantities, prices, tax flags, and order limits. Changing an active offer should create a new revision instead of mutating the published revision.

QR links can resolve to public QR pages or issue counter orders for an active offer revision. Counter orders receive a one-time public `order_token` for lookup and a short `verify_code` for counter redemption. Admin status updates currently support `issued`, `redeemed`, `expired`, and `cancelled`.

Device playlogs now require `event_id`. Reposting the same `(tenant_id, device_id, event_id)` returns `duplicate: true` without inserting another row.

## API

- `GET /api/health`
- `POST /api/admin/devices` with Basic auth
- `GET /api/admin/devices` with Basic auth
- `GET /api/admin/devices/:device_id` with Basic auth
- `GET /api/admin/device-log-bundles` with Basic auth
- `GET /api/admin/device-log-bundles/:id` with Basic auth
- `GET /api/admin/release-manifests` with Basic auth
- `POST /api/admin/release-manifests` with Basic auth
- `PATCH /api/admin/release-manifests/:manifest_id` with Basic auth
- `GET /api/admin/content-manifests` with Basic auth
- `POST /api/admin/content-manifests` with Basic auth
- `PATCH /api/admin/content-manifests/:content_id` with Basic auth
- `GET /api/admin/store-settings` with Basic auth
- `GET /api/admin/stores/:store_id/settings` with Basic auth
- `PUT /api/admin/stores/:store_id/settings` with Basic auth
- `PATCH /api/admin/stores/:store_id/settings` with Basic auth
- `GET /api/admin/items` with Basic auth
- `POST /api/admin/items` with Basic auth
- `PATCH /api/admin/items/:item_id` with Basic auth
- `GET /api/admin/offers` with Basic auth
- `POST /api/admin/offers` with Basic auth
- `GET /api/admin/offers/:offer_id` with Basic auth
- `POST /api/admin/offers/:offer_id/revisions` with Basic auth
- `GET /api/admin/qr-links` with Basic auth
- `POST /api/admin/qr-links` with Basic auth
- `GET /api/admin/counter-orders` with Basic auth
- `POST /api/admin/counter-orders` with Basic auth
- `PATCH /api/admin/counter-orders/:counter_order_id/status` with Basic auth
- `GET /q/:qr_token`
- `POST /q/:qr_token/orders`
- `GET /order/:order_token`
- `PATCH /api/admin/devices/:device_id` with Basic auth
- `PATCH /api/admin/devices/:device_id/update` with Basic auth
- `POST /api/admin/devices/:device_id/token/revoke` with Basic auth
- `POST /api/admin/devices/:device_id/token/rotate` with Basic auth
- `GET /api/admin/alerts` with Basic auth
- `GET /api/admin/alert-notifications` with Basic auth
- `POST /api/admin/alert-notifications/test` with Basic auth
- `POST /api/device/heartbeat` with Bearer device token
- `GET /api/device/update-policy` with Bearer device token
- `POST /api/device/update-result` with Bearer device token
- `GET /api/device/content-policy` with Bearer device token
- `POST /api/device/content-result` with Bearer device token
- `POST /api/device/playlog` with Bearer device token
- `POST /api/device/error` with Bearer device token
- `POST /api/device/logs` with Bearer device token

## Device Updates

Schedule a Git-based MVP update from the admin API:

```bash
curl -u admin:change-me \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{
    "target_update_ref": "origin/main",
    "target_release_id": "rel-20260605-001",
    "target_release_channel": "canary"
  }' \
  http://localhost:3200/api/admin/devices/DEV-DEMO-001/update
```

The terminal polls `GET /api/device/update-policy` and reports `updating`, `success`, or `failed` to `POST /api/device/update-result`.

Create an active release manifest to update all terminals on the matching release channel:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "manifest_id": "rel-20260605-canary-001",
    "release_id": "rel-20260605-001",
    "release_channel": "canary",
    "update_ref": "origin/main",
    "status": "active",
    "notes": "canary rollout"
  }' \
  http://localhost:3200/api/admin/release-manifests
```

Per-device update targets take priority over release manifests. Without a per-device target, `GET /api/device/update-policy` returns the active manifest for the device `release_channel` with `source: "release_manifest"` and `target_manifest_id`. Terminals on `hold` do not receive active release manifests.

## Content Manifests

Create an active playlist manifest to update all terminals on the matching release channel:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "content_id": "content-20260605-staging-001",
    "playlist_version": "pl-20260605-001",
    "release_channel": "staging",
    "status": "active",
    "title": "staging playlist",
    "playlist": {
      "version": 1,
      "playlist_version": "pl-20260605-001",
      "items": [
        {
          "item_id": "demo-wide",
          "layout": "wide",
          "enabled": true,
          "duration": 12,
          "wide": "/demo/wide.html"
        }
      ]
    }
  }' \
  http://localhost:3200/api/admin/content-manifests
```

The terminal polls `GET /api/device/content-policy` with `scripts/sync-content.sh`. The script writes the returned playlist to the terminal runtime playlist, validates it, and reports the result to `POST /api/device/content-result`.

This MVP content manifest distributes playlist JSON only. Asset file distribution from Cloud storage is a separate next step; playlist sources should currently reference assets already present on the terminal or built-in `/demo/...` sources.

## Data

- Local development DB: `data/misell-cloud.sqlite`
- macOS LaunchAgent DB: `~/.local/share/misell-cloud/data/misell-cloud.sqlite`
- DB files are ignored by Git.

## Schema Migrations

Cloud startup creates the legacy baseline schema and then applies additive migrations recorded in `schema_migrations`.

Operational notes:

- Treat the legacy `CREATE TABLE IF NOT EXISTS` block as the baseline. Future schema changes should be added as new schema migration versions.
- Migrations are additive and do not run automatic down/rollback SQL.
- Reverting app code does not drop tables added by a migration; unused additive tables may remain in SQLite.
- For an emergency rollback that must remove migrated schema or data, restore a verified SQLite backup instead of relying on app startup.
