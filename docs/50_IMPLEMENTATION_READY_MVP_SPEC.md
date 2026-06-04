# 50. 実装即着手用 MVP 詳細仕様

## 目的

このドキュメントは、Codexまたは開発者が迷わず `misell-player` を実装できる粒度まで、MVPのファイル構成、API、データ構造、バリデーション、画面仕様、受け入れ条件を落とし込む。

## 実装対象

最初に作るのは **local player** のみ。

Remote CMS、広告管理、AI分析、複数店舗管理は後続。

## 実装ディレクトリ

```text
apps/player/
├─ README.md
├─ package.json
├─ server.js
├─ .env.example
├─ public/
│  ├─ player.html
│  ├─ admin.html
│  ├─ style.css
│  ├─ player.js
│  └─ admin.js
├─ data/
│  ├─ config.json
│  ├─ playlist.json
│  └─ playlist.schema.json
├─ assets/
│  ├─ videos/
│  │  └─ .gitkeep
│  └─ images/
│     └─ .gitkeep
├─ logs/
│  └─ .gitkeep
├─ scripts/
│  ├─ start-kiosk.sh
│  ├─ set-display-3x.sh
│  ├─ setup-autostart.sh
│  └─ burn-in-check.sh
└─ systemd/
   └─ misell-player.service
```

## 技術スタック

- Node.js LTS
- Express
- Multer for upload
- Ajv for JSON Schema validation
- nanoid or uuid for ids
- basic-auth or express-basic-auth for MVP admin auth
- QR generationは後続Issueで実装可

## package.json scripts

必須script：

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "validate:playlist": "node server.js --validate-playlist"
  }
}
```

## .env.example

```env
PORT=3000
ADMIN_USER=admin
ADMIN_PASSWORD=change-me
APP_ENV=local
```

## config.json

Remote CMS未導入でも、device identityを先行導入する。

```json
{
  "tenant_id": "TEN-LOCAL",
  "store_id": "STO-LOCAL",
  "location_id": "LOC-LOCAL",
  "screen_group_id": "SG-LOCAL",
  "device_id": "DEV-LOCAL-001",
  "device_name": "local-dev-player",
  "playlist_version": "local-001"
}
```

## playlist.json MVP例

```json
{
  "playlist_version": "local-001",
  "items": [
    {
      "item_id": "ITEM-001",
      "layout": "three-zone",
      "enabled": true,
      "duration": 15,
      "left": "assets/images/left.png",
      "center": "assets/videos/center.mp4",
      "right": "assets/images/right.png"
    },
    {
      "item_id": "ITEM-002",
      "layout": "wide",
      "enabled": true,
      "duration": 15,
      "wide": "assets/videos/wide.mp4"
    }
  ]
}
```

## playlist validation rules

必須：

- rootに `playlist_version` がある
- rootに `items` array がある
- itemには `item_id` がある
- itemには `layout` がある
- itemには `enabled` がある
- itemには `duration` がある
- `duration` は1〜300秒
- `layout` は `three-zone` または `wide`
- `three-zone` の場合、left/center/rightが必須
- `wide` の場合、wideが必須
- asset pathは `assets/` 配下のみ許可
- asset pathに `..` を含めない
- start/endがある場合はHH:mm形式

## API仕様

### GET /player

player.htmlを返す。

### GET /admin

admin.htmlを返す。Basic auth必須。

### GET /api/config

config.jsonを返す。

### GET /api/playlist

playlist.jsonを返す。

返却前にvalidationを行い、エラーがある場合もHTTP 200で以下を返す。

```json
{
  "ok": false,
  "errors": [],
  "playlist": null
}
```

正常時：

```json
{
  "ok": true,
  "errors": [],
  "playlist": {}
}
```

### POST /api/playlist

playlistを保存する。Basic auth必須。

処理：

1. JSON受信
2. schema validation
3. asset存在確認
4. 問題なければ `data/playlist.json` へ保存
5. playlist変更ログを保存

### GET /api/assets

assets配下の画像/動画一覧を返す。Basic auth必須。

返す項目：

- path
- type
- size
- updated_at

### POST /api/assets/upload

素材をアップロードする。Basic auth必須。

制限：

- 許可拡張子：mp4, webm, jpg, jpeg, png
- 最大サイズ：MVPでは500MBまで
- ファイル名はサーバー側でランダム化
- 元ファイル名はmetadataとして保持してよい
- HTML/JS/zip/sh/exeは拒否

### GET /api/status

簡易ステータスを返す。

項目：

- ok
- device_id
- store_id
- screen_group_id
- playlist_version
- uptime
- current_time

### POST /api/log/play

player.jsから再生ログを保存する。

項目：

- timestamp
- tenant_id
- store_id
- location_id
- screen_group_id
- device_id
- playlist_version
- item_id
- layout
- asset_paths
- duration
- result

## player.html仕様

### キャンバス

- 本番サイズ：5760 x 1080
- 左ゾーン：0〜1920
- 中央ゾーン：1920〜3840
- 右ゾーン：3840〜5760

### preview mode

ローカル開発用にURL queryで切替可能にする。

例：

- `/player?preview=1`

preview時：

- CSS transform scaleで画面内に収める
- 3ゾーン境界線を表示する
- zone名を薄く表示する

### 表示ロジック

1. `/api/config` を取得
2. `/api/playlist` を取得
3. validation okでない場合はエラー画面
4. enabledかつ時間帯に合うitemsだけ再生
5. item.durationごとに次へ
6. 再生開始ごとに `/api/log/play` へ送信

## admin.html仕様

### MVP画面

1. LoginはBasic auth
2. Dashboard
3. Assets一覧
4. Upload form
5. Playlist JSON editor
6. Validation errors表示
7. Save button
8. Player open button

### Playlist editor

MVPでは高機能フォームではなく、JSON editorでよい。

ただし保存前にvalidation errorを見せる。

## セキュリティMVP

必須：

- `/admin` と `/api/assets` と `/api/playlist POST` はBasic auth
- uploadは拡張子/MIME/サイズを検証
- path traversal防止
- HTML/URL upload禁止
- `.env` はGitに含めない

## ログ仕様

保存先：

- `logs/playlog.jsonl`
- `logs/error.log`
- `logs/admin.log`

MVPではローテーションは別Issueでもよいが、ログ出力先は固定する。

## 受け入れ条件

### Local Dev Pass

- `npm install` が通る
- `npm start` で起動する
- `/player?preview=1` が表示される
- `/admin` がBasic authで守られる
- 素材アップロードできる
- playlist保存できる
- three-zone表示できる
- wide表示できる
- validation errorが出る
- playlogが残る

### Device Pass

- 実端末で3画面表示できる
- kioskで5760 x 1080表示できる
- systemdで自動起動できる
- 再起動後に復旧できる
- 6時間連続再生できる

## 実装順

1. package.json / server.js
2. public/player.html
3. public/player.js
4. data/playlist.json
5. playlist schema / validation
6. data/config.json
7. playlog出力
8. public/admin.html
9. upload API
10. basic auth
11. kiosk scripts
12. systemd service

## やらないこと

MVPでは以下は実装しない。

- Remote CMS
- DB
- ユーザー管理
- 広告課金
- AI
- ESL API
- 複数店舗管理

ただし、データ構造は将来移行しやすくする。
