# Codex Prompt: Build Misell MVP Player

このプロンプトをCodexに渡して、Ubuntu上で動くミセルMVPプレイヤーを作る。

## Prompt

Create a Linux-based 3-screen digital signage MVP called misell-player.

Goal:

- Run on Ubuntu 24.04.
- Display a 5760x1080 Chromium kiosk page across three 1920x1080 monitors.
- Support two layout modes.
- Mode 1: three-zone. Left, center, and right content are displayed separately.
- Mode 2: wide. One content item spans all three screens.
- Use a local playlist JSON file.
- Support images and videos.
- Support duration-based rotation.
- Support optional start and end time for each playlist item.
- Provide a simple LAN admin page to upload assets and edit playlist data.
- Provide scripts for starting the local server, launching Chromium kiosk, setting 3 displays with xrandr, and installing a systemd autostart service.

Tech requirements:

- Use Node.js and Express.
- No database for the MVP.
- Store playlist in data/playlist.json.
- Store uploaded files in assets/videos and assets/images.
- The player page should preload the next content where practical.
- The code should be simple, readable, and production-minded.
- Include README with Ubuntu setup steps.

Expected file structure:

- README.md
- package.json
- server.js
- public/player.html
- public/admin.html
- public/style.css
- public/player.js
- public/admin.js
- data/playlist.json
- assets/videos/.gitkeep
- assets/images/.gitkeep
- scripts/start-kiosk.sh
- scripts/setup-autostart.sh
- scripts/set-display-3x.sh
- systemd/misell-player.service

Acceptance criteria:

- npm install works.
- npm start starts the local server.
- /player displays the signage player.
- /admin displays the LAN admin page.
- Admin page can upload assets.
- Admin page can edit playlist.
- Player rotates playlist items by duration.
- Player respects start and end time if provided.
- three-zone layout displays left, center, and right separately.
- wide layout spans all three zones.
- scripts are documented and safe to edit.

Important:

- Do not overbuild cloud features.
- Do not add authentication yet unless it is simple and optional.
- Keep all MVP data local.
- Prioritize reliability and readability.
