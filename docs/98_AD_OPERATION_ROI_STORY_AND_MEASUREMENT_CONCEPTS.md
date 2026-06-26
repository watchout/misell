# 98. 広告運用ROIストーリーと効果測定コンセプト

## 目的

この文書は、Misellの広告・協賛・リテールメディア設計に使う営業ストーリー、運用原則、効果測定コンセプトを保存する。

対象読者は、営業資料を作る人、媒体資料を更新する人、広告計測機能を設計する人、Campaign Studio/Reportingのセルを切る人である。

## 位置づけ

これは実装仕様ではなく、事業・商品・レポート設計への入力である。

外部提案や公開資料へ使う前に、実名事例と数値は出典URLを再確認する。調査時点の引用indexだけを根拠に、売上保証、ROI保証、増分効果保証として使ってはいけない。

関連ドキュメント:

- `docs/23_MEDIA_KIT_TEMPLATE.md`
- `docs/28_LP_STRUCTURE_AND_COPY.md`
- `docs/35_OPERATIONS_SOP.md`
- `docs/62_MISELL_MEDIA_KIT.md`
- `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md`
- `docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md`
- `docs/92_DETERMINISTIC_CONTROL_AND_DATA_POLICY_ADR.md`

関連Issue:

- #99 sponsorship/ad management foundation
- #133 manifest-based ad slots and measurement
- #171 customer-facing KPI dashboard

## 中核仮説

サイネージの回収速度は、画面を置くことではなく、運用を回し続けられるかで大きく変わる。

Misellが売るべきものは「モニター」ではなく、以下を一体化した運用システムである。

- 画面の3層コンテンツ構成
- 定期更新と鮮度管理
- 滞在時間に合わせた短尺設計
- QR/クーポン/注文/問い合わせへの反応計測
- 広告主・施設・代理店が検証できる月次レポート

この仮説は、MisellのValue Equationでは次のように扱う。

| 変数 | Misellで上げる/下げるもの |
| --- | --- |
| Dream Outcome | 店舗・施設の空き画面が案内、販促、協賛広告、広告収益に変わる |
| Perceived Likelihood | 放映ログ、QRログ、クーポン/注文ログ、月次snapshotで検証可能にする |
| Time Delay | テンプレート、Studio、スケジュール、レポート自動化で立ち上がりを短くする |
| Effort & Sacrifice | 素材差し替え、キャンペーン更新、広告主報告を運用しやすくする |

## 運用で回収を速める4原則

### 1. コンテンツを3層に分ける

画面を単一の広告枠として扱うと放置されやすい。Misellでは、ロール全体を3層で設計する。

| 層 | 目的 | 例 | Misell機能への含意 |
| --- | --- | --- | --- |
| 常時表示 | 施設価値と案内の土台 | 館内案内、料金、導線、多言語案内 | 基本テンプレート、常設playlist、施設プロファイル |
| 定期差し替え | キャンペーン鮮度 | 月替わり企画、季節商品、イベント、協賛広告 | Studio、スケジュール、提案、承認 |
| リアルタイム/文脈連動 | その場の反応を上げる | 天候、在庫、時間帯、混雑、当日イベント | 後続のPOS/在庫/天候連携、運用ルール |

営業上は「3層で回すから放置されにくい」と説明する。実装上は、playlist/manifest/reportingで `item_type`、`campaign_id`、`ad_slot_id`、`qr_link_id` を持てる構造へ寄せる。

### 2. 鮮度を維持する

同じ内容を流し続けると、視聴者は画面を見なくなる。Misellでは「更新されている感」を商品価値に含める。

取り入れるべき運用概念:

- customerが2回来店して同じ画面しか見なければ、更新頻度が低すぎる
- 常設コンテンツも、季節・曜日・時間帯で見せ方を変える
- stale contentを検知し、管理画面で警告する
- 提案/Studioは「次に差し替える候補」を出す

後続候補:

- content freshness score
- stale playlist warning
- last_updated_at / next_review_at
- 店舗別の更新頻度レポート

### 3. 滞在時間に合わせる

画面の前にいる時間が短いほど、1画面の理解速度が重要になる。Misellのコンテンツ設計では、次を基本ルールにする。

| 用途 | 目安 |
| --- | --- |
| 一目で伝える広告/案内 | 3秒以内に意味が伝わる |
| 視覚中心のスライド | 5から7秒程度 |
| テキスト中心のスライド | 7から10秒程度 |
| 通常の業務/施設環境 | 8から15秒程度 |
| メニュー/詳細確認 | 15から20秒程度 |

これは固定値ではなく、Campaign Project/Sceneのvalidationや提案支援に使う目安である。業種、設置場所、滞在導線によって変える。

### 4. POS・在庫・天候・時間帯と連動する

高い回収を狙う画面は、来店文脈に合わせて変わる。

MVPではすぐに全連携しないが、設計上は次を意識する。

- 時間帯: 朝/昼/夜で広告、案内、クーポンを変える
- 天候: 雨天、猛暑、寒暖で訴求を変える
- 在庫/POS: 売りたい商品、余剰在庫、LTOを出す
- 混雑/導線: 待ち時間が長い場所では説明量を増やす

Misellの主張は「AIが判断する」ではなく、決定済みルールと検証済みデータに基づき、スクリプト制御で運用することである。

## 実名ストーリー候補

以下は営業資料に使える可能性が高いが、外部公開前に一次または信頼できる二次出典を確認する。

| ストーリー | 使いどころ | Misellへの変換 |
| --- | --- | --- |
| 28店舗の地域スーパーが画面広告で約480,000ドルを得た事例 | 中小規模でも店舗内画面を広告媒体化できる証拠 | 「大手だけでなく、地域施設でも広告枠は作れる」 |
| Home Depotの広告事業でROAS 2倍超、増分トラフィック1.5倍、コンバージョン率26%向上とされる事例 | 広告主側の投資対効果ストーリー | 「広告主に検証可能なレポートを返せる媒体にする」 |
| Walmart Connectが2024年に44億ドル規模へ伸びた事例 | 小売/施設内メディアの構造説明 | 「Misellは施設内リテールメディアの小規模版」 |
| McDonald'sがメニューボードを価値認識の重要要因として扱う事例 | 画面が購買前の価値判断を作る説明 | 「画面は情報表示ではなく、店舗価値を作る場所」 |
| QSRのデジタルメニュー/高輝度メニューでアップセルや売上改善が示された事例 | 飲食、カラオケ、ホテル朝食、温浴フード導線 | 「施設内販促から始めて広告枠へ育てる」 |

禁止する言い方:

- 「Misellを入れれば売上が上がる」
- 「広告収益を保証する」
- 「増分売上」と断定する
- 「ROASを保証する」
- holdout/baselineなしに「Misellによる純増」と表現する

推奨する言い方:

- 「放映回数、QR反応、クーポン/注文を計測できる」
- 「広告主が継続判断しやすい月次レポートを出せる」
- 「施設内導線に広告枠を作り、検証しながら育てる」
- 「初期は想定表示回数と反応計測から小さく始める」

## 効果測定の概念

広告主や代理店が検証できる形にするには、指標を階層化する。

| 階層 | 指標 | データ源 | 注意 |
| --- | --- | --- | --- |
| Proof of Play | 放映回数、開始数、完了数、再生秒数、失敗数 | Player playlog | 視認人数ではない |
| Placement | store、screen_group、screen_slot、ad_slot、time bucket | content manifest / playlog | 枠ごとの効果比較に使う |
| Engagement | QR scan、LP click、coupon open | QR event | 反応であり購買ではない |
| Conversion | coupon issued/redeemed、counter order issued/redeemed、金額 | offer/order tables | Misellレール内だけ実測 |
| Advertiser Report | campaign、creative、qr_link、period、store別集計 | reporting read model / snapshot | 広告主別scope必須 |
| Incrementality | control/holdout、baseline比較 | 実験設計 | MVPでは原則名乗らない |

## G12: Two-sided ROI Model

Misellの広告/協賛事業は、設置側と広告出稿側の両方が検証できるROIを持つ必要がある。

「計測できる」と言うだけでは不十分である。誰にとってのROIか、何を実測と呼ぶか、何を推定と呼ぶか、何を増分と呼べるかを分ける。

### G12-1. 二者別ROI

| 対象 | 見る指標 | 目的 |
| --- | --- | --- |
| 設置側 | ad revenue、施設内販促売上、運用工数削減、回収期間、広告枠稼働率 | 画面設置・運用費を回収できているか |
| 出稿側 | QR反応、coupon issued/redeemed、order issued/redeemed、CPA、ROAS、継続判断材料 | 広告費を継続/増額する根拠があるか |

設置側は「媒体として稼げるか」を見る。出稿側は「広告出稿として検証できるか」を見る。両者を同じROIとして混ぜない。

### G12-2. ROIラベル

すべてのROI表示には、以下のどれかのラベルを付ける。

| ラベル | 意味 | 例 |
| --- | --- | --- |
| measured | Misellレール内で実測できる | QR scan、counter order、coupon redeem、Misell経由決済 |
| estimated | 外部売上、来店、POS外成果を含む推定 | POS連携前の来店推定、広告主申告売上 |
| incremental | baseline/holdout/controlで比較できる増分 | holdout店舗/期間と比較したredeemed revenue lift |

ラベルなしのROI表示を禁止する。holdout/baselineなしに `incremental` を使わない。

### G12-3. Proof of Play整合

広告主/代理店へ渡すProof of Playは、最低限以下を持つ。

- timestamp
- tenant_id / store_id / screen_group_id / device_id
- content_id / playlist_version / manifest_hash
- item_type
- campaign_id
- creative_id
- ad_slot_id
- qr_link_id
- planned_duration_seconds
- played_duration_seconds
- result
- event_id

端末のオフライン再送、重複排除、端末時刻ズレ、manifest不一致、失敗resultをレポート側で区別できることを受入条件にする。

### G12-4. 広告在庫

設置側ROIには、広告枠の在庫化が必要である。

最低限の広告在庫指標:

- sellable ad_slot
- sold slot
- empty slot
- fill_rate
- slot unit price
- booked period
- available period
- campaign occupancy

広告在庫は、単なるplaylist item数ではなく、施設/画面/枠/時間帯/期間の組み合わせとして扱う。

### G12-5. 広告主レポートは判断まで返す

広告主向けレポートは数値表で終わらせない。

必ず次の判断に接続する。

- 継続するか
- creativeを変えるか
- 時間帯を変えるか
- QR/offer/CTAを変えるか
- 予算を増やすか
- 掲載施設/枠を変えるか

ただし、AIやレポート文章が最終判断を代行しない。判断材料と次回仮説を提示する。

### G12-6. 日本市場向け差別化表現

Misellの広告事業は、以下のように表現する。

- 放映証跡と反応計測を持つ施設内メディア
- 広告主が検証できる店内/施設内サイネージ
- 設置側も出稿側もROIを見られるサイネージ運用基盤
- 設置して終わりではなく、月次で改善する広告運用OS

禁止表現:

- 売上が上がるサイネージ
- ROIを保証するサイネージ
- 日本初/唯一など、確認不能な最上級表現

### G12-7. 法務/プライバシーGATE

scale前、広告主セルフサービス前、カメラ/属性推定前に、広告法務とプライバシー境界を明示する。

詳細なGATE要件は `docs/99_AD_LEGAL_PRIVACY_GATE_SPEC.md` を正本とする。

対象:

- 医療
- 金融/投資
- 求人
- 美容/健康
- 効果効能表現
- 酒類/年齢制限商品
- 競合/施設ブランドNG
- カメラ/属性推定/個人情報

MVPの測定は、no-PII、no-camera、no-sensitive profilingを基本とする。カメラや属性推定は別gateで扱う。

### G12-8. 出典台帳

実名企業・実数値のストーリーを外部資料で使う前に、出典台帳を作る。

出典台帳の正本は `docs/100_AD_EVIDENCE_SOURCE_LEDGER.md` とする。台帳で `external_ok=true` になっていない実名・数値は、内部参考として扱い、顧客提案、LP、媒体資料、営業資料には使わない。

最低限の項目:

- company
- claim
- number
- source_url
- checked_at
- source_type
- external_ok
- notes

台帳がない実名/数値は、内部参考として扱い、顧客提案や媒体資料に出さない。

## レポートで守るべき信頼ルール

1. 実測、推定、benchmark、試算を分ける。
2. 「想定表示回数」と「実放映ログ」を混ぜない。
3. QR反応率は `qr_scan_count / play_started_count` など分母を明記する。
4. 売上/注文はMisellレールで取れたものだけ「実測」と呼ぶ。
5. POS外売上や来店者数は、外部データがない限り推定にする。
6. 増分効果は、baselineまたはholdoutなしに名乗らない。
7. 月次snapshotは後から改ざんしない。再生成時はhashと生成日時を分ける。
8. 広告主/代理店向け画面はtenant/store/campaign/ad scopeで分離する。

## Productに取り込むべき概念

### Media/Ad Measurement Contract

manifest-based ad slotを前提に、playlist itemとplaylog/reportingへ以下を通す。

- `type` or `item_type`: `content` / `ad` / `sponsor`
- `campaign_id`
- `creative_id`
- `ad_slot_id`
- `qr_link_id`
- `duration_seconds`
- `screen_group_id`
- `screen_slot_id`

MVPでは独立した `/api/player/ad-schedules` を作らず、content manifestのplaylist itemとして扱う。

### Content Freshness Operations

運用の良し悪しを可視化する。

- last content update
- next scheduled refresh
- stale campaign warning
- unchanged playlist days
- active campaign count
- rotating vs static content ratio

### Advertiser/Agency Report

広告主と代理店が見るべき単位を固定する。

- 掲載期間
- 掲載施設/画面/枠
- 素材/creative別の放映実績
- QR反応
- クーポン/注文/問い合わせなどMisellレール内の成果
- 前月比較
- 改善提案
- 次月の仮説

### Sales Narrative

提案の流れは次の順にする。

1. 画面は価値認識を作る。放置すると見られなくなる。
2. だから、3層コンテンツと更新運用が必要。
3. Misellは運用しやすいCMS/Studio/Reportingで回収を早める。
4. 店舗内画面は広告媒体にもなる。
5. 広告主にはProof of Play、QR反応、クーポン/注文を返す。
6. 初期は保証せず、小さく計測して継続判断できる形にする。

### Studio Measurement Readiness

Misell Studioは制作ツールであると同時に、測定可能なCampaignProjectを作る入口である。

後続のStudio本実装では、Scene/Projectに以下の設計概念を接続する。

- content layer: `always_on` / `campaign_refresh` / `realtime_context`
- item type: `content` / `ad` / `sponsor`
- measurement goal
- expected action
- CTA
- QR link
- campaign / creative / ad slot linkage
- duration class
- next review date
- freshness status
- variation group
- improvement reason

これにより、Studioで作ったものが、放映後にProof of Play、QR反応、Conversion、ROIラベル付きレポートへ接続できる。

## 後続セル候補

### Cell A: Ad Measurement Contract

目的:

manifest-based ad slotの計測契約を実装する。

範囲:

- playlist itemの `type=ad` / `ad_slot_id` / `creative_id` / `qr_link_id`
- Player playlogへのad fields送信
- Cloud playlog ingestへのad fields保存
- reporting summaryのcampaign/ad_slot/creative breakdown
- smokeでno ad schedule API、no publish mutationを確認

非範囲:

- 広告主セルフサービス
- 請求/課金
- 外部広告ネットワーク
- 自動最適化AI

### Cell B: Media Kit Refresh

目的:

`docs/62_MISELL_MEDIA_KIT.md` と営業資料に、運用4原則、検証可能指標、実名ストーリー候補を取り込む。

注意:

実名・数値は出典URL確認後に外部提出版へ入れる。

### Cell C: Advertiser Report Surface

目的:

広告主/代理店がcampaign単位で検証できるread-only reportを作る。

範囲:

- campaign scoped report API
- advertiser/agency role and scope
- campaign monthly snapshot
- CSV/PDF exportは後続判断

### Cell D: Content Freshness Score

目的:

運用の良し悪しをプロダクト上で可視化する。

範囲:

- stale playlist detection
- unchanged campaign days
- recommended refresh date
- management dashboard warning

## 判断メモ

Misellの広告事業は、最初からWalmart Connectのような巨大媒体を目指すのではなく、施設内にある画面を「検証可能な小さな広告枠」として育てる。

最初の勝ち筋は、インプレッション規模ではなく、購買直前/滞在中の導線とQR/クーポン/注文の実測である。広告主へ渡す価値は「見られたかもしれない」ではなく、「いつ、どの画面で、何回流れ、どれだけ反応があったか」を継続判断できる形で返すことにある。
