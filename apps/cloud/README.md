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

## API

- `GET /api/health`
- `POST /api/admin/devices` with Basic auth
- `GET /api/admin/devices` with Basic auth
- `GET /api/admin/devices/:device_id` with Basic auth
- `GET /api/admin/device-log-bundles` with Basic auth
- `GET /api/admin/device-log-bundles/:id` with Basic auth
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

## Data

- Local development DB: `data/misell-cloud.sqlite`
- macOS LaunchAgent DB: `~/.local/share/misell-cloud/data/misell-cloud.sqlite`
- DB files are ignored by Git.
