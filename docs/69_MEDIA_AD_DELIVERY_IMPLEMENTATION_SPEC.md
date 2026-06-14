# 69. Media広告配信・Proof of Play 実装仕様

## 目的

このドキュメントは、MisellのMediaプランで提供する広告配信機能を、開発チームが迷わず実装できる粒度まで落とし込むための仕様である。

NoviSignでは、広告系機能は Business Plus 以上の価値として位置づけられている。Misellでも同様に、広告配信・Proof of Play・広告主レポートはStandardではなくMediaプランの課金根拠にする。

## 重要な設計方針

### 最初から広告ネットワーク連携はしない

Phase 1では、Vistar/Adomniのような外部DOOH広告ネットワーク連携は実装しない。

まず作るのは、施設や店舗が自社で広告枠を売れるための最低限の機能である。

### Mediaプランの最小価値

Mediaプランで顧客がお金を払う理由は以下。

1. 広告主を登録できる
2. 広告素材を管理できる
3. 掲載期間を指定できる
4. 左/中央/右/3面wideのどこに出すか指定できる
5. ちゃんと流れた証拠を出せる
6. QR反応を見られる
7. 月次レポートを広告主に渡せる

これ以外は後回しにする。

## 用語定義

| 用語 | 意味 |
| --- | --- |
| Advertiser | 広告主。広告掲載料を支払う会社/店舗/団体 |
| Campaign | 掲載キャンペーン。期間、目的、広告主を持つ |
| Creative | 広告素材。画像/動画/QR付き素材 |
| Placement | 掲載枠。左/中央/右/3面wideなど |
| Ad Schedule | 広告の配信条件。期間、曜日、時間帯、優先度 |
| Impression | 広告が1回再生された実績 |
| Playlog | プレイヤーが記録する再生ログ |
| Proof of Play | 広告が実際に再生された証拠/集計レポート |
| QR Event | QR誘導先で発生したクリック/アクセスログ |

## Phase分け

## Phase 1: Media MVP

### 実装範囲

- 広告主登録
- キャンペーン登録
- 広告素材登録
- 掲載枠指定
- 掲載期間指定
- 曜日/時間帯指定
- プレイヤーへの広告配信
- 再生ログ記録
- QRクリックログ記録
- 広告主別の簡易レポート
- CSV出力

### 実装しないもの

- 外部広告ネットワーク連携
- 自動入札
- CPM課金
- 配信最適化AI
- 競合排除
- 複雑な審査フロー
- 請求書自動発行
- 広告在庫の高度管理

## Phase 2: Proof of Play強化

- 再生完了率
- 再生中断理由
- オフライン時の再生ログ同期
- 広告主向け月次PDF
- 店舗別/端末別/枠別集計
- 掲載証跡のハッシュ/改ざん検知メモ
- レポート自動メール送信

## Phase 3: 広告運用管理

- 枠在庫管理
- 掲載単価管理
- 代理店管理
- 広告審査
- NG業種/競合排除
- 複数店舗一括配信
- 広告主ログイン
- 請求管理連携

## Phase 4: AI/外部広告連携

- 視認者数推定
- 時間帯別反応分析
- AI配信改善提案
- 外部広告ネットワーク連携
- 動的差し替え

## UIメニュー構成

Mediaプランで追加する管理メニュー。

```text
Misell Studio
├── ダッシュボード
├── 素材
├── レイアウト
├── スケジュール
├── 端末管理
├── レポート
└── 広告管理
    ├── 広告主
    ├── キャンペーン
    ├── 広告素材
    ├── 掲載枠
    ├── 配信スケジュール
    └── レポート
```

## 画面仕様

## 1. 広告主管理画面

### 一覧表示

表示項目:

- 広告主名
- 担当者名
- メール
- 電話番号
- ステータス
- 有効キャンペーン数
- 作成日

操作:

- 新規作成
- 編集
- 無効化
- 詳細

### 新規/編集フォーム

入力項目:

| 項目 | 必須 | 型 | 備考 |
| --- | --- | --- | --- |
| 広告主名 | 必須 | text | 会社名/店舗名 |
| 表示名 | 任意 | text | レポート表示用 |
| 担当者名 | 任意 | text | 連絡先 |
| メール | 任意 | email | レポート送付先候補 |
| 電話番号 | 任意 | text | 連絡先 |
| メモ | 任意 | textarea | 社内メモ |
| ステータス | 必須 | enum | active / inactive |

バリデーション:

- 広告主名は1文字以上100文字以内
- メールは形式チェック
- ステータス未指定ならactive

## 2. キャンペーン管理画面

### 一覧表示

表示項目:

- キャンペーン名
- 広告主
- ステータス
- 掲載開始日
- 掲載終了日
- 掲載枠
- 再生回数
- QRクリック数

操作:

- 新規作成
- 編集
- 複製
- 停止
- レポート表示

### 新規/編集フォーム

入力項目:

| 項目 | 必須 | 型 | 備考 |
| --- | --- | --- | --- |
| キャンペーン名 | 必須 | text | 管理名 |
| 広告主 | 必須 | advertiser_id | 選択式 |
| 目的 | 任意 | enum | awareness / visit / recruit / sale / other |
| 掲載開始日 | 必須 | date | JST基準 |
| 掲載終了日 | 必須 | date | JST基準 |
| ステータス | 必須 | enum | draft / active / paused / ended |
| メモ | 任意 | textarea | 社内メモ |

バリデーション:

- 掲載終了日は掲載開始日以降
- activeにするには、1つ以上のCreativeとAd Scheduleが必要
- endedは自動判定可能だが、手動停止も許可

## 3. 広告素材管理画面

広告用Creativeは通常素材Assetと紐づける。

### 一覧表示

表示項目:

- サムネイル
- 素材名
- 種別
- 尺
- 解像度
- 広告主
- キャンペーン
- 審査状態
- 使用中/未使用

### 新規/編集フォーム

入力項目:

| 項目 | 必須 | 型 | 備考 |
| --- | --- | --- | --- |
| キャンペーン | 必須 | campaign_id | 所属キャンペーン |
| Asset | 必須 | asset_id | 既存素材から選択またはアップロード |
| 素材名 | 必須 | text | 表示名 |
| クリックURL | 任意 | url | QR生成元URL |
| QR表示 | 任意 | boolean | QR付きテンプレートで使う |
| 審査状態 | 必須 | enum | draft / approved / rejected |
| メモ | 任意 | textarea | 社内メモ |

Phase 1の審査:

- 自動審査はしない
- Operatorがapprovedにしたものだけ配信対象にする

## 4. 掲載枠管理画面

Phase 1では掲載枠は固定プリセットでよい。

### 初期プリセット

| placement_key | UI表示 | 説明 |
| --- | --- | --- |
| left | 左画面 | 左モニター全体 |
| center | 中央画面 | 中央モニター全体 |
| right | 右画面 | 右モニター全体 |
| wide | 3面wide | 3面ぶち抜き |
| lower_third | 下部帯 | テロップ/バナー枠。Phase 2以降 |
| qr_side | QR枠 | QR固定枠。Phase 2以降 |

Phase 1では `left / center / right / wide` のみ実装する。

## 5. 配信スケジュール画面

キャンペーンごとに配信条件を設定する。

入力項目:

| 項目 | 必須 | 型 | 備考 |
| --- | --- | --- | --- |
| キャンペーン | 必須 | campaign_id |  |
| Creative | 必須 | creative_id | approvedのみ選択可 |
| 店舗/施設 | 必須 | site_id | Phase 1は1施設でもよい |
| 3連画面 | 必須 | display_wall_id |  |
| 掲載枠 | 必須 | placement_key | left/center/right/wide |
| 開始日 | 必須 | date | キャンペーン期間内 |
| 終了日 | 必須 | date | キャンペーン期間内 |
| 曜日 | 必須 | weekdays | Mon-Sun配列 |
| 開始時刻 | 必須 | time | JST |
| 終了時刻 | 必須 | time | JST |
| 優先度 | 必須 | integer | 数字が大きいほど優先 |
| 1時間あたり上限 | 任意 | integer | Phase 2以降 |
| ステータス | 必須 | enum | active / paused |

バリデーション:

- Creativeはapprovedのみ
- Schedule期間はCampaign期間内
- wide枠はwide対応レイアウトでのみ配信可能
- 時刻は開始 < 終了
- weekdaysは1つ以上必須

## 6. 広告レポート画面

Phase 1のレポート項目:

- 期間
- 広告主
- キャンペーン
- 店舗
- 掲載枠
- 再生回数
- 再生完了数
- QRクリック数
- 最終再生日
- CSVダウンロード

集計単位:

- 日別
- 素材別
- 掲載枠別
- 店舗別
- キャンペーン別

## データモデル

以下はPostgreSQL想定。実装言語/ORMに合わせて調整可。

## advertisers

```sql
CREATE TABLE advertisers (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

制約:

- status: active / inactive
- tenant_id + name にインデックス

## ad_campaigns

```sql
CREATE TABLE ad_campaigns (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  advertiser_id UUID NOT NULL REFERENCES advertisers(id),
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'draft',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

制約:

- objective: awareness / visit / recruit / sale / other
- status: draft / active / paused / ended
- end_date >= start_date

## ad_creatives

```sql
CREATE TABLE ad_creatives (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  campaign_id UUID NOT NULL REFERENCES ad_campaigns(id),
  asset_id UUID NOT NULL,
  name TEXT NOT NULL,
  click_url TEXT,
  qr_enabled BOOLEAN NOT NULL DEFAULT false,
  review_status TEXT NOT NULL DEFAULT 'draft',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

制約:

- review_status: draft / approved / rejected
- approved以外は配信対象外

## ad_placements

Phase 1ではマスターテーブルとして固定データを入れる。

```sql
CREATE TABLE ad_placements (
  id UUID PRIMARY KEY,
  placement_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

初期データ:

```sql
INSERT INTO ad_placements (id, placement_key, name, description) VALUES
(gen_random_uuid(), 'left', '左画面', '左モニター全体'),
(gen_random_uuid(), 'center', '中央画面', '中央モニター全体'),
(gen_random_uuid(), 'right', '右画面', '右モニター全体'),
(gen_random_uuid(), 'wide', '3面wide', '3面ぶち抜き');
```

## ad_schedules

```sql
CREATE TABLE ad_schedules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  campaign_id UUID NOT NULL REFERENCES ad_campaigns(id),
  creative_id UUID NOT NULL REFERENCES ad_creatives(id),
  site_id UUID NOT NULL,
  display_wall_id UUID NOT NULL,
  placement_key TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  weekdays JSONB NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

制約:

- placement_key: left / center / right / wide
- status: active / paused
- weekdays: `["mon","tue","wed"]` のような配列
- end_date >= start_date
- end_time > start_time

## ad_play_events

プレイヤーから送られる広告再生ログ。Proof of Playの元データ。

```sql
CREATE TABLE ad_play_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  creative_id UUID NOT NULL,
  schedule_id UUID,
  advertiser_id UUID NOT NULL,
  site_id UUID NOT NULL,
  display_wall_id UUID NOT NULL,
  device_id UUID NOT NULL,
  placement_key TEXT NOT NULL,
  playback_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  planned_duration_ms INTEGER,
  actual_duration_ms INTEGER,
  completed BOOLEAN NOT NULL DEFAULT false,
  interrupted_reason TEXT,
  player_local_time TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

重要:

- `playback_id` はプレイヤー側で生成する一意ID
- オフライン再生時もローカルに保存し、復帰後に同期する
- 同じ `device_id + playback_id` は重複登録しない

ユニーク制約:

```sql
CREATE UNIQUE INDEX ad_play_events_device_playback_uidx
ON ad_play_events (device_id, playback_id);
```

## qr_events

QRクリック/アクセスログ。

```sql
CREATE TABLE qr_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  advertiser_id UUID,
  campaign_id UUID,
  creative_id UUID,
  site_id UUID,
  display_wall_id UUID,
  placement_key TEXT,
  qr_token TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip_hash TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

注意:

- IPアドレスを生で保存しない
- `ip_hash` はソルト付きハッシュにする
- 個人識別目的では使わない

## API設計

## Admin API

### Advertisers

```http
GET    /api/admin/advertisers
POST   /api/admin/advertisers
GET    /api/admin/advertisers/:id
PATCH  /api/admin/advertisers/:id
DELETE /api/admin/advertisers/:id
```

削除は物理削除ではなく `status=inactive` にする。

### Campaigns

```http
GET    /api/admin/ad-campaigns
POST   /api/admin/ad-campaigns
GET    /api/admin/ad-campaigns/:id
PATCH  /api/admin/ad-campaigns/:id
POST   /api/admin/ad-campaigns/:id/pause
POST   /api/admin/ad-campaigns/:id/activate
POST   /api/admin/ad-campaigns/:id/duplicate
```

### Creatives

```http
GET    /api/admin/ad-creatives
POST   /api/admin/ad-creatives
GET    /api/admin/ad-creatives/:id
PATCH  /api/admin/ad-creatives/:id
POST   /api/admin/ad-creatives/:id/approve
POST   /api/admin/ad-creatives/:id/reject
```

### Schedules

```http
GET    /api/admin/ad-schedules
POST   /api/admin/ad-schedules
GET    /api/admin/ad-schedules/:id
PATCH  /api/admin/ad-schedules/:id
POST   /api/admin/ad-schedules/:id/pause
POST   /api/admin/ad-schedules/:id/resume
```

### Reports

```http
GET /api/admin/ad-reports/summary
GET /api/admin/ad-reports/daily
GET /api/admin/ad-reports/by-campaign
GET /api/admin/ad-reports/by-creative
GET /api/admin/ad-reports/by-placement
GET /api/admin/ad-reports/export.csv
```

Query例:

```text
?from=2026-06-01&to=2026-06-30&advertiser_id=...&campaign_id=...&site_id=...
```

## Player API

### 広告スケジュール取得

```http
GET /api/player/ad-schedules?device_id=...&display_wall_id=...
Authorization: Bearer <device_token>
```

レスポンス例:

```json
{
  "server_time": "2026-06-15T10:00:00+09:00",
  "schedules": [
    {
      "schedule_id": "uuid",
      "campaign_id": "uuid",
      "advertiser_id": "uuid",
      "creative_id": "uuid",
      "asset_id": "uuid",
      "asset_url": "https://...",
      "placement_key": "left",
      "start_date": "2026-06-01",
      "end_date": "2026-06-30",
      "weekdays": ["mon", "tue", "wed", "thu", "fri"],
      "start_time": "09:00:00",
      "end_time": "18:00:00",
      "priority": 100,
      "duration_ms": 15000,
      "checksum": "sha256..."
    }
  ]
}
```

### 再生ログ送信

```http
POST /api/player/ad-play-events
Authorization: Bearer <device_token>
```

リクエスト例:

```json
{
  "events": [
    {
      "playback_id": "device-uuid-20260615-000001",
      "campaign_id": "uuid",
      "creative_id": "uuid",
      "schedule_id": "uuid",
      "advertiser_id": "uuid",
      "site_id": "uuid",
      "display_wall_id": "uuid",
      "placement_key": "left",
      "started_at": "2026-06-15T10:00:00+09:00",
      "ended_at": "2026-06-15T10:00:15+09:00",
      "planned_duration_ms": 15000,
      "actual_duration_ms": 15000,
      "completed": true,
      "interrupted_reason": null,
      "player_local_time": "2026-06-15T10:00:15+09:00"
    }
  ]
}
```

レスポンス例:

```json
{
  "accepted": 1,
  "duplicates": 0,
  "errors": []
}
```

## QRリダイレクトAPI

```http
GET /q/:qr_token
```

処理:

1. qr_tokenからcampaign/creative/click_urlを取得
2. qr_eventsにクリックを記録
3. click_urlへ302 redirect

注意:

- UTMパラメータを自動付与できるようにする
- IPはハッシュ化して保存
- 個人情報を保存しない

## プレイヤー側の実装

## 広告挿入ルール

Phase 1では、通常プレイリストに広告枠を差し込む。

優先順位:

1. 緊急配信
2. 今すぐ公開
3. 広告スケジュール
4. 通常スケジュール
5. デフォルトプレイリスト

広告は、現在時刻にマッチするad_schedulesから選ぶ。

選択条件:

- status = active
- campaign status = active
- creative review_status = approved
- 今日の日付がstart_date〜end_date内
- 現在曜日がweekdaysに含まれる
- 現在時刻がstart_time〜end_time内
- display_wall_idが一致
- placement_keyが現在レイアウトで表示可能

複数候補がある場合:

1. priorityが高いもの
2. 同priorityなら、直近再生回数が少ないもの
3. それでも同じなら作成順

## ローカル保存

プレイヤーは広告スケジュールと素材をローカルに保存する。

保存対象:

- ad_schedules.json
- creatives metadata
- asset files
- pending_ad_play_events.jsonl

通信断時:

- 取得済みの広告スケジュールに従って再生継続
- play_eventsはローカルJSONLに保存
- 通信復帰後に一括送信
- 送信成功した行は削除または送信済みへ移動

## 再生ログ記録タイミング

動画/画像ともに以下で記録する。

### started

広告枠にCreativeが表示された瞬間。

### ended

予定秒数を満たして表示完了した瞬間。

### interrupted

次の理由で中断された場合。

- schedule_changed
- asset_missing
- player_reload
- device_shutdown
- render_error
- manual_stop

Phase 1ではstarted/endedを1イベントとして送ってよい。

## 集計ロジック

## 再生回数

```sql
COUNT(*) WHERE completed = true
```

## 再生開始数

```sql
COUNT(*)
```

## 完了率

```text
completed_count / started_count
```

## QRクリック数

```sql
COUNT(qr_events.id)
```

## 日別集計

JST基準で `started_at` を日付に丸める。

```sql
SELECT
  date_trunc('day', started_at AT TIME ZONE 'Asia/Tokyo') AS day,
  campaign_id,
  creative_id,
  placement_key,
  COUNT(*) AS started_count,
  COUNT(*) FILTER (WHERE completed = true) AS completed_count
FROM ad_play_events
WHERE started_at >= $1 AND started_at < $2
GROUP BY day, campaign_id, creative_id, placement_key;
```

## CSV出力項目

Phase 1のCSV:

```csv
日付,広告主,キャンペーン,素材,店舗,掲載枠,再生開始数,再生完了数,完了率,QRクリック数
```

## 権限

Phase 1では以下の3権限。

| ロール | 権限 |
| --- | --- |
| operator | 全広告主/キャンペーン/素材/配信/レポート管理 |
| customer_admin | 自社tenant内の閲覧/一部編集 |
| viewer | レポート閲覧のみ |

広告素材のapproved操作はoperatorのみ。

## 料金プランとの対応

| 機能 | Lite | Standard | Media | AI Edge |
| --- | ---: | ---: | ---: | ---: |
| QRログ | - | ○ | ○ | ○ |
| 簡易再生ログ | - | ○ | ○ | ○ |
| 広告主管理 | - | - | ○ | ○ |
| キャンペーン管理 | - | - | ○ | ○ |
| 掲載枠管理 | - | - | ○ | ○ |
| Proof of Play | - | - | ○ | ○ |
| 広告主別CSV | - | - | ○ | ○ |
| 広告主向けPDF | - | - | Phase 2 | ○ |
| AI配信改善 | - | - | - | ○ |

## 実装順序

開発チームは以下の順で進める。

1. DB migration作成
2. Advertiser CRUD
3. Campaign CRUD
4. Creative CRUD + Asset連携
5. Placement master投入
6. Ad Schedule CRUD
7. Player API: ad-schedules取得
8. Player側: ad_schedules.json保存
9. Player側: placement_keyに応じた広告表示
10. Player側: ad_play_eventsローカル記録
11. Player API: ad-play-events送信
12. Admin: 広告レポートsummary
13. Admin: CSV export
14. QR redirect API
15. QR events集計
16. UIの最低限整備
17. QAチェック

## QAチェックリスト

### 広告主

- 広告主を作成できる
- 広告主を編集できる
- 広告主を無効化できる
- 無効広告主のキャンペーンは新規activeにできない

### キャンペーン

- draftで作成できる
- Creative/Scheduleなしではactiveにできない
- start_date > end_date は保存できない
- pausedにすると配信されない

### Creative

- Assetと紐づけられる
- approved以外は配信されない
- rejectedはスケジュール作成時に選べない

### Schedule

- 期間外は配信されない
- 曜日外は配信されない
- 時間外は配信されない
- placement_keyがレイアウトに存在しない場合は配信されない
- priorityが高い広告が優先される

### Player

- 通信断でも取得済み広告を再生する
- 通信断中のplaylogをローカル保存する
- 通信復帰後にplaylogを送信する
- 同じplayback_idを二重登録しない
- asset_missing時は通常プレイリストへフォールバックする

### Report

- キャンペーン別再生数が表示される
- 日別再生数が表示される
- 掲載枠別再生数が表示される
- QRクリック数が表示される
- CSV出力できる

## 完了条件

Phase 1完了条件:

- 管理画面から広告主/キャンペーン/広告素材/配信スケジュールを登録できる
- approved済みCreativeだけがプレイヤーに配信される
- left/center/right/wideの4枠に広告を表示できる
- プレイヤーが再生ログを記録し、クラウドへ同期できる
- 広告主別/キャンペーン別/日別の簡易レポートを見られる
- CSVを出力できる
- QRクリックを記録できる
- 通信断時も再生ログが失われない

## Codex向けプロンプト

```text
Implement Media Ad Delivery MVP for Misell.

Read docs/67_MISELL_STUDIO_NOVISIGN_BENCHMARK_SPEC.md and docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md first.

Goal:
Build the Phase 1 Media advertising feature set: advertisers, campaigns, creatives, ad schedules, player ad schedule delivery, ad play event ingestion, QR redirect tracking, and basic reports/CSV.

Constraints:
- Do not implement external ad network integrations.
- Do not implement bidding, CPM billing, or AI optimization.
- Only support placement_key: left, center, right, wide.
- Only approved creatives can be delivered to players.
- Player logs must be idempotent by device_id + playback_id.
- Offline player logs must be preserved and synced later.

Implementation order:
1. DB migrations for advertisers, ad_campaigns, ad_creatives, ad_placements, ad_schedules, ad_play_events, qr_events.
2. Admin CRUD APIs.
3. Player APIs.
4. QR redirect API.
5. Basic admin UI pages.
6. Player integration.
7. Reports and CSV export.
8. Tests/QA checklist.
```

## 更新日

2026-06-15
