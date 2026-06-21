# 84. 端末遠隔運用・再起動・保守経路 決定仕様

## 位置づけ

決定日: 2026-06-18

この文書は、Misell端末を店舗LAN、施設LAN、ゲストLAN、LTE/5G回線配下で運用するための遠隔管理方式を決定事項として固定する。

関連文書:

- `docs/44_NETWORK_SECURITY_SPEC.md`
- `docs/57_FLEET_MONITORING_RELEASE_OPERATIONS.md`
- `docs/58_CLOUD_MONITORING_MVP_SPEC.md`
- `docs/67_MASTER_CONTROL_AND_CONTENT_DELIVERY_DESIGN.md`

## 決定事項

Misell端末の遠隔管理は、次の4層で設計する。

```text
1. Cloud command queue
   通常運用。reload、restart、reboot、log回収、再同期をCloudから指示する。

2. Tailscale SSH
   通常保守。端末へ直接入って調査、修復する。

3. On-demand reverse SSH
   Tailscaleが使えない時の保険。端末からbastionへ一時トンネルを張る。

4. 現地復旧
   USB、キーボード、再登録、端末交換で復旧する。
```

端末のSSHポートをインターネットへ常時公開してはならない。

## Security gate

この仕様は、端末へのremote command実行、Tailscale SSH、on-demand reverse SSH bastion、device token認証を扱うため、実行系の実装着手前にsecurity gateを必須とする。

必要なgate:

```text
needs:cto-security
route:ceo-approval
```

2026-06-21時点で、`main` には将来用の `device_commands` table定義だけが入っている。Cloud Admin API、Device API、端末runner、管理画面操作ボタン、実行系の有効化はまだ入っていない。

gate通過前に実装・有効化してはならないもの:

- `device_commands` を操作するAdmin API / Device API
- 端末側のcommand poll / claim / execution runner
- 管理画面からの `restart_player`, `restart_kiosk`, `restart_device`
- 管理画面からの `open_maintenance_tunnel`
- bastion VPS / reverse SSH の本番運用
- Tailscale ACL / auth key の商用標準化

docs mergeは可能だが、実装Issueはこのgateを通過してから着手する。

### Gate通過条件

実装Issueへ入る前に、少なくとも次をGitHub上の承認コメントまたはlabel更新で確認する。

- `needs:cto-security` が解消されている。
- `route:ceo-approval` が解消されている。
- 初回実装で許可する `command_type` が固定されている。
- 初回実装で許可しないcommandが明記されている。
- command発行RBACが承認されている。
- `params_json` をshell展開しない方針が承認されている。
- device token revoke時にcommand fetch / claim / resultを拒否する方針が承認されている。
- audit logに残すeventが承認されている。
- feature flagまたは設定でcommand runnerを無効化できる方針が承認されている。

## 原則

- Cloudを管理の正本にする。
- 端末はCloudのpull型クライアントにする。
- 店舗LANへ固定IP、ポート開放、VPN管理権限を要求しない。
- 端末はネット断でも最後の正常playlistと素材で再生を継続する。
- Tailscaleは通常配信の主経路ではなく、保守用のbreak-glass経路にする。
- Tailscaleがログアウト、期限切れ、ACL不備で使えない場合でも、表示とCloud配信は止めない。
- 端末の再起動、kiosk再起動、log回収はCloud command queueで実行できるようにする。
- reverse SSHは常時接続ではなく、Cloud commandで開始しTTLで自動終了する。

## 標準ネットワーク構成

```text
Operator browser
  HTTPS
  Cloud Admin
    devices
    content manifests
    release manifests
    device commands
    logs
    reports

Store / facility LAN
  Ubuntu terminal
    Chromium kiosk -> http://localhost:3000/player
    local playlist/assets cache
    outbound HTTPS to Cloud
    outbound Tailscale for maintenance
    outbound SSH to bastion only when commanded
```

端末がCloudへ送る通信:

- `POST /api/device/heartbeat`
- `GET /api/device/content-policy`
- `POST /api/device/content-result`
- `POST /api/device/asset-result`
- `GET /api/device/update-policy`
- `POST /api/device/update-result`
- `POST /api/device/playlog`
- `POST /api/device/error`
- `POST /api/device/logs`
- `GET /api/device/commands`
- `POST /api/device/command-result`

端末側で標準設定するCloud URL:

```env
MISELL_HEARTBEAT_URL=https://misell.iyasaka.co/cloud/api/device/heartbeat
MISELL_DEVICE_TOKEN=<device specific token>
```

`MISELL_HEARTBEAT_URL` から、content、update、logs、commands系URLを導出できるようにする。

## 管理画面からの再起動

管理画面から端末を操作する場合、CloudからSSHで直接実行してはならない。Cloudはcommandを作成し、端末がpollして実行する。

### command種別

MVPで許可するcommand:

| command | 目的 | 実行例 | 初期実装 |
| --- | --- | --- | --- |
| `reload_player_content` | playerへplaylist再読込だけ指示する | `POST http://localhost:${PORT}/api/internal/reload` | 必須 |
| `restart_player` | Node player serviceを再起動する | `systemctl --user restart misell-player.service` | 必須 |
| `restart_kiosk` | Chromium kioskを再起動する | `systemctl --user restart misell-kiosk.service` | 必須 |
| `collect_logs` | 証跡bundleをCloudへ送る | `scripts/collect-device-evidence.sh --upload` | 必須 |
| `sync_content_now` | content-policyを即時取得して反映する | `scripts/sync-content.sh` | 必須 |

後続で許可するcommand:

| command | 目的 | 制約 |
| --- | --- | --- |
| `restart_device` | OS再起動 | 二段階確認、営業時間外、TTL必須 |
| `open_maintenance_tunnel` | reverse SSHトンネルを開始 | TTL、鍵認証、audit必須 |
| `close_maintenance_tunnel` | reverse SSHトンネルを停止 | 常時接続を禁止 |

### command状態

```text
queued
claimed
running
succeeded
failed
expired
cancelled
```

端末はcommandをclaimしてから実行する。Cloudは同じcommandを二重実行しない。

### command制約

- commandは `device_token` で認証された端末だけが取得できる。
- commandは `device_id`、`tenant_id`、`store_id` のscopeを必ず持つ。
- commandには `expires_at` を必ず持たせる。
- `restart_device` と `open_maintenance_tunnel` は短いTTLを必須にする。
- command実行は `command_type` のallowlistだけを固定コマンドへmapする。
- `params_json` をshell文字列へ展開してはならない。
- `params_json` は構造化データとしてschema validationし、reason、TTL、labelなどの許可fieldだけを読む。
- device側runnerは任意command、任意script path、任意argumentを受け取って実行してはならない。
- command実行結果はstdout/stderrの全文ではなく、要約、exit code、開始/終了時刻を送る。
- command作成、claim、完了、失敗、取消はaudit logに残す。

### command発行RBAC

Cloud Admin側では、commandの発行権限をroleごとに分ける。

| command | `misell_owner` | `misell_operator` | `device_ops` | `store_admin` | 備考 |
| --- | --- | --- | --- | --- | --- |
| `reload_player_content` | 可 | 可 | 可 | 不可 | 通常運用 |
| `restart_player` | 可 | 可 | 可 | 不可 | 通常運用 |
| `restart_kiosk` | 可 | 可 | 可 | 不可 | 通常運用 |
| `collect_logs` | 可 | 可 | 可 | 不可 | 証跡回収 |
| `sync_content_now` | 可 | 可 | 可 | 不可 | 配信再同期 |
| `restart_device` | 可 | 条件付き | 条件付き | 不可 | 二段階確認、営業時間外、reason必須 |
| `open_maintenance_tunnel` | 可 | 不可 | 条件付き | 不可 | CTO/security gate後、reason必須、TTL必須 |
| `close_maintenance_tunnel` | 可 | 可 | 可 | 不可 | 開いているtunnelの停止 |

`restart_device` と `open_maintenance_tunnel` は、通常commandより強い制約を持つ。

- `requested_reason` を必須にする。
- `expires_at` を短くする。
- 作成者と承認者を分ける二者承認を後続で導入する。
- 営業時間内の実行は原則禁止し、緊急時だけoverride reasonを残す。
- 実行前後にheartbeatとcommand resultを確認する。

### device_token lifecycle

`device_token` が漏洩すると、攻撃者が端末になりすましてcommandを取得できる可能性がある。したがって、token lifecycleをcommand実装の前提にする。

必須:

- Cloud DBにはtoken平文を保存せず、pepper付きhashだけを保存する。
- tokenは端末登録時またはrotate時だけ一度表示する。
- tokenには `active`, `rotating`, `revoked` の状態を持たせる。
- token使用時刻、使用元IP、user agent相当のclient情報を記録する。
- token revoke後はheartbeat、content-policy、command取得、log uploadをすべて拒否する。
- 端末紛失、退役、盗難、漏洩疑いでは即時revokeする。
- token rotate後は旧tokenの猶予期間を短くし、二重稼働を検知したらalertを開く。

漏洩疑い時の対応:

```text
1. 対象deviceをmaintenanceまたはlostへ変更する
2. device_tokenをrevokeする
3. 未完了commandをcancelする
4. Tailscale machineを確認し、必要なら削除する
5. 新tokenを発行し、現地または保守経路で端末envを更新する
6. heartbeat復帰とtoken_last_used_atを確認する
7. audit logとincident noteを残す
```

## device_commands API

### GET /api/device/commands

端末が未処理commandを取得する。Bearer device token必須。

返却例:

```json
{
  "ok": true,
  "device_id": "DEV-000001",
  "commands": [
    {
      "command_id": "CMD-20260618-000001",
      "command_type": "restart_player",
      "status": "queued",
      "requested_at": "2026-06-18T07:00:00Z",
      "expires_at": "2026-06-18T07:10:00Z",
      "params": {
        "reason": "player health check failed"
      }
    }
  ]
}
```

### POST /api/device/commands/:command_id/claim

端末がcommand実行権を取得する。Cloudはclaim済みcommandを他の応答に含めない。

### POST /api/device/command-result

端末がcommand結果を報告する。

```json
{
  "command_id": "CMD-20260618-000001",
  "status": "succeeded",
  "started_at": "2026-06-18T07:01:00Z",
  "completed_at": "2026-06-18T07:01:06Z",
  "exit_code": 0,
  "message": "misell-player.service restarted"
}
```

## 推奨DB

```sql
CREATE TABLE device_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  status TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  requested_reason TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  claimed_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  exit_code INTEGER,
  result_message TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_device_commands_device_status
  ON device_commands(device_id, status, expires_at);
```

## Tailscale運用

Tailscaleは保守用の標準経路として使う。ただし、Tailscaleの可用性をMisell本体の可用性条件にしてはならない。

### 端末登録

- 端末は人間ユーザーではなく `tag:misell-device` のtagged deviceとして登録する。
- auth keyはtag付き、pre-approved、必要に応じてreusableで発行する。
- 端末を個人ユーザー所有のdeviceとして登録しない。
- key expiryは無効化する。
- 退役時はMisell Cloudのdevice状態変更とTailscale machine削除を両方実施する。

推奨tag:

```text
tag:misell-device
tag:misell-cloud
tag:misell-operator
```

### ACL方針

- Operatorから `tag:misell-device` のSSHを許可する。
- 端末同士の横方向通信は原則禁止する。
- Cloudから端末へ直接接続する権限は通常付与しない。
- 顧客ユーザーに端末Tailscale権限を渡さない。
- SSHは鍵認証のみ。password loginとroot loginは禁止する。

### Tailscaleログアウト時の扱い

Tailscaleがログアウト、期限切れ、または接続不能になっても、以下は継続しなければならない。

- ローカル再生
- heartbeat
- content-policy polling
- asset sync
- playlog/error/log upload
- Cloud command queue

Tailscale不通は `maintenance_connectivity_degraded` として扱い、表示停止とは分ける。

## On-demand reverse SSH

Tailscaleが使えない時の保険として、on-demand reverse SSHを採用する。端末のSSHポートを外部公開する方式は採用しない。

### 接続方式

```text
Cloud Admin
  open_maintenance_tunnel commandを作成

端末
  commandをpoll
  bastionへ outbound SSH
  ssh -R 127.0.0.1:<allocated_port>:localhost:22 bastion

Operator
  bastion上の一時port経由で端末へSSH

端末
  TTL後に自動切断
```

### bastion要件

- `misell.iyasaka.co` とは論理的に分けてもよいが、初期は同VPSに専用ユーザーを作って開始できる。
- 端末用SSHユーザーはshell権限を最小化する。
- `GatewayPorts no` を維持し、remote bindは `127.0.0.1` のみにする。
- `AllowTcpForwarding remote` を必要ユーザーだけに限定する。
- `PermitOpen localhost:22` 相当の制限をかける。
- tunnel開始、終了、接続port、operator、reasonをaudit logに残す。

### reverse SSH制約

- 常時接続は禁止する。
- TTLは初期値30分、最大120分にする。
- Cloud Adminから明示開始された時だけ開く。
- command期限切れ時は開始しない。
- Tailscaleが復旧している場合はTailscaleを優先する。
- password login、root loginは禁止する。
- 端末側秘密鍵は専用鍵とし、他用途に使わない。

## 現地復旧

Cloud command、Tailscale、reverse SSHの全てが使えない場合に備えて、現地復旧手順を持つ。

最低限の現地復旧手段:

- HDMI/USB-Cキーボード接続
- USB復旧メディア
- 端末env再設定手順
- device token再発行手順
- Tailscale再登録手順
- player再起動手順
- 端末交換手順

現地復旧を実施した場合も、復旧後にCloudへlog bundleを送信し、作業内容をaudit logへ残す。

## 実装順序

実装は以下のIssueへ分割する。

```text
1. device_commands API / DB / Admin UI
2. device command runner
3. local_state.sqlite
4. asset hash verification / quarantine
5. Cloud backup job
6. on-demand reverse SSH bastion
```

### Phase 1

- `device_commands` table
- Admin APIでcommand作成/取消
- Device APIでcommand取得/claim/result
- 端末script `run-device-command.sh`
- `reload_player_content`
- `restart_player`
- `restart_kiosk`
- `collect_logs`
- `sync_content_now`
- Cloud Adminの端末詳細に操作ボタン追加

### Phase 2

- `restart_device`
- 二段階確認
- 営業時間外制御
- command履歴UI
- command失敗alert

### Phase 3

- `open_maintenance_tunnel`
- `close_maintenance_tunnel`
- bastion専用ユーザー
- tunnel TTL
- tunnel audit
- Tailscale不通時の保守手順

## 受け入れ条件

Phase 1完了条件:

- 管理画面から `restart_player` を発行できる。
- 端末がcommandをpollし、二重実行せずclaimできる。
- player service再起動後もheartbeatが復帰する。
- command結果がCloudで確認できる。
- `collect_logs` がCloud log bundleへ残る。
- command作成、実行、失敗、取消がaudit logへ残る。
- Tailscaleが不通でもCloud commandが実行できる。

Phase 3完了条件:

- Tailscaleを切った状態で、Cloud commandからreverse SSH tunnelを開始できる。
- tunnelはTTL後に自動終了する。
- bastionの一時portは外部公開されない。
- operatorはbastion経由で端末へ鍵認証SSHできる。
- tunnel開始理由、開始者、対象端末、port、開始/終了時刻がCloudに残る。

## 禁止事項

- 店舗ルーターで端末22番をインターネット公開する。
- 端末にグローバルIPを割り当て、常時SSH待受する。
- SSH password loginを許可する。
- root SSHを許可する。
- reverse SSHを常時接続にする。
- Tailscaleを通常配信、素材配布、レポート回収の主経路にする。
- Tailscale不通を表示停止と同じ重大度で扱う。
- command結果に秘密情報、token、環境変数全文を含める。

## 決定の理由

この方針により、店舗LANに固定IPやポート開放を求めずに、通常運用、再起動、ログ回収、障害対応をCloud中心で実行できる。

Tailscaleは便利だが、ログアウト、key expiry、ACL、daemon停止、state破損で使えない場合がある。Misell本体はTailscaleに依存せず、Tailscaleは保守の標準経路、reverse SSHは保険、現地復旧は最後の保険として分離する。
