# 43. 端末群管理・監視設計

## 目的

ミセルを1台MVPから複数台商用運用へ進めるため、端末ID、店舗ID、設置場所ID、死活監視、通知、ログ、遠隔操作の設計を定義する。

## 基本方針

- 端末はクラウドから直接操作されるのではなく、原則として端末側からクラウドへpullする
- 店舗LAN側にポート開放を求めない
- 端末はネット切断時もローカルキャッシュで再生継続する
- 端末の状態、放映ログ、エラーログはクラウドへ送信する
- 遠隔保守はTailscale/SSH/RustDeskを使うが、運用ルールを明確化する

## ID設計

### tenant_id

顧客企業単位。

例：

- TEN-0001

### store_id

店舗/施設単位。

例：

- STO-0001
- STO-0002

### location_id

施設内の設置場所単位。

例：

- LOC-FRONT-001
- LOC-ELEVATOR-001
- LOC-LOBBY-001
- LOC-STORE-001

### device_id

端末単位。

例：

- DEV-000001

端末初回登録時に発行し、端末内のconfig.jsonに保存する。

### screen_group_id

複数画面を1つの表示単位として扱うID。

例：

- SG-000001

3連1セットに対して1つ発行する。

### campaign_id

広告キャンペーン単位。

例：

- CMP-2026-0001

### asset_id

素材単位。

例：

- AST-2026-000001

## 端末config.json

端末内に以下を保存する。

- device_id
- tenant_id
- store_id
- location_id
- screen_group_id
- api_base_url
- device_token
- playlist_version
- cache_path
- log_path
- environment

## 端末登録フロー

1. 管理画面で店舗を作成
2. 設置場所を作成
3. 端末を発行
4. device_idとdevice_tokenを発行
5. 端末にconfig.jsonを配置
6. 端末が初回heartbeatを送信
7. 管理画面でonline確認

## Heartbeat仕様

端末は定期的にクラウドへ状態を送信する。

### 送信間隔

- MVP/PoC：60秒ごと
- 商用標準：60秒ごと
- 大量展開時：60〜300秒で調整

### 送信項目

- device_id
- timestamp
- app_version
- playlist_version
- current_item_id
- uptime
- disk_free
- memory_usage
- cpu_load
- temperature_optional
- network_status
- display_status_optional
- last_error

## 異常判定

### warning

- heartbeatが3分以上届かない
- disk_freeが10GB未満
- memory使用率が85%以上
- エラーが連続3回

### critical

- heartbeatが10分以上届かない
- playlist同期失敗が連続5回
- playerプロセス停止
- 端末再起動ループ
- disk_freeが2GB未満

## 通知先

### 初期

- 管理者メール
- SlackまたはDiscord

### 商用

- 運用担当
- 施工/保守担当
- 顧客通知はcritical時のみ

## 通知内容

- device_id
- 店舗名
- 設置場所
- 状態
- 発生時刻
- 最終heartbeat
- 推奨対応

## 遠隔操作

### 通常操作

管理画面から可能にする操作：

- playlist再同期要求
- プレイヤー再読み込み要求
- 端末再起動要求
- ログアップロード要求
- スクリーンショット取得要求（後続）

### 実装方針

端末がクラウドへpollし、pending_commandsを取得して実行する。

クラウドから端末に直接SSHしない。

## Tailscale/SSH/RustDesk運用

### Tailscale

- 端末は専用tailnetに参加
- ACLで管理者のみSSH可能
- 顧客にはTailscale権限を渡さない
- 端末名はdevice_id + 店舗名で管理

### SSH

- パスワードログイン禁止
- 鍵認証のみ
- rootログイン禁止
- sudo権限は限定

### RustDesk

- 画面確認と現地表示確認に限定
- 常時開放ではなく、必要時のみ利用
- 接続履歴を残す

## ログローテーション

端末内ログは肥大化させない。

### 対象ログ

- player.log
- sync.log
- error.log
- playlog.jsonl
- heartbeat.log

### 方針

- 日次ローテーション
- 端末内保存は30日
- クラウド送信済みログは圧縮または削除
- criticalエラーはクラウドへ即時送信

## バックアップ/復元

### バックアップ対象

- config.json
- 最新playlist
- assets manifest
- 端末設定
- xrandr設定
- systemd設定

### 復元手順

1. Ubuntu再セットアップ
2. misell-playerをclone
3. config.json配置
4. npm install
5. assets再同期
6. systemd設定
7. heartbeat確認

## 端末退役/交換

### 退役時

- 管理画面でdevice statusをretiredにする
- device_tokenを無効化
- 端末内データを削除
- Tailscaleから削除
- RustDesk登録削除

### 盗難/紛失時

- device_token即時無効化
- Tailscaleから削除
- 管理画面でlostに変更
- 顧客へ通知
- 必要に応じて警察/保険対応

## SLA目標

### MVP/PoC

- ベストエフォート
- 平日営業時間内対応

### Standard

- critical初動：24時間以内
- 月間稼働率目標：99%以上

### Media/AI Edge

- critical初動：12時間以内
- 月間稼働率目標：99.5%以上

## 買収評価に効く点

端末群管理が設計されていると、買い手は多店舗展開の再現性を評価しやすい。

特に重要：

- device_id/store_id設計
- heartbeat
- 異常通知
- ログ管理
- remote command
- 退役/紛失対応
- SLA定義
