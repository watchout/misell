# 80. Cloud/Local 正本・バックアップ・ロールバック 決定仕様

## 位置づけ

決定日: 2026-06-18

この文書は、MisellのCloud管理基盤と端末ローカル実行環境の責任分界、端末SQLite、未送信データのbackfill、Cloud側定期バックアップ、破損時のロールバック方針を決定事項として固定する。

関連文書:

- `docs/47_ARCHITECTURE_BOUNDARIES_AND_MVP_GATES.md`
- `docs/58_CLOUD_MONITORING_MVP_SPEC.md`
- `docs/67_MASTER_CONTROL_AND_CONTENT_DELIVERY_DESIGN.md`
- `docs/81_DEVICE_REMOTE_OPERATIONS_AND_RECOVERY_SPEC.md`

## 決定事項

Misellのデータ責任は次の原則で固定する。

```text
Cloud DB = 正本
Cloud asset storage = 素材正本
Local SQLite = 端末が動き続けるための状態管理DB
Local files = 実際に再生するplaylist / asset cache
Local queue = Cloudへ未送信の一時正本
```

端末はCloud DBへ直接接続しない。端末はCloud APIをpollし、必要なmanifestとassetだけを取得する。

再生中はCloudへ取りに行かない。端末は常にローカルに検証済みで適用済みのcontentだけを再生する。

```text
Cloudに繋がらない = 更新できない
Cloudに繋がらない != 表示できない
```

## CloudとLocalの責任分界

| 項目 | 正本 | ローカル側の役割 |
| --- | --- | --- |
| tenant / store / device | Cloud | device identityとして保持 |
| display_profile | Cloud | rendering用にcache |
| asset | Cloud | 再生用にdownload/cache |
| content manifest | Cloud | applied copyとして保持 |
| playlist | Cloud | 再生用copyとして保持 |
| target_content | Cloud | pollして同期対象を確認 |
| applied_content | Local + Cloud報告 | 実際に表示中の状態を保持 |
| playlog | Local queue -> Cloud | 未送信分を保持し復旧後送信 |
| error log | Local queue -> Cloud | 未送信分を保持し復旧後送信 |
| local override | Local一時正本 | Cloudへoverride report送信 |
| report snapshot | Cloud | 端末では生成しない |
| Cloud backup | Cloud | 端末から復元しない |

## ローカルSQLiteの採用

端末側にはSQLiteを入れる。目的はCloud DBの複製ではなく、ネット断、Cloud障害、更新失敗、端末再起動後も表示と証跡を守るためである。

推奨DB:

```text
apps/player/data/local_state.sqlite
```

### applied_content

現在端末で有効なcontentを1件以上保持する。

```sql
CREATE TABLE applied_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  playlist_version TEXT NOT NULL,
  display_profile_id TEXT NOT NULL,
  playlist_path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cloud',
  status TEXT NOT NULL DEFAULT 'active',
  applied_at TEXT NOT NULL,
  rollback_content_id TEXT,
  created_at TEXT NOT NULL
);
```

`source` は次のいずれかとする。

```text
cloud
local_admin
rollback
factory_default
```

### asset_cache

端末にdownload済みの素材状態を保持する。

```sql
CREATE TABLE asset_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  content_id TEXT,
  expected_sha256 TEXT NOT NULL,
  actual_sha256 TEXT,
  expected_size INTEGER NOT NULL,
  actual_size INTEGER,
  mime_type TEXT NOT NULL,
  target_path TEXT NOT NULL,
  staging_path TEXT,
  local_path TEXT,
  status TEXT NOT NULL,
  downloaded_at TEXT,
  verified_at TEXT,
  promoted_at TEXT,
  last_used_at TEXT,
  delete_allowed INTEGER NOT NULL DEFAULT 1,
  failed_at TEXT,
  error_message TEXT,
  UNIQUE(asset_id, content_id)
);
```

`status` は次のいずれかとする。

```text
missing
downloading
downloaded
verifying
verified
promoting
ready
failed
quarantined
```

### content_apply_jobs

content更新の単位で状態を持つ。

```sql
CREATE TABLE content_apply_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  target_content_id TEXT NOT NULL,
  target_content_hash TEXT NOT NULL,
  previous_content_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  downloaded_at TEXT,
  verified_at TEXT,
  applied_at TEXT,
  rolled_back_at TEXT,
  failed_at TEXT,
  error_code TEXT,
  error_message TEXT
);
```

`status` は次のいずれかとする。

```text
pending
downloading_assets
verifying_assets
ready_to_apply
applying
active
failed
rolled_back
```

### event queues

Cloudへ送れていないイベントを保持する。

```sql
CREATE TABLE local_event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  content_id TEXT,
  playlist_item_id TEXT,
  asset_id TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT,
  cloud_ack_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL
);
```

対象event:

```text
play_started
play_completed
play_interrupted
play_error
error_log
asset_result
content_result
local_override
log_bundle
```

Cloud側は `device_id + event_id` で冪等に受信し、重複登録しない。

## 更新時の反映方式

情報更新、動画追加、playlist編集時は次の順序で反映する。

```text
1. Cloudで新content manifestを作成
2. Cloudでassetとplaylistを紐づける
3. Cloudでactive化またはactivate_atを設定
4. 端末がcontent-policyをpoll
5. 端末SQLiteへcontent_apply_jobsを作成
6. 必要assetをstagingへdownload
7. size / sha256 / target_pathを検証
8. 必要ならffprobe quick check
9. 検証済みassetだけlocal asset領域へpromote
10. playlist validation
11. playlistをatomic replace
12. applied_contentを更新
13. content-resultをCloudへ送信
14. playerへreloadを指示
```

本番ファイルへ直接downloadしてはならない。

```text
NG: /assets/videos/menu.mp4 に直接curlする
OK: /staging/downloads/asset-id.part -> verify -> /assets/videos/asset-id-hash.mp4
```

## 動画破損対策

サイズ一致だけでは十分ではない。必ずsha256を検証する。

Cloud upload時:

```text
extension check
MIME check
size limit
sha256 calculation
ffprobe validation
duration / resolution / codec extraction
thumbnail generation check when practical
```

端末download後:

```text
size match
sha256 match
target_path safety check
optional ffprobe quick check
atomic promote
```

端末側のsha256がCloudのsha256と一致しないassetは本番領域へ入れない。`quarantine`へ移動し、Cloudへ `asset_sync_failed` を送る。

## ローカルからCloudへバックアップするもの

Cloudに正本があるものを端末から丸ごと吸い上げない。端末からCloudへ戻す対象は、Cloudにまだ存在しない一時正本だけに限定する。

送信対象:

```text
未送信playlog
未送信error log
未送信asset/content sync result
local_override内容
端末側applied_content状態
障害時log bundle
Cloudに存在しないローカル生成素材
```

送信不要:

```text
Cloud asset正本
content manifest正本
campaign設定
QR / coupon / cart master
tenant / store / device master
report snapshot
```

## local override

ローカルadminで緊急変更した場合はCloud正本と区別する。

```text
source = local_admin
local_override = true
override_reason = emergency | field_setup | demo | development
```

端末は復旧後にCloudへ `local_override` eventを送信する。Cloud管理画面では次を表示する。

```text
この端末はCloud active contentと異なる内容を表示中
```

Operatorは次のどちらかを選ぶ。

```text
1. Cloud active contentで強制上書き
2. local override内容をCloudへ取り込んで新contentとして発行
```

## ロールバック

### 端末内ロールバック

ネット断でも実行できる必要がある。

```text
content-002 適用失敗
-> previous_content_idを参照
-> content-001のplaylist/assetsへ戻す
-> 表示継続
-> Cloud復旧後にrolled_backを報告
```

発動条件:

```text
required asset missing
size mismatch
sha256 mismatch
ffprobe failed
playlist validation failed
atomic move failed
player reload後の連続play_error
kiosk_state異常
current_item_idが一定時間進まない
```

### Cloud側ロールバック

Cloud側では過去content_idを直接編集しない。戻す場合は以下のいずれかとする。

```text
1. 旧contentを再active化する
2. rollback用contentを新規発行する
```

active済みcontentはimmutableとする。修正は必ず新content_idで作成する。

## Cloud側定期バックアップ

Cloudが正本なので、Cloud側は定期バックアップを必須とする。

対象:

```text
Cloud DB
Cloud asset storage
manifest export
report snapshot export
billing / contract records when implemented
```

推奨保持:

```text
DB:
  daily 7世代
  weekly 4世代
  monthly 12世代

Asset storage:
  object versioningまたはsnapshot
  deleteはsoft delete優先
  sha256 manifestを別途保存

Report snapshot:
  月次確定後はimmutable
  metrics_json / PDF / CSV を固定保存
```

### バックアップ保管先

商品化前の最小構成ではConoHa VPS内のローカル世代バックアップで開始できる。ただし、商品化する時点で同一VPS内だけのbackupを正式運用として扱ってはならない。

決定:

```text
MVP:
  ConoHa VPS内ローカル世代バックアップ
  daily / weekly / monthly
  restore手順の手動確認

商品化:
  S3互換または別リージョン/別事業者ストレージへ暗号化保管
  Cloud DB dump / asset manifest / report snapshotを別ストレージへ逃がす
```

別ストレージ候補:

- S3互換object storage
- Cloudflare R2
- Backblaze B2
- ConoHa外のS3互換ストレージ

### backup security

Cloud backupには、tenant、store、device、campaign、QR、coupon、cart、billing、contract、report snapshotなど、個人情報または課金/契約情報を含む可能性がある。

必須:

- backupは暗号化して保管する。
- backup encryption keyをGit、DB dump、backup archive内に含めない。
- backup取得、一覧、download、restoreは `misell_owner` または明示された `device_ops` / infra担当だけに限定する。
- backup操作はaudit logに残す。
- backup URLを公開URLにしない。
- backup archiveには最小限の権限だけを付ける。
- 退役済みtenant/storeの保持期間と削除手順を定義する。
- restore検証を定期実施する。

restore / DR drill:

```text
monthly:
  最新backupから別DBへrestoreできることを確認する

quarterly:
  DB + asset manifest + report snapshotの整合性を確認する

before major release:
  migration後のbackup/restoreをdry-runする
```

restore drillは、実施日、対象backup、restore先、結果、失敗理由、担当者を記録する。検証されていないbackupは、復旧証跡として扱わない。

## 容量・保持期間

端末はdownload前に必要容量を見積もる。

```text
required_new_assets_size + safety_margin <= disk_free
```

容量不足時はdownloadを始めず、Cloudへ `disk_insufficient` を返す。

端末側retention:

```text
current content: 必ず保持
previous content: rollback用に最低1世代保持
unused assets: delete_unused_policyに従って削除
local logs: synced_at後に保持期間で削除
SQLite: 定期VACUUM / WAL checkpoint
```

## 受け入れ条件

本仕様の実装は次を満たすこと。

```text
1. Cloud断でも最後のapplied contentが再生される
2. download途中停止で本番assetが破壊されない
3. sha256不一致assetが本番領域に入らない
4. playlist validation失敗時に旧contentが継続する
5. 端末再起動後もSQLiteからapplied_contentを復元できる
6. 未送信playlogがCloud復旧後にbackfillされる
7. local overrideがCloudに報告される
8. Cloud activeとLocal appliedのズレが管理画面で見える
9. rollback実行履歴がCloudへ残る
10. Cloud DBとasset storageの定期バックアップ手順がある
11. backupが暗号化され、アクセス制御されている
12. restore / DR drillの実施履歴が残る
```

## 禁止事項

```text
再生中の本番動画を直接上書きする
Cloud DBへ端末から直接接続する
Cloud正本を端末backupから無条件に上書きする
size一致だけでasset検証を完了扱いにする
local admin変更をCloudに無報告で放置する
report snapshotを後からraw log再計算で変動させる
```
