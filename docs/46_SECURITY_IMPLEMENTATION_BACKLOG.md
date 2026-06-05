# 46. セキュリティ実装バックログ

## 目的

ネットワーク・セキュリティ設計を実装タスクへ落とし込む。

## Epic 1: 端末ID/認証

### Issue: device_id/store_id/location_id採番実装

- tenant_id
- store_id
- location_id
- device_id
- screen_group_id
- config.json保存

### Issue: device_token認証

- MVP実装済み: 端末ごとのdevice_token発行
- MVP実装済み: APIリクエストにtoken付与
- MVP実装済み: token無効化/再発行
- MVP実装済み: 退役/紛失時のrevoke

## Epic 2: Heartbeat/監視

### Issue: heartbeat送信

- 60秒ごとに状態送信
- uptime
- disk_free
- memory
- playlist_version
- current_item

### Issue: 異常判定

- 3分未接続 warning
- 10分未接続 critical
- disk不足
- sync失敗
- player停止

### Issue: 通知

- Slack/Discord通知
- email通知
- 通知テンプレート
- 通知抑制

## Epic 3: ログ管理

### Issue: playlog保存

- timestamp
- device_id
- playlist_item_id
- campaign_id
- asset_id
- result

### Issue: ログローテーション

- 日次ローテーション
- 30日保存
- 送信済み削除
- エラー即時送信

### Issue: クラウドログ送信

- 未送信ログキュー
- 再送
- 重複防止

## Epic 4: ネットワーク/Firewall

### Issue: ufw設定

- deny incoming
- allow outgoing
- SSHはTailscale IPのみ
- MVP admin portはLAN限定

### Issue: SSH hardening

- root login禁止
- password login禁止
- 鍵認証
- sudo権限管理

### Issue: Tailscale ACL

- 管理者のみ接続
- 端末命名規則
- 退役時削除

## Epic 5: Admin認証

### Issue: MVP admin basic auth

- 初期ID/PW
- .env保存
- ログイン失敗ログ

### Issue: 商用クラウド認証

- Admin
- Operator
- Client Viewer
- Advertiser
- 権限ごとのアクセス制御

## Epic 6: 素材アップロード防御

### Issue: ファイル検証

- 拡張子チェック
- MIMEチェック
- サイズ上限
- ランダムファイル名
- 実行権限なし

### Issue: path traversal対策

- 保存先固定
- ../拒否
- unsafe filename拒否

### Issue: HTML/URL制限

- HTMLアップロード禁止
- 外部URLはAdminのみ
- iframe/script制限

## Epic 7: OS/アプリ更新

### Issue: OS更新方針

- MVPは手動更新
- 商用はメンテ枠更新
- 更新後再起動テスト

### Issue: アプリリリース管理

- version.json
- rollback
- staging端末
- 先行1台適用

## Epic 8: バックアップ/復元

### Issue: 端末バックアップ

- config.json
- playlist
- assets manifest
- xrandr設定
- systemd設定

### Issue: 復元手順スクリプト

- clone
- npm install
- config配置
- assets同期
- service有効化

## Epic 9: 紛失/退役

### Issue: 退役フロー

- device status retired
- token revoke
- Tailscale削除
- RustDesk削除
- local data wipe

### Issue: 紛失/盗難フロー

- device status lost
- token revoke
- Tailscale削除
- 顧客通知
- 交換手順

## Epic 10: SLA/障害対応

### Issue: 障害分類

- warning
- critical
- customer-impacting

### Issue: 一次対応フロー

- remote確認
- restart
- power cycle
- onsite判断

### Issue: SLA表示

- PoC
- Standard
- Media
- AI Edge

## 優先順位

### MVP前

- admin basic auth
- ファイル検証
- ufw最低設定
- SSH hardening
- ログローテーション

### テスト導入前

- device_id
- heartbeat
- playlog
- Tailscale ACL
- バックアップ/復元

### 商用前

- クラウド認証
- role-based access
- 通知
- token revoke運用手順の現地検証
- SLA
- 退役/紛失フロー
