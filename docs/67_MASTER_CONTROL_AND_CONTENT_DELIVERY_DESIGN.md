# 67. Master Control and Content Delivery Design

## 目的

Misellのマスター管理で、各端末の稼働状況、バージョン、配信内容、動画入れ替えを一元管理するための設計をまとめる。

この文書では、現時点で実装済みの範囲と、動画ファイルをクラウドから端末へ配るために追加すべき範囲を分ける。

## Rasen適用方針

`watchout/rasen` は、商品を「商品核、顧客の痛み、オファー、営業資産、リード、商談、納品、改善」に分けて回すGrowth OSである。Misellでは、管理画面を単なるCMSではなく、販売、導入、運用、効果報告を1つの循環にするための中核として扱う。

Misellへの適用:

| Rasen module | Misellでの意味 | 管理画面/データで支えるもの |
| --- | --- | --- |
| Product Kernel | 3連サイネージで店舗空間を案内、販促、広告媒体に変える | 業態別demo、端末構成、価格プラン、導入条件 |
| Market Lens | 店舗/施設が抱える案内負荷、販促導線不足、広告効果不明、更新手間を特定する | 店舗別課題、設置場所、既存販促、来店/滞在導線メモ |
| Offer Compiler | 「置くだけ」ではなく、短期間で表示、QR、月次レポートまで出すオファーにする | デモplaylist、QR発行、初月レポート、運用代行範囲 |
| Asset Factory | LP、提案書、デモ素材、商談台本、月次レポートを生成する | 業態別素材、QR画像、スクリーンショット、レポートexport |
| Lead Engine | 無料診断、テスト導入、業態別デモから商談を作る | 申込ID、診断結果、デモURL、商談ステータス |
| Sales Pipeline | ヒアリング、提案、契約、設置、初回表示まで標準化する | 顧客/店舗/設置場所/端末/契約ステータス |
| Delivery System | 端末設置、素材差し替え、監視、障害対応、月次報告を運用にする | heartbeat、content manifest、log bundle、support ticket |
| Feedback Loop | 放映ログ、QR反応、失注理由、改善案を次の提案へ戻す | KPI dashboard、月次レポート、campaign別比較 |

この設計で重視すること:

- 技術機能を先に売らず、店舗側の「案内負荷削減」「販促反応」「広告枠化」「更新の手間削減」を先に見せる。
- マスター管理はMisell運用者の管制塔にする。
- 店舗用画面は、専門用語を減らし、成果、依頼、承認、サポートに絞る。
- 効果測定は「何回流れたか」だけではなく、「何を改善するか」まで出す。

## 解決する課題と数値化

管理画面には、Misellが解決している問題を数値で見せるページが必要である。初期は完璧な分析基盤よりも、毎月の報告と改善会話に使える指標を優先する。

| 課題 | 店舗側の痛み | Misellでの解決 | 表示する指標 |
| --- | --- | --- | --- |
| 表示停止に気づけない | 現地で止まっていても本部が把握できない | heartbeatとalertで遠隔監視する | 稼働率、offline時間、critical件数、平均復旧時間 |
| 素材入れ替えが遅い | USB/現地作業/担当者待ちで更新が止まる | content manifestとasset syncで遠隔差し替えする | 更新依頼から反映までの時間、rollout成功率、失敗端末 |
| バージョン混在 | 店舗ごとにapp/playlist/configが違い、障害調査が遅い | app/release/playlist/config versionを一覧化する | version分布、hold端末、更新失敗率 |
| 案内/注文/予約導線が弱い | スタッフ説明や紙掲示に依存する | 画面表示とQRで導線を作る | QR読み取り数、読み取り率、時間帯別反応、導線別比較 |
| 広告効果が説明しにくい | 広告主に報告する材料が少ない | 放映ログとQRログを月次レポートにする | 放映回数、表示時間、QR反応、広告枠稼働率 |
| 運用価値が見えにくい | 月額費用の理由が伝わりにくい | 運用レポートと改善提案を毎月出す | 月次レポート提出率、改善提案件数、次月施策 |

### 最初に表示するKPI

Master dashboard:

| KPI | 計算 | データ元 |
| --- | --- | --- |
| 稼働率 | online時間 / 対象時間 | heartbeats, devices |
| offline端末数 | effective_statusがoffline/criticalの端末数 | devices |
| 平均復旧時間 | alert resolved_at - first_seen | alerts |
| playlist反映率 | 最新playlist_versionの端末数 / 対象端末数 | devices, content_manifests |
| app version分布 | app_version別端末数 | devices |
| content rollout成功率 | success端末数 / 対象端末数 | device content results |
| QR反応数 | qr_id別scan count | QR access logs |
| QR反応率 | QR反応数 / 放映回数 | playlogs, QR access logs |
| 広告枠稼働率 | 広告item放映時間 / 対象放映時間 | playlogs, campaign metadata |

店舗用dashboard:

| KPI | 見せ方 |
| --- | --- |
| 今月の放映回数 | コンテンツ別上位表 |
| QR読み取り数 | 導線別、時間帯別 |
| 表示稼働状況 | 正常/注意/停止だけの簡易表示 |
| 今月の変更履歴 | 素材差し替え、playlist更新 |
| 次月提案 | 反応が良い導線、弱い導線、差し替え候補 |

## 管理画面の全体構成

最低限必要な画面は、Misell側のマスター管理と、提供先店舗向けポータルの2つである。広告主向け画面は、広告枠販売が始まった後の第3段階で追加する。

```text
Misell Master Admin
  - 全tenant/store/device/content/campaign/reportを管理
  - Tailscale/SSH保守情報を保持
  - 公開、更新、退役、障害対応を実行

Store Portal
  - 自店舗の状態、配信内容、QR反応、月次レポートを見る
  - 素材差し替えを依頼する
  - 公開前contentを承認する

Advertiser Portal
  - 後続
  - 掲載枠、放映実績、QR反応、請求を確認する
```

### Master Admin

Misell運用者が使う画面。端末、配信、素材、効果、契約、サポートを横断して見る。

| 画面 | 目的 | 主な要素 | 実装状態 |
| --- | --- | --- | --- |
| Executive dashboard | 全体の健康状態と事業KPIを見る | 稼働率、MRR、導入店舗数、critical端末、QR反応、広告枠稼働率 | 後続 |
| Devices | 端末稼働、version、token、更新予約を見る | status、last_seen、app/release/playlist/config、disk/memory、update status | 一部実装済み |
| Device detail | 障害調査と履歴確認 | heartbeat、alerts、log bundles、token events、playlogs、errors | 一部実装済み |
| Tenants/Stores | 提供先、店舗、設置場所を管理 | tenant、store、location、screen group、契約状態 | DB一部実装済み、UI後続 |
| Asset library | 動画/画像/QR素材を管理 | upload、sha256、利用中manifest、削除、容量 | Player localは実装済み、Cloud後続 |
| Content delivery | playlistと素材を配信する | draft、preview、active化、rollback、rollout状態 | content manifest一部実装済み |
| Release operations | app releaseを配信する | release manifest、channel、canary/stable、rollback | 一部実装済み |
| QR/Campaigns | QR導線とcampaignを管理する | campaign_id、qr_id、LP、scan数、媒体 | QR生成はPlayer local実装済み、Cloud集計後続 |
| Reports | 店舗/広告主向け月次報告を作る | 放映、QR、稼働、改善提案、PDF/export | 後続 |
| Support/Ops | 障害と作業履歴を管理する | alerts、通知、対応メモ、Tailscale接続情報 | alerts一部実装済み |

### Store Portal

店舗/施設担当者が使う画面。運用の透明性と成果確認に絞り、危険な端末操作やtoken操作は出さない。

| 画面 | 目的 | 店舗に見せる情報 |
| --- | --- | --- |
| Overview | 今月の価値を一目で見る | 放映回数、QR読み取り、正常稼働、次月提案 |
| Current Display | 今流れている内容を確認する | playlist名、表示期間、preview、承認状態 |
| Request Change | 素材差し替えを依頼する | 画像/動画/テキスト/LP URL、希望反映日 |
| QR/Campaign Result | 導線別の反応を見る | campaign別QR読み取り、時間帯、前月比 |
| Monthly Report | 月次レポートを見る | PDF/HTML、改善提案、広告枠状況 |
| Support | 問い合わせする | 表示不具合、素材修正、現地確認依頼 |

店舗用画面で許可しない操作:

- device token表示、再発行、失効
- app release変更
- Tailscale ACLやSSH情報の閲覧
- 他店舗のデータ閲覧
- 未承認素材の本番公開

### 権限モデル

| Role | 対象 | できること |
| --- | --- | --- |
| `misell_owner` | Misell経営/責任者 | 全データ閲覧、契約/KPI、権限管理 |
| `misell_operator` | Misell運用担当 | 素材、playlist、QR、report、店舗対応 |
| `device_ops` | 端末保守担当 | devices、alerts、release、Tailscale情報、log bundle |
| `store_admin` | 店舗責任者 | 自店舗のreport、承認、変更依頼、support |
| `store_viewer` | 店舗スタッフ | 自店舗の表示内容とreport閲覧 |
| `advertiser` | 広告主 | 自campaignの放映/QR実績だけ閲覧 |

MVPではBasic authで開始してよいが、店舗用ポータルを外部提供する時点でtenant単位のlogin、role、audit logを実装する。

## Tailscale利用方針

2026-06-08時点のTailscale公式pricing/docs確認では、Personal planは非商用向けであり、商用運用ではStandard、Premium、Enterpriseなどのbusiness向けplanを使う前提にする。

確認した公式情報:

- Pricing: https://tailscale.com/pricing
- Personal planは商用利用向けではない: https://tailscale.com/pricing#faqs
- tagged resourcesと追加課金: https://tailscale.com/pricing
- tagsは非人間の端末/共有インフラ向け: https://tailscale.com/docs/features/tags

Misellでは、Tailscaleを次の用途に使う。

- 端末へのSSH/RustDesk/管理画面アクセス
- Cloud master adminへのVPN内アクセス
- 現地LANやNATを越えた保守作業
- 端末初期設定、障害調査、緊急手動復旧

Tailscaleだけで済ませる範囲:

| 用途 | Tailscaleでよいか | 理由 |
| --- | --- | --- |
| 端末へSSHする | よい | private overlay networkで直接入れる |
| 端末のLAN管理画面を見る | よい | `/admin` をTailscale IPだけで開けば公開不要 |
| Cloud master adminを見る | よい | masterをTailscale内に閉じられる |
| 現地ネットワーク越しの保守 | よい | NAT越えに向く |

Tailscaleだけでは足りない範囲:

| 用途 | 必要な仕組み |
| --- | --- |
| 端末稼働状況の一覧化 | Cloud heartbeat |
| app/release/playlist/config version管理 | Cloud device DB |
| QRログ/放映ログ/月次レポート | Misell app側のログDB |
| 動画ファイル配信 | Cloud素材ライブラリ + 端末asset sync |
| 数百台への一括playlist更新 | content manifest + rollout状態 |
| SLA/障害履歴 | alert + device log bundle |

つまり、Tailscaleは「安全な保守通路」として使い、Misell Cloudは「状態管理、配信管理、履歴、レポート」を担当する。Tailscale管理画面をMisellのマスター管理画面の代わりにしない。

### 端末のTailscale登録

サイネージ端末は人間のPCではなく shared infrastructure なので、Tailscale上ではtagged deviceとして扱う。

推奨tag:

```text
tag:misell-device
tag:misell-cloud
tag:misell-operator
```

推奨ACL方針:

- `tag:misell-device` からCloud masterのheartbeat/content/update APIへ接続できる。
- Operator端末から `tag:misell-device` のSSH、player admin、health checkへ接続できる。
- 端末同士の横方向通信は原則禁止する。
- Cloud masterから端末へ接続する必要がある場合も、必要portだけ許可する。

端末登録はtag付きauth keyを使い、端末をユーザー個人アカウントの所有物にしない。tagged deviceはkey expiryが無効化されるため、長期設置端末に向く。ただし、退役時は必ずTailscale上のmachine削除とMisell Cloud上のdevice退役を両方行う。

### 数百台時の見積もり観点

Tailscale公式pricingではuser devicesはunlimitedだが、サーバーや共有インフラのようなtagged resourcesは別枠で扱われる。公式pricingは50 tagged resourcesを含み、追加tagged resourceは月額課金の対象になる。

Misell端末を正しくtagged resourcesとして扱う場合の概算:

| 規模 | Tailscale観点 |
| --- | --- |
| 1-50台 | self-serve planのincluded tagged resources内で開始しやすい |
| 51-300台 | 追加tagged resourcesの月額費用を見積もる |
| 300-1000台 | ACL、tag、auth key、退役運用を自動化する |
| 1000台以上 | Enterprise相談を前提にする |

台数が増えても、全端末へ人が直接ログインする運用にはしない。通常運用はCloud heartbeat/content/updateで行い、Tailscale直接アクセスは例外対応に限定する。

### 動画配信との関係

Tailscaleは端末へ安全に到達するためのネットワークであり、動画配信基盤ではない。大きな動画ファイルを数百台へ配る場合、管理者PCからTailscale越しにコピーする運用は避ける。

理由:

- 全端末へ手作業コピーすると履歴と成功/失敗が残りにくい。
- 大容量動画では回線品質やrelay経由の影響を受ける。
- 同じ動画を多数端末へ送るにはCloud storage、hash検証、retry、rollout管理が必要になる。

動画配信は、Tailscale上またはprivate HTTPS上のMisell Cloudから端末がpullする方式にする。

## 現状確認

### Cloud master admin

実装場所:

- `apps/cloud`
- 管理画面: `/admin`
- Tailscale確認例: `http://<tailscale-ip>:3200/admin`

現在見られる情報:

| 項目 | 現状 |
| --- | --- |
| 端末一覧 | あり |
| 稼働状態 | `online`, `degraded`, `offline`, `critical`, `maintenance`, `retired`, `lost` |
| 最終heartbeat | あり |
| app version | `app_version` |
| release | `release_id`, `release_channel` |
| playlist | `playlist_version` |
| config | `config_version` |
| 再生中item | `current_item_id` |
| 端末状態 | 空き容量、メモリ、service状態、last_error |
| token管理 | 発行、再発行、失効 |
| update予約 | 端末別Git ref、release_id、release_channel |
| release manifest | channel単位のアプリ更新 |
| content manifest | channel単位のplaylist JSON配信 |
| Cloud素材ライブラリ | 画像/動画アップロード、一覧、download、削除 |
| log bundle | 端末ログ収集 |

### Player terminal

実装場所:

- `apps/player`

現在できること:

- `/api/status` で端末状態を返す
- `scripts/emit-heartbeat.sh` でCloudへheartbeat送信
- `scripts/check-update.sh` でCloudの更新予約をpollしてGit ref更新
- `scripts/sync-content.sh` でCloudのcontent manifestをpollしてplaylistを差し替える
- `scripts/sync-assets.sh` でCloudのcontent manifestに紐づく素材をdownloadしてsha256検証する
- LAN管理画面で画像/動画を端末ローカルへアップロードする

## 現状でできる動画入れ替え

現時点では、Cloudで動画/画像ファイルをアップロード、保管、content manifestへ紐づけ、端末が自動downloadして配置できる。端末は素材のsha256を検証し、素材同期に失敗した場合はplaylist適用前に止める。

今すぐできる動画入れ替えは次のいずれかになる。

| 方法 | 内容 | 適した場面 |
| --- | --- | --- |
| 既存動画の切り替え | 端末に既にある `/assets/videos/...` をplaylistで指定する | 現地またはLAN管理画面で素材投入済み |
| Cloud素材配信 | Cloud素材ライブラリに動画/画像を置き、content manifestの必要素材として紐づける | 複数端末への遠隔差し替え |
| デモ/生成コンテンツの切り替え | `/demo/...` や `/generated/...` をplaylistで指定する | 商談デモ、簡易検証 |

Cloud content manifestは、端末の `release_channel` に一致するactive manifestを返す。端末は `scripts/sync-content.sh` で必要素材を先に同期し、playlist検証に通れば `apps/player/data/playlist.json` を差し替える。

## 目指す運用

マスター管理から以下を完結できる状態を目指す。

1. 端末の稼働状況を確認する。
2. 端末のapp/release/playlist/config versionを確認する。
3. 管理者が動画や画像をCloudへアップロードする。
4. Cloudでplaylistを作成し、配信対象のchannelまたは端末を指定する。
5. 端末が必要な素材をダウンロードし、ハッシュ検証する。
6. 素材が揃った後にplaylistを差し替える。
7. 端末が成功/失敗をCloudへ報告する。
8. Cloud管理画面で配信状況と失敗端末を確認する。

### デモから納品までの標準フロー

Rasenの「商談、納品、改善」をMisellに落とすと、初回デモから継続運用までの流れは次のようになる。

| Phase | Misell側の作業 | 管理画面で必要なもの | 成果物 |
| --- | --- | --- | --- |
| 1. Discovery | 業態、設置場所、困りごと、既存販促、QR導線を確認 | 顧客/店舗メモ、診断チェックリスト | 課題整理、デモ方針 |
| 2. Demo | 業態別素材とQRを作り、previewで見せる | demo playlist、QR発行、preview URL | 商談用画面、提案書 |
| 3. Pilot setup | tenant/store/deviceを作り、端末を登録する | device token、release_channel、Tailscale情報 | 設置台帳、初回playlist |
| 4. Acceptance | 実機表示、ネット断、再起動、QRを確認する | QA gate、heartbeat、スクリーンショット | 受入証跡 |
| 5. Operation | 素材差し替え、監視、障害対応を回す | alerts、content manifest、support log | 運用履歴 |
| 6. Monthly report | 放映、QR、稼働、改善案を出す | report dashboard、export | 月次レポート |
| 7. Improve/upsell | 反応が良い導線を伸ばし、広告枠やAI分析へつなぐ | campaign比較、提案履歴 | 次月施策、上位プラン |

## データ収集とレポート設計

### 必要なイベント

| event | 内容 | 既存/後続 |
| --- | --- | --- |
| `heartbeat` | 端末状態、version、再生中item | 実装済み |
| `playlog` | どのitemがいつ何秒流れたか | 実装済み |
| `error_log` | 端末/表示/同期エラー | 実装済み |
| `admin_log` | 素材、playlist、QR、設定変更 | Player local一部実装済み |
| `qr_catalog` | campaign_id、qr_id、LP、PNG | Player local実装済み |
| `qr_scan` | QR読み取り、時刻、媒体、user agent概要 | 後続 |
| `content_result` | playlist適用成功/失敗 | 一部実装済み |
| `asset_result` | 動画/画像同期成功/失敗 | 実装済み |
| `support_event` | 問い合わせ、対応、解決 | 後続 |
| `report_snapshot` | 月次reportの確定値 | 後続 |

### Reportの構成

店舗向け月次report:

1. 今月の表示サマリー
2. 稼働状況と停止があった場合の対応
3. コンテンツ別放映回数
4. QR導線別の読み取り数
5. 前月比またはテスト期間内比較
6. 良かった導線、弱かった導線
7. 次月の差し替え提案

Misell内部向けreport:

1. 店舗別MRR、契約状態
2. 端末稼働率、critical件数、復旧時間
3. 更新作業数、失敗数、手動対応時間
4. QR/campaign反応
5. 広告枠稼働率、広告売上
6. 解約リスク店舗
7. 次月の営業/運用優先順位

## アーキテクチャ

```text
Admin browser
  |
  | Basic auth
  v
Misell Cloud master
  - devices
  - heartbeats
  - release_manifests
  - content_manifests
  - cloud_assets
  - device_asset_states
  |
  | Bearer device token
  v
Misell Player terminal
  - heartbeat
  - update check
  - content sync
  - asset sync
  - local playlist apply
```

Cloudは配信指示と素材保管を担当する。PlayerはCloudをpollし、必要な素材を端末ローカルへ保存してからplaylistを適用する。

## 追加するデータモデル

### cloud_assets

Cloudにアップロードされた素材を管理する。

| column | 内容 |
| --- | --- |
| asset_id | 素材ID。例: `asset-20260608-menu-video` |
| type | `image` または `video` |
| filename | 保存ファイル名 |
| original_name | アップロード元ファイル名 |
| mime_type | MIME type |
| size | bytes |
| sha256 | ダウンロード検証用 |
| storage_path | Cloud内保存パス |
| public_path | 端末ダウンロードAPIのパス |
| created_at | 作成日時 |
| updated_at | 更新日時 |

### content_manifest_assets

content manifestが要求する素材を管理する。

| column | 内容 |
| --- | --- |
| content_id | content manifest ID |
| asset_id | 必要素材 |
| target_path | 端末側の保存先。例: `/assets/videos/menu.mp4` |
| required | 必須素材かどうか |

### device_asset_states

端末ごとの素材同期状態を管理する。

| column | 内容 |
| --- | --- |
| device_id | 端末ID |
| asset_id | 素材ID |
| status | `checking`, `downloading`, `ready`, `failed` |
| local_path | 端末側保存パス |
| sha256 | 端末側で検証したhash |
| size | bytes |
| message | エラー詳細 |
| updated_at | 更新日時 |

## 追加するAPI

### Admin API

| method | path | 内容 |
| --- | --- | --- |
| `GET` | `/api/admin/assets` | Cloud素材一覧 |
| `POST` | `/api/admin/assets` | 画像/動画アップロード |
| `GET` | `/api/admin/assets/:asset_id/download` | Cloud素材download |
| `DELETE` | `/api/admin/assets/:asset_id` | 未使用素材削除 |
| `POST` | `/api/admin/content-manifests` | playlistと必要素材をセットで作成 |
| `PATCH` | `/api/admin/content-manifests/:content_id` | draft/active/retired変更 |
| `GET` | `/api/admin/content-rollouts/:content_id` | 端末別の同期状態。後続 |

### Device API

| method | path | 内容 |
| --- | --- | --- |
| `GET` | `/api/device/content-policy` | playlistと必要素材manifestを返す |
| `GET` | `/api/device/assets/:asset_id/download` | 端末が素材を取得する |
| `POST` | `/api/device/asset-result` | 端末が素材同期結果を報告する |
| `POST` | `/api/device/content-result` | 端末がplaylist適用結果を報告する |

## content-policyの拡張

現状の `content-policy` は、必要な場合だけplaylistを返す。動画配布対応後は、playlistに加えて必要素材を返す。

```json
{
  "ok": true,
  "device_id": "DEV-DEMO-001",
  "content": {
    "required": true,
    "source": "content_manifest",
    "content_id": "content-20260608-stable-001",
    "playlist_version": "pl-20260608-001",
    "release_channel": "stable",
    "assets": [
      {
        "asset_id": "asset-menu-video",
        "type": "video",
        "target_path": "/assets/videos/menu.mp4",
        "download_url": "/api/device/assets/asset-menu-video/download",
        "sha256": "..."
      }
    ],
    "playlist": {
      "version": 1,
      "playlist_version": "pl-20260608-001",
      "items": []
    }
  }
}
```

## 端末側asset sync

実装済みスクリプト:

```text
apps/player/scripts/sync-assets.sh
```

処理:

1. `GET /api/device/content-policy` を取得する。
2. `content.assets` を確認する。
3. 端末に同じ `sha256` の素材があればskipする。
4. 不足素材を一時ファイルへdownloadする。
5. `sha256` と端末側保存先を検証する。
6. `apps/player/assets/images` または `apps/player/assets/videos` へatomic moveする。
7. `POST /api/device/asset-result` へ結果を送る。
8. 全必須素材がreadyになった後に `sync-content.sh` がplaylistを適用する。

重要な順序:

```text
asset download -> hash validation -> local backup -> playlist validation -> playlist apply -> result report
```

playlistだけ先に適用すると、動画が未配置で黒画面やmissing表示になるため、素材同期を先に完了させる。

## Cloud Admin実装設計

Master Adminのうち、現行 `apps/cloud` へ追加/整理する実装単位を定義する。

### 1. 端末一覧

既存機能を維持し、表示密度を上げる。

- 状態
- 端末名
- 店舗/設置場所
- 最終受信
- app/release/channel
- playlist/config
- 現在再生中
- storage/memory
- update status
- content sync status
- alert badge
- Tailscale device name/IPへの内部メモ

### 2. 素材ライブラリ

追加するUI:

- 動画/画像アップロード
- MIME/サイズ/sha256表示
- 利用中content manifest表示
- 未使用素材削除
- コピー用パス表示
- 容量使用量
- 承認状態

### 3. コンテンツ配信

既存のcontent manifest UIを拡張する。

- playlist JSON編集
- 素材選択
- 配信channel選択
- draft保存
- active化
- active化時に旧activeをretired
- 端末別rollout状態
- preview表示
- 店舗承認状態

### 4. リリース配布

既存のrelease manifest UIを維持する。

- app更新はrelease manifest
- playlist/動画更新はcontent manifest
- どちらも `release_channel` を配信対象の基本単位にする

### 5. 効果測定

`docs/13_DATA_KPI_REPORTING.md` と接続し、店舗別・campaign別に成果を確認できるようにする。

- playlog集計
- QR scan集計
- campaign別反応
- 月次report snapshot
- 前月比
- 改善メモ

### 6. 店舗ポータル連携

店舗向け画面はMaster Adminのsubsetとして始める。最初は別アプリにせず、Cloud内でtenant/store権限を分ける方が実装しやすい。

- store単位の閲覧制限
- content公開前の承認
- 素材差し替え依頼
- 月次report閲覧
- support問い合わせ

## セキュリティ

- Admin APIはBasic auth必須。Tailscale内でもdefault passwordは使わない。
- Device APIはBearer device token必須。
- tokenはCloud DBにhash保存し、平文は発行時だけ表示する。
- アップロードは拡張子、MIME、ファイルヘッダ、サイズ上限を検証する。
- 端末保存先は `/assets/images` と `/assets/videos` に限定する。
- path traversalを拒否する。
- 素材downloadはsha256検証を必須にする。
- public internet公開前は、Basic authだけでなくSSOまたはVPN前提にする。

## 運用フロー

### 端末登録

1. Cloud adminで端末を作成する。
2. 表示された `device_token` を端末envへ保存する。
3. 端末でheartbeat timerを有効化する。
4. Cloud adminで端末がonlineになることを確認する。

### 動画入れ替え

1. Cloud adminで動画をアップロードする。
2. playlist itemを作成し、動画素材を指定する。
3. content manifestをdraft保存する。
4. 対象channelを選び、active化する。
5. 端末がcontent-policyをpollする。
6. 端末が動画をdownloadし、sha256検証する。
7. 端末がplaylistを差し替える。
8. Cloud adminで端末別の適用結果を確認する。

### ロールバック

1. 直前のcontent manifestをactiveに戻す。
2. 端末が次回pollで旧playlistへ戻す。
3. 素材は端末に残しておき、不要素材は別途cleanupする。

## 実装ステップ

### Step 1: 現状機能を運用可能にする

- Cloud adminのURL、認証、端末登録手順を整える
- 端末envに `MISELL_HEARTBEAT_URL` と `MISELL_DEVICE_TOKEN` を設定する
- heartbeat, update, content sync timerを有効化する
- content manifestで既存 `/demo/...` または端末内 `/assets/videos/...` を切り替える

### Step 2: Cloud素材ライブラリ

- `cloud_assets` DB追加
- admin素材アップロードAPI追加
- admin素材一覧UI追加
- upload時のMIME/ヘッダ/サイズ/sha256検証
- admin素材download/delete追加

実装状態: 実装済み。

### Step 3: 端末素材同期

- `content_manifest_assets` DB追加
- `content-policy` にassets追加
- device素材download API追加
- `scripts/sync-assets.sh` 追加
- 端末側sha256検証とatomic配置
- `device_asset_states` DB追加
- `asset-result` API追加

実装状態: 実装済み。次はStep 4でrollout可視化を進める。

### Step 4: rollout可視化

- content manifest別の端末適用状況UI追加
- failed端末の絞り込み
- retry/再同期操作

### Step 5: 運用品質

- 大容量動画のdownload timeout/retry
- 古い素材cleanup
- channel別canary配信
- content manifest rollback UI
- Cloud保存容量アラート

### Step 6: 効果測定と月次report

- QR scan ingest API追加
- campaign/qr_id別集計追加
- playlogとQR scanを結合したreport view追加
- 店舗向け月次report snapshot保存
- report exportまたは共有URL追加

### Step 7: 店舗ポータル

- tenant/store/user/role UI追加
- store_admin/store_viewerの閲覧制限
- 素材差し替え依頼ワークフロー
- content承認ワークフロー
- support問い合わせ履歴

### Step 8: Rasen販売資産への接続

- 業態別Product Kernelを作る
- 無料診断/ヒアリングシートを作る
- 商談用demo checklistを作る
- 月次report templateを作る
- 失注理由、成約理由、改善ログをcampaignごとに残す

## MVP判断

最初のMVPでは、動画ファイル配布まで一気に作らなくてもよい。まずは次の運用で十分に価値検証できる。

- 端末の稼働状況とversionをCloudで確認する
- 端末に手動投入済みの動画をcontent manifestで切り替える
- playlist差し替え成功/失敗をCloudで確認する
- 業態別demo素材とQR生成で商談に使える表示を作る
- 月次reportは最初は手動集計でもよいが、項目とIDは固定する

ただし、複数拠点へ展開する時点では、Cloud素材ライブラリと端末asset syncが必須になる。
