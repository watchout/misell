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

## API

- `GET /api/health`
- `POST /api/admin/devices` with Basic auth
- `GET /api/admin/devices` with Basic auth
- `GET /api/admin/devices/:device_id` with Basic auth
- `GET /api/admin/alerts` with Basic auth
- `POST /api/device/heartbeat` with Bearer device token
- `POST /api/device/playlog` with Bearer device token
- `POST /api/device/error` with Bearer device token

## Data

- Local development DB: `data/misell-cloud.sqlite`
- macOS LaunchAgent DB: `~/.local/share/misell-cloud/data/misell-cloud.sqlite`
- DB files are ignored by Git.
