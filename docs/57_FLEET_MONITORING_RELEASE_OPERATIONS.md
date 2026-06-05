# 57. 複数端末の監視・バージョン管理・更新運用設計

## 目的

Misellを複数店舗・複数端末へ展開するときに、端末停止、更新失敗、バージョン混在、ログ未回収、現地対応遅れを防ぐための監視・リリース・ロールバック運用を定義する。

この文書は `docs/43_DEVICE_FLEET_MANAGEMENT_SPEC.md` と `docs/44_NETWORK_SECURITY_SPEC.md` を、実運用の手順に落とすための補足である。

## 基本方針

- 端末はクラウドから直接開けず、端末側からpullする
- 店舗LANへ不要な inbound を要求しない
- 端末はネット切断時も最後の正常playlistと素材で再生を継続する
- アプリ、playlist、端末設定は別々にバージョン管理する
- 更新は staging から canary、stable へ段階展開する
- 失敗時は前バージョンへ戻せる状態で更新する
- Tailscale/SSH は保守用であり、通常配信や監視の主経路にしない

## 現フェーズの位置づけ

### MVP / 1〜2台

- LAN内 `/admin`
- Tailscale/SSH による保守
- `systemd --user` で `misell-player.service` 自動起動
- `/api/health` と `/api/status` による簡易死活確認
- `collect-device-evidence.sh` による現地証跡
- 更新は作業者が手動、またはCloud更新予約を端末がpullして実施

### テスト導入 / 3〜10台

- 端末台帳を必須化
- 監視チェックを日次で実行
- heartbeat送信を有効化
- Cloud更新予約と `misell-update.timer` をstaging/canary端末で有効化
- Slack/Discord/メール通知を導入
- アプリ更新手順を固定化
- staging端末とcanary端末を分ける

### 商用 / 10台以上

- Remote CMSで端末状態を集約
- device_token認証を必須化
- heartbeat、playlog、error logをクラウド回収
- リリースmanifestを端末がpull
- 自動rollbackを実装
- 端末退役、紛失、交換を管理画面から処理する

## 端末台帳

複数端末運用では、最低限以下を台帳化する。

| 項目 | 例 | 用途 |
|---|---|---|
| tenant_id | TEN-0001 | 顧客企業 |
| store_id | STO-0001 | 店舗/施設 |
| location_id | LOC-LOBBY-001 | 設置場所 |
| screen_group_id | SG-000001 | 3画面1セット |
| device_id | DEV-000001 | 端末単位 |
| device_name | DEV-000001-balian-shinjuku | SSH/Tailscale識別 |
| app_version | 0.1.0 | アプリバージョン |
| playlist_version | local-001 | 配信内容 |
| config_version | cfg-001 | 端末設定 |
| release_channel | staging/canary/stable | 更新対象 |
| tailscale_ip | 100.x.x.x | 保守接続 |
| lan_ip | 192.168.x.x | 現地確認 |
| status | online/degraded/offline | 稼働状態 |
| installed_at | 2026-06-05 | 設置日 |
| last_seen | ISO8601 | 最終heartbeat |

## 監視レイヤー

### Layer 1: ローカル自己復旧

端末内で完結する監視。

- `misell-player.service` は `Restart=always`
- `misell-kiosk.service` はGUIセッションで再起動
- `/api/health` をローカルで確認
- burn-in中は `burn-in-check.sh` でCPU、メモリ、ディスク、温度を記録

### Layer 2: 運用者による簡易監視

MVPからテスト導入までの監視。

- Tailscale IPへ `GET /api/health`
- Tailscale SSHで `systemctl --user is-active misell-player.service`
- `journalctl --user -u misell-player.service`
- `logs/error.log` の確認

### Layer 3: クラウドheartbeat

商用運用で必須の監視。

端末が60秒ごとに以下を送信する。

```json
{
  "device_id": "DEV-000001",
  "tenant_id": "TEN-0001",
  "store_id": "STO-0001",
  "location_id": "LOC-LOBBY-001",
  "screen_group_id": "SG-000001",
  "timestamp": "2026-06-05T10:00:00+09:00",
  "app_version": "0.1.0",
  "release_id": "rel-20260605-001",
  "playlist_version": "pl-20260605-001",
  "config_version": "cfg-20260605-001",
  "uptime_seconds": 3600,
  "service_state": "active",
  "kiosk_state": "active",
  "current_item_id": "ITEM-001",
  "disk_free_mb": 58000,
  "memory_used_percent": 42,
  "cpu_load_1m": 0.22,
  "temperature_c": 55,
  "network_status": "online",
  "display_status": "unknown",
  "last_error": null
}
```

## 状態モデル

| 状態 | 判定 | 対応 |
|---|---|---|
| online | heartbeat正常、再生中 | 対応なし |
| degraded | エラーあり、再生継続 | ログ確認 |
| offline | heartbeat 3分以上なし | warning通知 |
| critical | heartbeat 10分以上なし、player停止、disk 2GB未満 | 即時対応 |
| maintenance | 作業者がメンテ中に設定 | 通知抑制 |
| retired | 退役済み | token無効 |
| lost | 紛失/盗難 | token/Tailscale即時削除 |

## 端末トークン運用

device_tokenは端末APIの認証情報であり、Cloud DBには平文保存しない。端末登録時または再発行時だけ表示し、端末側の `MISELL_DEVICE_TOKEN` に反映する。

### 失効するケース

- 端末紛失または盗難
- 端末交換、廃棄、退役
- tokenが外部に漏れた可能性がある
- 管理外の端末から通信が来ている疑いがある

### 再発行するケース

- 定期交換
- 端末セットアップ時にtokenを誤って記録した
- 端末を交換せず、同じ `device_id` で運用継続する
- 失効後に同一端末を復帰させる

### 操作手順

1. Cloud管理画面で対象端末のtokenを失効または再発行する
2. 再発行時は表示された新tokenを端末envの `MISELL_DEVICE_TOKEN` へ反映する
3. 端末で `systemctl --user restart misell-heartbeat.timer misell-player.service` を実行する
4. Cloudでheartbeatが復帰し、`token_last_used_at` が更新されることを確認する

退役または紛失に設定した端末はtokenも失効扱いにする。再利用する場合は、端末状態を戻すだけではなくtokenを再発行してから端末envを更新する。

## アラート基準

### warning

- heartbeat 3分以上未着
- disk_free 10GB未満
- memory使用率 85%以上
- `error.log` が10分内に3件以上増加
- playlist同期失敗 3回連続

### critical

- heartbeat 10分以上未着
- `misell-player.service` 停止
- 端末再起動ループ
- disk_free 2GB未満
- update後のhealth check失敗
- kioskが起動しない

## ログ運用

### 端末内ログ

- `logs/playlog.jsonl`
- `logs/admin.log`
- `logs/error.log`
- `logs/burn-in.log`
- `journalctl --user -u misell-player.service`
- `journalctl --user -u misell-kiosk.service`

### 保存期間

- MVP: 手動回収、必要に応じて保存
- テスト導入: 端末内30日
- 商用: クラウド送信済みは30日で圧縮または削除

### ログの責務

- playlog: 放映実績、広告レポート、検収証跡
- admin.log: 誰が何を変更したか
- error.log: 障害調査
- heartbeat: 稼働監視

## バージョン管理

アプリ、playlist、端末設定を混ぜて管理しない。

### app_version

`apps/player/package.json` の `version`。

例:

- `0.1.0`
- `0.2.0`
- `1.0.0`

### release_id

配布単位。

例:

- `rel-20260605-001`

含める情報:

- git_sha
- app_version
- build_time
- node_major
- package_lock_hash
- release_channel
- checksum

### playlist_version

表示内容の配信単位。

例:

- `pl-20260605-store001-001`

### config_version

端末設定の配信単位。

例:

- `cfg-20260605-dev000001-001`

## release_channel

| channel | 対象 | 用途 |
|---|---|---|
| dev | 開発端末 | 開発確認 |
| staging | 社内検証端末 | リリース候補確認 |
| canary | 本番1台 | 先行適用 |
| stable | 本番標準 | 通常配布 |
| hold | 更新停止 | 障害/特殊端末 |

## 更新方式

### MVP

1〜2台では手動更新、またはCloudから端末ごとのGit refを予約するMVP更新でよい。

ただし、必ず以下を実施する。

1. アプリcheckoutをcleanに保つ
2. 端末固有のplaylist、config、素材、ログは `~/.local/share/misell-player` へ分離する
3. 更新前に `npm run check`
4. 更新前に `npm run validate:playlist`
5. 更新前に `npm audit --audit-level=moderate`
6. 端末で現在の `app_version` と `playlist_version` を記録
7. アプリを更新
8. `npm install --omit=dev`
9. `systemctl --user restart misell-player.service`
10. `/api/health` が200を返すことを確認
11. `/player` が200を返すことを確認
12. 問題があれば前の配置へ戻す

Cloud更新予約を使う場合:

1. Cloud管理画面で端末ごとに `target_update_ref`、`target_release_id`、`target_release_channel` を予約する
2. 端末の `misell-update.timer` が `GET /api/device/update-policy` をpollする
3. 更新が必要な端末は `scripts/update-player.sh --apply --ref ...` を実行する
4. 端末は `POST /api/device/update-result` へ `updating`、`success`、`failed` を報告する
5. 失敗時は `update-player.sh` が前のGit refへ戻し、Cloudに `update_failed` アラートを出す

### 商用

Git pull直更新は禁止する。

推奨方式:

1. CIでrelease bundleを作成
2. release manifestを生成
3. staging端末がmanifestをpull
4. 別ディレクトリへ展開
5. `npm ci --omit=dev`
6. playlist/config互換性を検証
7. symlinkを新releaseへ切替
8. service restart
9. health check
10. canaryへ展開
11. stableへ段階展開

## rollback

更新は前バージョンに戻せる前提で実施する。

### rollback対象

- app release
- playlist
- config

### rollback条件

- update後5分以内に `/api/health` が200にならない
- playerがplaylistを読み込めない
- kiosk起動失敗
- error.logに同一エラーが連続
- canary端末でcriticalが発生

### rollback手順

1. 現releaseを停止
2. 前release symlinkへ戻す
3. `systemctl --user restart misell-player.service`
4. `/api/health` 確認
5. 必要ならplaylist_versionも前版へ戻す
6. incident logへ記録
7. stable展開を停止

## OS更新

### MVP

- 手動更新
- 更新後に再起動テスト
- kiosk/display再確認

### 商用

- セキュリティ更新は月次メンテナンス枠
- カーネル更新後は再起動必須
- staging端末で先行確認
- 本番は店舗営業時間外に適用
- 表示停止が許されない端末は更新windowを顧客と合意する

## 運用カレンダー

### 日次

- offline/critical端末確認
- `error.log` 増加確認
- ディスク残量確認

### 週次

- app_version分布確認
- playlist_version分布確認
- 未送信ログ確認
- Tailscale端末名/接続状態確認

### 月次

- OS更新
- 再起動復旧確認
- 端末台帳更新
- 退役/紛失端末確認
- リリース履歴レビュー

## 責任分界

### Misell Operator

- playlist公開
- 素材確認
- 顧客連絡
- 月次レポート

### Device Ops

- 端末監視
- app更新
- OS更新
- Tailscale/SSH管理
- 現地交換判断

### Developer

- release作成
- migration互換性確認
- rollback修正
- バグ調査

## 商用前の最低完了条件

- device_token認証
- heartbeat送信
- クラウド監視画面
- warning/critical通知
- ログローテーションまたはクラウド送信済みログ削除
- release manifest
- staging/canary/stable運用
- rollback手順
- 端末台帳
- 退役/紛失フロー

## 現在の不足

現行MVP実装で完了しているもの:

- local player
- device identity
- Basic auth
- upload validation
- local logs
- `/api/health`
- `/api/status`
- `/api/heartbeat`
- `device_token` の端末env保存
- heartbeat送信スクリプト
- ログローテーションスクリプト/timer
- MVP手動更新スクリプト
- Cloud更新予約API
- Cloud更新ポリシー取得API
- Cloud更新結果報告API
- 端末更新チェックscript/timer
- Webhookアラート通知
- 通知履歴管理
- release_channel/config_versionの端末env保存
- systemd user service
- Ubuntu security baseline script

未実装で、複数端末商用前に必要なもの:

- device_token失効/再発行
- クラウドログ回収
- release manifest
- bundle/symlink方式の商用rollback
- release channel単位の一括配信
- 通知ルーティングの顧客/店舗別分離
- Tailscale ACLの正式運用

## 次の実装候補

1. device_token再発行/失効を管理画面へ実装する
2. release manifest配布を実装する
3. release channel単位の一括配信を実装する
4. bundle/symlink方式の商用rollbackを実装する
5. 通知ルーティングを顧客/店舗単位で分離する

## MVP実装済みの運用補助

- `GET /api/status`: heartbeat payloadに近い端末状態を返す
- `GET /api/heartbeat`: `/api/status` と同じpayloadを返す
- `scripts/emit-heartbeat.sh`: payloadを表示、または `MISELL_HEARTBEAT_URL` へPOSTする
- `scripts/rotate-logs.sh`: ローカルログをサイズ条件でローテーションする
- `scripts/update-player.sh`: MVP向け手動更新、検証、restart、health checkをまとめる
- `scripts/check-update.sh`: Cloud更新予約をpollし、必要な場合に `update-player.sh` を実行する
- `misell-log-rotate.timer`: ログローテーション用systemd user timer
- `misell-heartbeat.timer`: heartbeat送信用systemd user timer。URL設定後に有効化する
- `misell-update.timer`: Cloud更新確認用systemd user timer。heartbeat疎通後に有効化する
