# 51. PR実装計画

## 目的

Codexや開発チームが、巨大PRではなく小さなPRで安全にMVPを実装できるようにする。

## 方針

- 1 PR = 1〜3 Issue
- local playerを最優先
- Remote CMSやAIは入れない
- 実端末がなくても進められるものから着手する

## PR 1: apps/player skeleton

### 対象Issue

- #4 Node.js/Expressサーバー構築

### 実装内容

- apps/player/package.json
- apps/player/server.js
- public/player.html
- public/admin.html
- public/style.css
- .env.example
- README.md

### 受け入れ条件

- npm install
- npm start
- /player
- /admin

## PR 2: player three-zone / wide

### 対象Issue

- #5 Player three-zone実装
- #6 Player wide実装

### 実装内容

- player.js
- 5760 x 1080 canvas
- preview mode
- three-zone renderer
- wide renderer
- image/video support

### 受け入れ条件

- /player?preview=1で3ゾーンが見える
- three-zone item表示
- wide item表示

## PR 3: playlist schema / validation

### 対象Issue

- #7 playlist.json仕様実装
- #57 playlist schema / validation

### 実装内容

- data/playlist.json
- data/playlist.schema.json
- Ajv validation
- asset path validation
- duration validation
- layout validation
- validation errors API

### 受け入れ条件

- valid playlist is accepted
- invalid playlist is rejected
- /adminでvalidation errorsが見える

## PR 4: device identity and playlog

### 対象Issue

- #58 device identityをlocal playerログへ先行導入
- #11 ログ保存

### 実装内容

- data/config.json
- /api/config
- /api/status
- /api/log/play
- logs/playlog.jsonl
- logs/error.log
- logs/admin.log

### 受け入れ条件

- playlogにdevice_id/store_id/screen_group_id/playlist_versionが出る

## PR 5: LAN admin and upload

### 対象Issue

- #8 LAN管理画面
- #13 admin basic auth
- #14 upload file validation
- #15 path traversal対策
- #44 HTML/URL制限

### 実装内容

- admin.js
- asset upload
- asset list
- playlist editor
- Basic auth
- MIME/拡張子/サイズ制限
- path traversal防止

### 受け入れ条件

- /adminは認証なしで入れない
- safe file uploadができる
- unsafe file uploadは拒否される
- playlist保存できる

## PR 6: Ubuntu kiosk scripts

### 対象Issue

- #9 systemdサービス
- #10 Chromium kiosk起動スクリプト

### 実装内容

- scripts/start-kiosk.sh
- scripts/set-display-3x.sh
- scripts/setup-autostart.sh
- systemd/misell-player.service

### 受け入れ条件

- Ubuntu上で手動実行できる
- service設定手順がREADMEにある

## PR 7: burn-in and MVP gate evidence

### 対象Issue

- #12 連続再生テスト
- #56 現地MVP合格基準

### 実装内容

- scripts/burn-in-check.sh
- logs/burn-in.log
- docs/test-results template
- MVP evidence checklist

### 受け入れ条件

- 6時間burn-inログを残せる
- 証拠化項目がREADME/QAに反映される

## PR 8: minimal device security docs/scripts

### 対象Issue

- #16 ufw最低設定
- #17 SSH hardening

### 実装内容

- docs or scripts for ufw
- docs for SSH hardening
- non-destructive commands only

### 受け入れ条件

- 現地作業者が安全に設定できる

## 並行して進めてよいもの

実装とは別に進める：

- #18〜#21 デモ素材
- #28 提案資料
- #29 価格表
- #30 テスト導入契約雛形
- #31 媒体資料

## 後回しにするもの

local player MVPが安定するまで後回し：

- Remote CMS
- heartbeat
- cloud log backfill
- device_token
- AI Count
- ESL API
- 商用クラウド認証

## 最初のCodex投入

最初に使うプロンプト：

- prompts/codex_implement_local_player_v1.md

CodexにはPR 1〜5までを一気に作らせてもよいが、レビューしやすくするならPR単位で分ける。
