# 58. Cloud Monitoring MVP仕様

## 目的

Misell端末が複数台になったときに、端末の死活、バージョン、playlist、ログ、障害状態をクラウド側で確認できる最小実装を定義する。

この仕様はRemote CMS全体の初期段階であり、広告CMS、素材配信、契約管理、顧客向けポータルより先に作る。

## 位置づけ

### 既に端末側で準備済み

- `GET /api/status`
- `GET /api/heartbeat`
- `scripts/emit-heartbeat.sh`
- `MISELL_DEVICE_TOKEN`
- `release_id`
- `release_channel`
- `config_version`
- `playlist_version`
- `device_id/store_id/location_id/screen_group_id`

### Cloud Monitoring MVPで作るもの

- 端末台帳
- device token認証
- heartbeat受信
- online/offline/warning/critical判定
- 端末一覧画面
- 端末詳細画面
- playlog受信
- error log受信
- alert rule skeleton
- release/playlist/config versionの記録

### まだ作らないもの

- 完全なRemote CMS
- クラウドplaylist編集/配信
- 素材アップロード/素材ストレージ
- 顧客向け権限管理
- 決済/請求
- 自動rollback
- 広告主管理
- 月次レポート生成

## 技術方針

### MVP実装

- `apps/cloud`
- Node.js 20+
- Express
- SQLite
- Server-rendered HTMLまたは静的HTML + API
- Basic auth for admin
- Bearer token for device API
- UI/通知/運用文言は日本語を標準にする

### 商用移行時

- DBはPostgreSQLへ移行
- AuthはSupabase Auth/Auth.js等へ移行
- StorageはS3互換へ移行
- Device APIの形は維持する

SQLiteで始める理由:

- ローカル開発と端末検証が速い
- DB運用を増やさずにheartbeatの価値検証ができる
- schemaをPostgreSQLへ移しやすい形で設計できる

## 日本語対応

Misellは日本国内の店舗・施設運用を初期ターゲットにするため、Cloud Monitoring MVPの管理画面、通知、運用文言は日本語を標準にする。

### 基本方針

- 管理画面の表示言語は日本語を標準にする
- DB/APIの内部値は英語のstable codeを使う
- 日本語表示はUI側のlabel mappingで行う
- 日時表示は日本の運用者が読みやすい形式にする
- 文字コードはUTF-8に統一する
- `device_id`、`store_id`、`release_channel`、`status` などの識別子はASCIIを維持する

### canonical value

以下はDB/APIでは英語のまま保持する。

- status: `online`, `degraded`, `offline`, `critical`, `maintenance`, `retired`, `lost`
- release_channel: `dev`, `staging`, `canary`, `stable`, `hold`
- alert severity: `warning`, `critical`
- alert type: `offline`, `disk_low`, `memory_high`, `last_error`, `device_error`

### UI表示例

| 内部値 | 日本語表示 |
|---|---|
| online | 正常 |
| degraded | 注意 |
| offline | 未接続 |
| critical | 至急対応 |
| maintenance | メンテナンス中 |
| retired | 退役済み |
| lost | 紛失 |
| warning | 注意 |
| critical | 重大 |

### 日時

- 保存はISO8601 UTC文字列を基本にする
- UI表示はブラウザの日本語ロケールで表示する
- 将来のサーバーサイド通知では `Asia/Tokyo` を明示する

### 通知文面

Slack/Discord/Email通知は日本語テンプレートを標準にする。

例:

```text
[重大] DEV-000001 / STO-0001
10分以上heartbeatが届いていません。
最終受信: 2026-06-05 11:24
推奨対応: Tailscaleで接続し、misell-player.serviceとネットワーク状態を確認してください。
```

### 将来拡張

- 管理画面は将来 `ja` / `en` 切替可能にする
- 顧客向け画面は日本語を初期値にする
- 買収候補/海外展開向け資料では英語UIを追加できるよう、内部値と表示文言を分離する

## アーキテクチャ

```text
Ubuntu terminal
  scripts/emit-heartbeat.sh
    POST /api/device/heartbeat
    Authorization: Bearer device_token

Cloud Monitoring MVP
  apps/cloud
    Device API
    Admin API
    Admin dashboard
    SQLite DB
```

端末はクラウドへpull/push-outする。クラウドから店舗LAN内端末へ直接接続しない。

## ID設計

既存設計に合わせる。

- `tenant_id`: 顧客企業
- `store_id`: 店舗/施設
- `location_id`: 設置場所
- `screen_group_id`: 画面グループ
- `device_id`: 端末
- `device_token`: 端末API認証

## 状態モデル

| status | 判定 | 意味 |
|---|---|---|
| online | heartbeat 3分以内、重大エラーなし | 正常 |
| degraded | heartbeatあり、warning条件あり | 注意 |
| offline | heartbeat 3分以上なし | 要確認 |
| critical | heartbeat 10分以上なし、または重大条件 | 至急対応 |
| maintenance | 手動メンテ中 | 通知抑制 |
| retired | 退役済み | 監視対象外 |
| lost | 紛失/盗難 | token無効 |

## Alert判定

### warning

- `last_seen` が3分以上前
- `disk_free_mb < 10240`
- `memory_used_percent >= 85`
- `last_error` が存在
- 同一端末のerror logが10分内に3件以上

### critical

- `last_seen` が10分以上前
- `disk_free_mb < 2048`
- `service_state != active`
- `ok == false`
- `last_error` がcritical扱い
- 端末状態がlost/retired以外でheartbeat停止

## DB設計

### tenants

```sql
CREATE TABLE tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### stores

```sql
CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### locations

```sql
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  location_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### screen_groups

```sql
CREATE TABLE screen_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  screen_group_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_count INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### devices

```sql
CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  screen_group_id TEXT NOT NULL,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  token_status TEXT NOT NULL DEFAULT 'active',
  token_generation INTEGER NOT NULL DEFAULT 1,
  token_rotated_at TEXT,
  token_revoked_at TEXT,
  token_revoked_reason TEXT,
  token_last_used_at TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  release_channel TEXT NOT NULL DEFAULT 'stable',
  app_version TEXT,
  release_id TEXT,
  playlist_version TEXT,
  config_version TEXT,
  last_seen TEXT,
  last_heartbeat_id INTEGER,
  last_error TEXT,
  notes TEXT,
  target_update_ref TEXT,
  target_release_id TEXT,
  target_release_channel TEXT,
  update_manifest_id TEXT,
  update_status TEXT NOT NULL DEFAULT 'idle',
  update_requested_at TEXT,
  update_started_at TEXT,
  update_completed_at TEXT,
  update_last_checked_at TEXT,
  update_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### device_token_events

```sql
CREATE TABLE device_token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  event TEXT NOT NULL,
  token_generation INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL
);
```

### release_manifests

```sql
CREATE TABLE release_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id TEXT NOT NULL UNIQUE,
  release_id TEXT NOT NULL,
  release_channel TEXT NOT NULL,
  update_ref TEXT NOT NULL,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
```

### content_manifests

```sql
CREATE TABLE content_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL UNIQUE,
  playlist_version TEXT NOT NULL,
  release_channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  notes TEXT,
  playlist_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
```

### heartbeats

```sql
CREATE TABLE heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  screen_group_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  device_timestamp TEXT,
  ok INTEGER NOT NULL,
  app_version TEXT,
  release_id TEXT,
  release_channel TEXT,
  playlist_version TEXT,
  config_version TEXT,
  uptime_seconds INTEGER,
  system_uptime_seconds INTEGER,
  service_state TEXT,
  kiosk_state TEXT,
  current_item_id TEXT,
  disk_free_mb INTEGER,
  memory_used_percent INTEGER,
  cpu_load_1m REAL,
  temperature_c REAL,
  network_status TEXT,
  display_status TEXT,
  last_error TEXT,
  raw_json TEXT NOT NULL
);
```

### playlogs

```sql
CREATE TABLE playlogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  screen_group_id TEXT,
  received_at TEXT NOT NULL,
  played_at TEXT,
  playlist_version TEXT,
  playlist_item_id TEXT,
  campaign_id TEXT,
  asset_id TEXT,
  layout TEXT,
  duration INTEGER,
  result TEXT,
  raw_json TEXT NOT NULL
);
```

### error_logs

```sql
CREATE TABLE error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  occurred_at TEXT,
  severity TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  path TEXT,
  raw_json TEXT NOT NULL
);
```

### device_log_bundles

```sql
CREATE TABLE device_log_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  screen_group_id TEXT,
  received_at TEXT NOT NULL,
  captured_at TEXT,
  label TEXT,
  reason TEXT,
  source TEXT,
  hostname TEXT,
  app_version TEXT,
  release_id TEXT,
  release_channel TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL
);
```

### alerts

```sql
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  resolved_at TEXT,
  metadata_json TEXT
);
```

## 認証

### Device API

端末はBearer tokenで認証する。

```http
Authorization: Bearer <device_token>
```

保存方式:

- DBには平文保存しない
- `device_token_hash` にsha256またはbcrypt/argon2 hashを保存
- MVPではsha256 + pepperでも可
- token発行/失効/再発行履歴を `device_token_events` に保存する

認証条件:

- tokenが存在する
- hashが一致する
- `token_status` が `revoked` ではない
- device statusが `retired` / `lost` ではない
- payloadの `device_id` がtoken所有端末と一致する

### Admin

MVPではBasic auth。

環境変数:

- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `REQUIRE_ADMIN_AUTH=1`

商用ではrole-based authへ移行する。

## API仕様

### GET /api/health

クラウドアプリ自体のhealth。

レスポンス:

```json
{
  "ok": true,
  "name": "misell-cloud",
  "version": "0.1.0",
  "time": "2026-06-05T10:00:00+09:00"
}
```

### POST /api/device/heartbeat

端末heartbeat受信。

認証:

- Bearer device token必須

処理:

1. token検証
2. payload validation
3. `heartbeats` へ保存
4. `devices` の `last_seen` とversion類を更新
5. warning/critical判定
6. 必要なら `alerts` を作成/更新

レスポンス:

```json
{
  "ok": true,
  "device_id": "DEV-000001",
  "status": "online",
  "received_at": "2026-06-05T10:00:00+09:00",
  "next_interval_seconds": 60
}
```

### POST /api/device/playlog

放映ログ受信。

認証:

- Bearer device token必須

処理:

- `playlogs` へ保存
- 後続の広告レポートに利用する

### POST /api/device/error

端末エラー受信。

認証:

- Bearer device token必須

処理:

- `error_logs` へ保存
- warning/critical判定
- alert作成/更新

### POST /api/device/logs

障害調査用ログバンドル受信。

認証:

- Bearer device token必須

入力:

```json
{
  "device_id": "DEV-000001",
  "captured_at": "2026-06-05T10:00:00+09:00",
  "label": "incident",
  "reason": "kiosk did not start",
  "source": "collect-device-evidence.sh",
  "hostname": "misell-demo",
  "release_id": "main-ac28bf6",
  "entries": [
    {
      "name": "misell_journal_player",
      "filename": "misell_journal_player.txt",
      "kind": "text",
      "content": "...",
      "bytes": 12000,
      "original_bytes": 12000,
      "truncated": false
    }
  ]
}
```

処理:

- `device_log_bundles` へ保存
- entry件数、1 entry bytes、合計bytesに上限を設ける
- 管理画面に直近ログ収集履歴を表示する

### GET /api/admin/devices

端末一覧。

認証:

- Admin Basic auth

返す項目:

- device_id
- device_name
- tenant_id
- store_id
- location_id
- screen_group_id
- token_status
- token_generation
- token_rotated_at
- token_revoked_at
- token_last_used_at
- status
- last_seen
- app_version
- release_id
- release_channel
- playlist_version
- config_version
- disk_free_mb
- memory_used_percent
- current_item_id
- last_error

### GET /api/admin/devices/:device_id

端末詳細。

返す項目:

- device基本情報
- 最新heartbeat
- 過去heartbeat 100件
- open alerts
- recent playlogs
- recent error logs

### POST /api/admin/devices

端末登録。

MVPでは管理者がJSONで登録してもよい。

入力:

```json
{
  "tenant_id": "TEN-0001",
  "store_id": "STO-0001",
  "location_id": "LOC-LOBBY-001",
  "screen_group_id": "SG-000001",
  "device_id": "DEV-000001",
  "device_name": "demo device",
  "release_channel": "stable"
}
```

レスポンス:

```json
{
  "ok": true,
  "device_id": "DEV-000001",
  "device_token": "shown-only-once"
}
```

`device_token` はこのレスポンスで一度だけ表示する。

### POST /api/admin/devices/:device_id/token/revoke

端末トークンを即時失効する。

入力:

```json
{
  "reason": "terminal lost"
}
```

レスポンス:

```json
{
  "ok": true,
  "device": {}
}
```

### POST /api/admin/devices/:device_id/token/rotate

端末トークンを再発行する。旧トークンは即時無効になり、新しい `device_token` はこのレスポンスで一度だけ表示する。

入力:

```json
{
  "reason": "scheduled rotation"
}
```

レスポンス:

```json
{
  "ok": true,
  "device_id": "DEV-000001",
  "device_token": "shown-only-once",
  "device": {}
}
```

### PATCH /api/admin/devices/:device_id/update

端末個別のGit ref更新を予約する。個別予約はrelease manifestより優先される。

入力:

```json
{
  "target_update_ref": "origin/main",
  "target_release_id": "rel-20260605-001",
  "target_release_channel": "canary"
}
```

空の `target_update_ref` を送ると個別予約を解除する。

### GET /api/admin/release-manifests

release manifest一覧を返す。

### POST /api/admin/release-manifests

release channel単位の更新manifestを作成する。

入力:

```json
{
  "manifest_id": "rel-20260605-canary-001",
  "release_id": "rel-20260605-001",
  "release_channel": "canary",
  "update_ref": "origin/main",
  "status": "active",
  "app_version": "0.1.0",
  "notes": "canary rollout"
}
```

`status=active` の場合、同一 `release_channel` の旧active manifestは `retired` へ変更する。`hold` channelにactive manifestは作成しない。

### PATCH /api/admin/release-manifests/:manifest_id

manifestの `release_id`、`release_channel`、`update_ref`、`app_version`、`status`、`notes` を更新する。既存manifestを `active` にした場合も同一channelの旧active manifestを退役する。

### GET /api/device/update-policy

端末が更新ポリシーをpullする。

優先順位:

1. 端末個別の `target_update_ref`
2. 端末の `release_channel` に一致するactive release manifest
3. 更新なし

レスポンス例:

```json
{
  "ok": true,
  "device_id": "DEV-000001",
  "current": {
    "app_version": "0.1.0",
    "release_id": "main-ac28bf6",
    "release_channel": "canary"
  },
  "update": {
    "required": true,
    "status": "pending",
    "source": "release_manifest",
    "target_manifest_id": "rel-20260605-canary-001",
    "target_update_ref": "origin/main",
    "target_release_id": "rel-20260605-001",
    "target_release_channel": "canary"
  }
}
```

### POST /api/device/update-result

端末が更新結果を報告する。

入力:

```json
{
  "status": "success",
  "target_manifest_id": "rel-20260605-canary-001",
  "target_update_ref": "origin/main",
  "target_release_id": "rel-20260605-001",
  "release_id": "rel-20260605-001",
  "release_channel": "canary"
}
```

`status=failed` の場合は `update_failed` alertを作成し、`message` を `devices.update_error` に残す。

### GET /api/admin/content-manifests

Cloud playlist manifest一覧を返す。

### POST /api/admin/content-manifests

release channel単位のplaylist manifestを作成する。

入力:

```json
{
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
}
```

`status=active` の場合、同一 `release_channel` の旧active content manifestは `retired` へ変更する。MVPではplaylist JSON配信のみを扱い、Cloud asset storage/syncは次段階とする。

### PATCH /api/admin/content-manifests/:content_id

content manifestの `playlist_version`、`release_channel`、`status`、`title`、`notes`、`playlist` を更新する。

### GET /api/device/content-policy

端末がplaylist同期ポリシーをpullする。端末の `release_channel` に一致するactive content manifestがあり、`playlist_version` が端末の現行値と異なる場合に `required=true` を返す。

### POST /api/device/content-result

端末がplaylist同期結果を報告する。`status=failed` の場合は `content_sync_failed` alertを作成する。

## 管理画面

### /admin

Dashboard。

表示:

- online台数
- degraded台数
- offline台数
- critical台数
- app_version分布
- release_channel分布
- 最新alerts
- release manifest一覧/作成
- content manifest一覧/作成
- log bundle履歴

### /admin/devices

端末一覧。

列:

- status
- device_id
- device_name
- store_id
- location_id
- last_seen
- app_version
- release_id
- token_status
- token_generation
- playlist_version
- disk_free
- memory
- current_item

### /admin/devices/:device_id

端末詳細。

表示:

- 基本情報
- 最新heartbeat
- version情報
- token状態
- token操作履歴
- log bundle履歴
- resource状態
- open alerts
- recent playlogs
- recent errors

## Alert運用

### MVP

- 管理画面にopen alertsを表示
- 通知送信はstubまたはログ出力

### 次段階

- Slack webhook
- Discord webhook
- Email
- 通知抑制
- maintenance中の通知停止

## 端末登録フロー

1. 管理画面またはCLIでtenant/store/location/screen_group/deviceを登録
2. device_tokenを一度だけ表示
3. 端末側 `scripts/enroll-device.sh --device-token ...` でenv生成
4. 端末側 `MISELL_HEARTBEAT_URL` を設定
5. `scripts/emit-heartbeat.sh` で疎通確認
6. `INSTALL_HEARTBEAT=1 scripts/setup-autostart.sh`
7. Cloud adminでonline確認

## 端末側env例

```env
MISELL_TENANT_ID=TEN-0001
MISELL_STORE_ID=STO-0001
MISELL_LOCATION_ID=LOC-LOBBY-001
MISELL_SCREEN_GROUP_ID=SG-000001
MISELL_DEVICE_ID=DEV-000001
MISELL_DEVICE_NAME=demo-device
MISELL_DEVICE_TOKEN=generated-token
MISELL_HEARTBEAT_URL=https://cloud.example.com/api/device/heartbeat
MISELL_RELEASE_CHANNEL=stable
MISELL_CONFIG_VERSION=cfg-20260605-001
```

## 実装順

### PR 1: apps/cloud skeleton

- `apps/cloud/package.json`
- `apps/cloud/server.js`
- `apps/cloud/data/.gitkeep`
- `apps/cloud/public/`
- `GET /api/health`
- Basic auth

### PR 2: SQLite schema / device registry

- DB初期化
- tenants/stores/locations/screen_groups/devices
- `POST /api/admin/devices`
- token生成/hash保存
- token失効/再発行

### PR 3: heartbeat ingest

- Bearer token認証
- `POST /api/device/heartbeat`
- payload validation
- `devices.last_seen` 更新
- status判定

### PR 4: dashboard

- `/admin`
- `/admin/devices`
- `/admin/devices/:device_id`
- `GET /api/admin/device-log-bundles`
- `GET /api/admin/device-log-bundles/:id`

### PR 5: playlog/error ingest

- `POST /api/device/playlog`
- `POST /api/device/error`
- `POST /api/device/logs`
- recent logs表示

### PR 6: alerts

- warning/critical判定
- alerts table
- open/resolved
- notification stub

### PR 7: release operations

- `release_manifests` table
- release manifest管理API
- release channel単位のupdate policy
- update resultへの `target_manifest_id` 記録

### PR 8: content operations

- `content_manifests` table
- content manifest管理API
- device content policy/result API
- 端末content sync script/timer
- 端末コンテンツバックアップscript/API

## 受け入れ条件

### Local Cloud Pass

- `npm install` が通る
- `npm start` で起動する
- `/api/health` が200
- `/admin` がBasic authで守られる
- device登録でtokenが発行される
- tokenなしheartbeatが401
- 不正token heartbeatが401
- 正しいtoken heartbeatが200
- token失効後のheartbeatが403
- token再発行後に旧tokenが401、新tokenが200
- device log bundleを送信できる
- 管理画面に直近log bundleが表示される
- devices一覧にlast_seenが出る
- 3分/10分判定の関数テストがある

### Device Integration Pass

- Ubuntu端末の `scripts/emit-heartbeat.sh` から送信できる
- Cloud上で `DEV-DEMO-001` がonlineになる
- `app_version/release_id/release_channel/playlist_version/config_version` が見える
- tokenを無効化した端末は403になる
- `scripts/collect-device-evidence.sh --upload` でCloudに証跡を送れる
- active release manifestを作成すると同じchannelの端末update policyが `required=true` になる
- 端末がupdate resultを送ると `update_manifest_id` と `release_id` が更新される
- active content manifestを作成すると同じchannelの端末content policyが `required=true` になる
- 端末がcontent resultを送ると `playlist_version` が更新される

## セキュリティ

- device tokenは平文保存しない
- tokenは一度だけ表示
- token失効/再発行履歴を残す
- `/admin` は認証必須
- request body sizeを制限する
- raw_jsonは保存するが秘密情報を含めない
- retired/lost端末のtokenは拒否する
- CORSはMVPでは不要なら無効
- public internetへ出す場合はHTTPS必須

## 運用上の注意

- heartbeat停止だけで顧客へ即通知しない
- MVPではまず社内通知に留める
- 店舗営業時間外や端末メンテ中はmaintenance statusを使う
- Tailscale SSHは障害調査用であり、監視の主経路にしない
- alertの誤検知が多い場合は通知閾値を調整する

## 将来拡張

- Cloud asset storage/sync
- Artifact-backed release bundle
- Pending commands
- Screenshot upload
- Slack/Discord notification
- Role-based admin
- Tenant-separated dashboard
- PostgreSQL migration
- Supabase Auth / Storage integration
