# 41. 遠隔管理・配信CMS仕様

## 目的

ミセルはMVPではLAN内管理画面から始めるが、事業化には遠隔で広告の入れ替え、動画配信設定、端末状態確認、月次レポート作成が必須である。

このドキュメントは、MVP後に実装するRemote CMSの軽量仕様を定義する。

## 現状整理

### MVP

- LAN内管理画面
- ローカルplaylist.json
- 端末内素材保存
- 手動アップロード
- ローカル再生

### 事業化に必要な状態

- クラウド管理画面から店舗/端末を管理
- 広告素材を遠隔アップロード
- 店舗別/端末別に配信スケジュール設定
- 端末がクラウドからplaylistを同期
- ネット切断時はローカルキャッシュで継続再生
- 放映ログ/QRログをクラウドへ送信
- 稼働状況を確認

## Store Commerce / QRの互換方針

Remote CMSではCloudを店舗設定、offer revision、QR link、counter order、device event idempotencyの正本にする。

- 締め時刻は店舗ごとの `business_day_start_time` を基準にした業務日タイムラインで判定する。日跨ぎ営業では、単純な同日 `HH:mm` 比較を使わない。
- counter-order QR linkは通常 `offers.current_offer_revision_id` をscan/order時に解決する。既存掲示QRをrevision切替で壊さない。
- 特定revisionへ固定したい場合のみ、管理側が `offer_revision_id` または `pin_offer_revision` を指定する。
- device playlogのsenderは安定した `event_id` を送る。rollout中の既存sender互換として、Cloudは `event_id` なしpayloadを受け付け、deterministicな `legacy-*` idを生成する。

## Remote CMSの基本機能

### 1. 店舗管理

項目：

- store_id
- 店舗名
- 業態
- 住所
- 担当者
- 営業時間
- 設置場所
- 契約プラン
- 月額料金

### 2. 端末管理

項目：

- device_id
- store_id
- 端末名
- OS
- 端末種別
- 最終接続日時
- 現在のplaylist version
- 稼働状態
- IP情報
- メモ

### 3. 素材管理

対応素材：

- mp4
- webm
- jpg
- png
- html url

項目：

- asset_id
- asset_type
- file_url
- thumbnail_url
- duration
- width
- height
- advertiser_id
- campaign_id
- status

### 4. 広告/キャンペーン管理

項目：

- campaign_id
- advertiser_id
- campaign_name
- start_date
- end_date
- target_store_ids
- target_time_slots
- priority
- qr_url
- status

### 5. プレイリスト管理

playlistは店舗別または端末別に作成する。

主要項目：

- playlist_id
- store_id
- device_id
- version
- items
- published_at
- status

item項目：

- layout
- left_asset_id
- center_asset_id
- right_asset_id
- wide_asset_id
- duration
- start_time
- end_time
- days_of_week
- campaign_id
- priority

### 6. 配信スケジュール

対応する設定：

- 日付指定
- 曜日指定
- 時間帯指定
- 優先度
- 緊急割り込み
- 空間ジャック
- 広告ローテーション

### 7. 端末同期

端末は定期的にクラウドへ問い合わせる。

同期内容：

- 最新playlist version確認
- 新規素材ダウンロード
- 古い素材削除
- 設定更新
- 表示ログ送信
- 死活送信

推奨方式：

- 端末からクラウドへpull
- クラウドから端末へ直接pushしない
- ネットワーク制約に強くする

### 8. ローカルキャッシュ

端末は、最後に正常同期したplaylistと素材を保持する。

通信断時：

- 最後のplaylistを再生
- ログは端末内に蓄積
- 復旧後にログ送信

### 9. 放映ログ

保存項目：

- timestamp
- store_id
- device_id
- playlist_id
- playlist_version
- item_id
- campaign_id
- asset_id
- layout
- duration
- result

### 10. 端末監視

管理画面で見たい項目：

- online/offline
- last_seen
- 現在再生中のplaylist
- エラー数
- ストレージ残量
- CPU/メモリ概要
- 温度取得できる場合は温度

### 11. 権限

初期は3種類でよい。

#### Admin

全店舗、全端末、全広告を管理。

#### Operator

素材更新、playlist編集、レポート確認。

#### Client Viewer

自店舗のレポートとプレビューのみ確認。

## MVPからRemote CMSへの段階移行

### Phase 1: Local only

- LAN管理画面
- ローカルplaylist

### Phase 2: Cloud playlist sync

- クラウドでplaylist作成
- 端末がpull同期
- 素材URLからダウンロード

### Phase 3: Device monitoring

- 死活監視
- ログ送信
- エラー通知

### Phase 4: Campaign management

- 広告主
- キャンペーン
- 掲載期間
- ターゲット店舗

### Phase 5: Reporting

- 店舗向け月次レポート
- 広告主向け月次レポート

### Phase 6: Multi-tenant

- 代理店
- 複数顧客
- 権限分離

## 技術構成案

### Option A: シンプル構成

- Backend: Node.js / Fastify or Express
- DB: PostgreSQL
- Storage: S3互換ストレージ
- Auth: Supabase Auth or Auth.js
- Frontend: Nuxt / Next / React
- Device API: REST

### Option B: Supabase活用

- Supabase Auth
- Supabase Postgres
- Supabase Storage
- Edge Functions
- PlayerはRESTで同期

初期はOption Bが速い。

## 端末API案

### GET /api/device/config

端末設定取得。

### GET /api/device/playlist

最新playlist取得。

### POST /api/device/heartbeat

死活送信。

### POST /api/device/playlog

放映ログ送信。

`event_id` 付き送信を標準とする。既存sender互換のため、`event_id` がないpayloadもCloud側で `legacy-*` idを生成して受け付ける。同じ `(tenant_id, device_id, event_id)` は冪等に扱う。

### POST /api/device/error

エラーログ送信。

## 管理画面メニュー

- Dashboard
- Stores
- Devices
- Assets
- Campaigns
- Playlists
- Reports
- Settings

## 最初に実装するRemote CMS機能

事業化初期は以下で十分。

1. 店舗登録
2. 端末登録
3. 素材アップロード
4. playlist作成
5. 端末pull同期
6. 死活確認
7. 放映ログ保存

## 注意

最初から巨大CMSを作らない。

まずはMVP端末でローカルプレイヤーを完成させ、その後にクラウド同期を足す。

Remote CMSは、店舗数が3〜10件になったタイミングで本格化する。
