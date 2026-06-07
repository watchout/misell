# misell-player

Ubuntu kiosk terminals for Misell local signage MVP.

## Requirements

- Node.js 20+
- npm
- Chromium or Google Chrome
- xrandr on Ubuntu/X11 for 3-display output

## Local Development

```bash
npm install
npm start
```

URLs:

- Player: http://localhost:3000/player
- Preview: http://localhost:3000/player?preview=1
- Admin: http://localhost:3000/admin

Default admin auth:

- User: `admin`
- Password: `change-me`

Set a real password before connecting the terminal to a store LAN.

```bash
ADMIN_USER=admin ADMIN_PASSWORD='replace-this' npm start
```

## Scripts

```bash
npm run check
npm run validate:playlist
```

## Data Files

- `data/config.json`: local device identity defaults
- `data/playlist.json`: local playlist
- `data/playlist.schema.json`: playlist validation schema
- `assets/images/`: uploaded images
- `assets/videos/`: uploaded videos
- `logs/playlog.jsonl`: playback log
- `logs/admin.log`: admin operation log
- `logs/error.log`: server/API error log
- `logs/burn-in.log`: burn-in check log
- `logs/heartbeat.log`: optional heartbeat operation log

Actual store terminals should override identity with environment variables in `~/.config/misell-player/env`.

Store terminals should keep runtime files outside the Git checkout:

- `MISELL_DATA_DIR`: default `~/.local/share/misell-player/data`
- `MISELL_ASSETS_DIR`: default `~/.local/share/misell-player/assets`
- `MISELL_GENERATED_DIR`: default `$MISELL_DATA_DIR/generated`
- `MISELL_LOG_DIR`: default `~/.local/share/misell-player/logs`
- `MISELL_PLAYLIST_PATH`: default `$MISELL_DATA_DIR/playlist.json`
- `MISELL_DEVICE_CONFIG_PATH`: default `$MISELL_DATA_DIR/config.json`

`scripts/setup-autostart.sh` and `scripts/enroll-device.sh` write these paths to `~/.config/misell-player/env`. This keeps device identity, playlist, generated cuts, uploads, and logs out of the Git working tree.

## API

- `GET /player`
- `GET /admin` with Basic auth
- `GET /api/config`
- `GET /api/status`
- `GET /api/heartbeat`
- `GET /api/playlist`
- `POST /api/playlist` with Basic auth
- `GET /api/assets` with Basic auth
- `POST /api/assets/upload` with Basic auth
- `POST /api/promo-campaigns` with Basic auth
- `POST /api/log/play`

## Upload Rules

Allowed:

- `jpg`
- `jpeg`
- `png`
- `mp4`
- `webm`

Rejected:

- HTML
- JavaScript
- shell scripts
- executables
- zip files
- files with mismatched MIME type or file signature

## Product PR Builder

The LAN admin UI includes `PR作成` for store-front product promotion loops. It creates generated HTML cuts under `MISELL_GENERATED_DIR`, defaulting to `$MISELL_DATA_DIR/generated`, and appends returned playlist items to the unsaved playlist in the browser. After the first generation, the same promo can be regenerated with the current form values and replaced in the unsaved playlist without creating duplicate cuts.

Generated source paths use:

```text
/generated/promos/<promo-id>/<cut>.html
```

Use the normal preview and save buttons to review and persist the generated cuts. Content backups include generated HTML cuts, playlist JSON, device config, and uploaded assets.

After generating a promo, use `WebM書き出し` in the storyboard panel to export the current promo cuts as a silent WebM video for demos or sales materials. The default `確認用 WebM 1280x720` export preserves the 3-screen 48:9 stage with letterboxing. `3面 WebM 5760x1080` exports the full 3-screen canvas.

WebM export requires:

- `ffmpeg`
- Chromium (`chromium-browser`, `chromium`, `google-chrome-stable`, or `google-chrome`)

Override binary paths with `MISELL_FFMPEG_BIN` or `MISELL_CHROMIUM_BIN` if needed. Local development and CI can fall back to Playwright when no Chromium binary is available.

## Ubuntu Device Setup

Dry-run:

```bash
scripts/setup-ubuntu-device.sh
```

Apply after reviewing output:

```bash
scripts/setup-ubuntu-device.sh --apply
```

If Node.js 20+ is not already available from the approved package source:

```bash
MISELL_INSTALL_NODESOURCE=1 scripts/setup-ubuntu-device.sh --apply
```

Enroll a real store terminal:

```bash
scripts/enroll-device.sh \
  --tenant-id TEN-0001 \
  --store-id STO-0001 \
  --location-id LOC-LOBBY-001 \
  --screen-group-id SG-000001 \
  --device-id DEV-000001
```

Apply after reviewing output:

```bash
scripts/enroll-device.sh \
  --apply \
  --tenant-id TEN-0001 \
  --store-id STO-0001 \
  --location-id LOC-LOBBY-001 \
  --screen-group-id SG-000001 \
  --device-id DEV-000001
```

Configure displays:

```bash
xrandr --query
scripts/set-display-3x.sh
```

Install systemd user services:

```bash
scripts/setup-autostart.sh
```

Check services:

```bash
systemctl --user status misell-player.service
systemctl --user status misell-kiosk.service
systemctl --user status misell-log-rotate.timer
```

Enable cloud heartbeat timer only after setting `MISELL_HEARTBEAT_URL` and `MISELL_DEVICE_TOKEN` in `~/.config/misell-player/env`.

```bash
INSTALL_HEARTBEAT=1 scripts/setup-autostart.sh
systemctl --user status misell-heartbeat.timer
```

Enable cloud update timer after heartbeat is working. `MISELL_UPDATE_URL` and `MISELL_UPDATE_RESULT_URL` are optional when `MISELL_HEARTBEAT_URL` ends with `/api/device/heartbeat`; the update script derives both URLs from it.

```bash
INSTALL_UPDATE=1 scripts/setup-autostart.sh
systemctl --user status misell-update.timer
```

Enable cloud content sync after heartbeat is working. `MISELL_CONTENT_URL` and `MISELL_CONTENT_RESULT_URL` are optional when `MISELL_HEARTBEAT_URL` ends with `/api/device/heartbeat`; the sync script derives both URLs from it.

```bash
INSTALL_CONTENT_SYNC=1 scripts/setup-autostart.sh
systemctl --user status misell-content-sync.timer
```

## Security Baseline

Dry-run:

```bash
MISELL_LAN_CIDR=192.168.1.0/24 scripts/setup-ubuntu-security.sh
```

Apply:

```bash
MISELL_LAN_CIDR=192.168.1.0/24 scripts/setup-ubuntu-security.sh --apply
```

## Burn-in

Default duration is 6 hours.

```bash
scripts/burn-in-check.sh
```

Short test:

```bash
MISELL_BURN_IN_DURATION_SECONDS=300 MISELL_BURN_IN_INTERVAL_SECONDS=30 scripts/burn-in-check.sh
```

## Evidence

```bash
scripts/collect-device-evidence.sh
```

The script writes evidence under `evidence/YYYYMMDD-HHMMSS/`.

Upload the same bounded evidence bundle to Misell Cloud:

```bash
scripts/collect-device-evidence.sh --upload --label incident --reason "kiosk did not start"
```

`MISELL_LOGS_URL` can be set directly. If it is omitted and `MISELL_HEARTBEAT_URL` ends with `/api/device/heartbeat`, the script posts to the same Cloud base URL at `/api/device/logs`.

## Heartbeat

Print the local heartbeat/status payload:

```bash
npm run heartbeat
```

If `MISELL_HEARTBEAT_URL` is set, the script posts the payload with `Authorization: Bearer $MISELL_DEVICE_TOKEN`.

## Log Rotation

Rotate oversized local logs:

```bash
npm run rotate:logs
```

Force rotation for verification:

```bash
scripts/rotate-logs.sh --force
```

## Content Backups

Create a versioned backup of `playlist.json`, `config.json`, generated PR cuts, and local assets:

```bash
npm run backup:content
```

The local admin API also creates content backups before PR generation, playlist saves, and asset deletion. Backups are stored under `MISELL_CONTENT_BACKUP_DIR`, defaulting to `~/.local/share/misell-player/backups` on terminals.

## MVP Update Flow

For Git-based MVP updates, keep `apps/player` as a clean checkout and keep runtime files under `~/.local/share/misell-player`.

Dry-run:

```bash
scripts/update-player.sh
```

Apply:

```bash
scripts/update-player.sh --apply
```

Apply a specific Git ref and stamp the release metadata used by heartbeat:

```bash
scripts/update-player.sh --apply \
  --ref origin/main \
  --release-id rel-20260605-001 \
  --release-channel canary
```

Check Cloud for a scheduled update:

```bash
scripts/check-update.sh --dry-run
```

`scripts/check-update.sh` accepts both per-device update targets and active Cloud release manifests. When a manifest is returned, the script reports `target_manifest_id` back to Cloud with the update result.

Commercial deployments should move from direct Git refs to release bundles with symlink rollback.

## Cloud Content Sync

Sync the active Cloud content manifest for the terminal release channel:

```bash
npm run content:sync
```

Dry-run:

```bash
scripts/sync-content.sh --dry-run
```

The script backs up local content, writes the Cloud playlist to `MISELL_PLAYLIST_PATH`, validates it, and reports success or failure to Cloud.
