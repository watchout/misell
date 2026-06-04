# Codex Prompt: Implement misell-player local MVP v1

You are implementing the local MVP of Misell player.

Read these docs first:

- docs/47_ARCHITECTURE_BOUNDARIES_AND_MVP_GATES.md
- docs/50_IMPLEMENTATION_READY_MVP_SPEC.md
- docs/44_NETWORK_SECURITY_SPEC.md

Important principle:

- Build only the local player MVP.
- Do not build Remote CMS.
- Do not build AI features.
- Do not build multi-tenant cloud features.
- Keep it simple, reliable, and runnable on macOS local development and Ubuntu production.

## Goal

Create `apps/player` with a Node.js + Express local signage player.

The app must support:

- 5760x1080 canvas
- three-zone layout
- wide layout
- playlist.json rotation
- playlist schema validation
- device identity config
- playlog output
- LAN admin page
- Basic auth for admin/API write operations
- asset upload with file validation
- path traversal prevention
- preview mode for local development
- kiosk scripts for Ubuntu
- systemd service file

## Required file structure

Create:

- apps/player/README.md
- apps/player/package.json
- apps/player/server.js
- apps/player/.env.example
- apps/player/public/player.html
- apps/player/public/admin.html
- apps/player/public/style.css
- apps/player/public/player.js
- apps/player/public/admin.js
- apps/player/data/config.json
- apps/player/data/playlist.json
- apps/player/data/playlist.schema.json
- apps/player/assets/videos/.gitkeep
- apps/player/assets/images/.gitkeep
- apps/player/logs/.gitkeep
- apps/player/scripts/start-kiosk.sh
- apps/player/scripts/set-display-3x.sh
- apps/player/scripts/setup-autostart.sh
- apps/player/scripts/burn-in-check.sh
- apps/player/systemd/misell-player.service

## Dependencies

Use:

- express
- multer
- ajv
- dotenv
- nanoid or uuid
- express-basic-auth

## API

Implement:

- GET /player
- GET /admin protected by basic auth
- GET /api/config
- GET /api/playlist
- POST /api/playlist protected by basic auth
- GET /api/assets protected by basic auth
- POST /api/assets/upload protected by basic auth
- GET /api/status
- POST /api/log/play

## Security requirements

- /admin must not be accessible without Basic auth.
- POST /api/playlist must require Basic auth.
- Asset upload must require Basic auth.
- Allowed extensions: mp4, webm, jpg, jpeg, png.
- Check MIME type.
- Limit upload size to 500MB.
- Store uploaded files with random safe filename.
- Do not allow path traversal.
- Do not allow html/js/sh/exe/zip upload.
- .env must not be committed. Add .env.example only.

## Playlist validation

Use Ajv and `data/playlist.schema.json`.

Rules:

- playlist_version required
- items required
- item_id required
- layout required
- enabled required
- duration required
- duration range: 1 to 300
- layout must be three-zone or wide
- three-zone requires left, center, right
- wide requires wide
- asset paths must start with assets/
- asset paths must not contain ..
- if start/end exist, HH:mm format
- validate asset existence on save and load

## Player behavior

On /player:

- Load /api/config
- Load /api/playlist
- If playlist invalid, display error screen
- Filter items by enabled and start/end time
- Rotate items by duration
- Render three-zone as left/center/right 1920x1080 zones
- Render wide as 5760x1080 wide content
- Support images and videos
- Log play start to /api/log/play

Preview mode:

- /player?preview=1
- Scale 5760x1080 to fit normal browser
- Show guide lines between 3 zones
- Show small labels: left / center / right

## Admin behavior

On /admin:

- Show dashboard/status
- Show assets list
- Upload assets
- Show playlist JSON editor
- Validate playlist before save
- Show validation errors
- Save playlist
- Link to /player?preview=1

## Logs

Create:

- logs/playlog.jsonl
- logs/error.log
- logs/admin.log

Append JSON lines for playlog.

## Scripts

start-kiosk.sh:

- Start Chromium kiosk
- URL: http://localhost:3000/player
- window position: 0,0
- window size: 5760,1080

set-display-3x.sh:

- Include placeholder xrandr command
- Add comments instructing to run xrandr --query first

setup-autostart.sh:

- Copy systemd service file or print instructions
- Do not do destructive actions without confirmation

burn-in-check.sh:

- Print CPU, memory, disk, uptime every minute
- Append to logs/burn-in.log

## README

Document:

- local development setup
- env setup
- run commands
- preview URL
- admin URL
- upload rules
- Ubuntu kiosk setup
- systemd setup
- burn-in test

## Acceptance criteria

- npm install works
- npm start works
- /player?preview=1 displays player
- /admin requires Basic auth
- upload rejects unsafe files
- playlist validation works
- three-zone displays
- wide displays
- playlog is written
- scripts exist and are executable-friendly

Implement now.
