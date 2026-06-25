# 99. 広告法務・プライバシーGATE仕様

## 目的

この文書は、Misellの広告・協賛・広告主レポートを拡張する前に必要な、法務・プライバシー・広告審査GATEの要件を固定する。

これは法的助言ではない。規制の適用可否、文言の可否、個人情報/個人関連情報の扱い、業種別審査の最終判断は、有資格の法務/コンプライアンス/広告審査担当が確定する。

このPRはruntime enforcementを入れない。DB、API、Player、Admin UI、advertiser UI、publish path、billing、保証文言、外部AI、カメラ、POS、ad networkには接続しない。

## 適用タイミング

以下のいずれかを実装または運用開始する前に、このGATEの実装版と人間レビューを通す。

| Trigger | 必要な扱い |
| --- | --- |
| 広告主/代理店向け外部レポートを出す | scope分離、集計のみ、ROIラベル、文言審査 |
| 広告主セルフサービスを開く | advertiser identity、campaign scope、素材審査、公開前承認 |
| 医療/金融/求人/美容/健康/投資/酒類/年齢制限商品を扱う | regulated categoryとしてhuman legal/ad review必須 |
| 効果効能、比較優良、実績保証、ROAS保証、増分効果を表現する | claim class分類とlegal sign-off必須 |
| カメラ、属性推定、行動推定、個人情報/個人関連情報を扱う | 別protected gateまでblock |
| 外部ad network、外部計測タグ、POS連携、CRM連携を入れる | privacy/data-source review必須 |
| 出典付き実名事例/数値を営業資料や媒体資料で使う | source ledger確認必須 |

## MVPの基本境界

MVPの広告計測は以下をデフォルトにする。

- no-PII
- no-camera
- no-sensitive-profiling
- no-cross-site tracking
- no external ad network
- no external AI decision authority
- measured-not-promised

Misellが実測と呼べるのは、Misellのレール内で取得した放映、QR、クーポン、カウンター注文、管理画面上の操作証跡に限る。外部POS、来店者数、広告主申告売上、推定来店、推定視認人数は、データ源とラベルを分ける。

## 分類軸

GATEは、LLMの自由判断ではなく、中央管理されたpolicy/configと決定的な分類関数で判定する。

| Field | 値の例 | 用途 |
| --- | --- | --- |
| `industry_category` | `general`, `medical`, `finance`, `recruiting`, `beauty_health`, `alcohol`, `age_restricted`, `investment`, `other_regulated` | 業種審査 |
| `claim_class` | `informational`, `price_offer`, `comparative`, `performance_claim`, `guaranteed_outcome`, `incremental_claim`, `health_or_effect_claim` | 文言審査 |
| `privacy_class` | `no_pii`, `aggregated_only`, `pii_consented`, `camera_or_biometric`, `sensitive_profiling` | プライバシー審査 |
| `data_source_class` | `misell_playlog`, `misell_qr`, `misell_coupon`, `misell_order`, `advertiser_supplied`, `pos_external`, `camera`, `ad_network` | データ源審査 |
| `measurement_label` | `measured`, `estimated`, `incremental` | ROI誇大表示防止 |
| `review_status` | `draft`, `needs_review`, `approved`, `changes_required`, `rejected`, `expired`, `revoked`, `deleted` | gate状態 |

新しい値を追加する場合は、ソースコードに散らさず、DBまたは最小のpolicy/configに集約する。重複した判定ロジックを作らない。

## 必須GATE record

実装時のgate recordは、最低限以下を持つ。

| Field | 必須 | 説明 |
| --- | --- | --- |
| `gate_record_id` | yes | immutable id |
| `tenant_id` | yes | tenant scope |
| `store_id` | conditional | store scope。store未指定の全体審査なら空にできる |
| `screen_group_id` | conditional | screen group scope |
| `advertiser_id` | conditional | 広告主scope |
| `campaign_id` | conditional | campaign scope |
| `creative_id` | conditional | creative scope |
| `report_surface_id` | conditional | advertiser reportなど外部表示scope |
| `industry_category` | yes | 業種分類 |
| `claim_class` | yes | 文言分類 |
| `privacy_class` | yes | privacy分類 |
| `data_source_classes` | yes | 使用するデータ源 |
| `measurement_labels` | yes | 表示するROIラベル |
| `review_status` | yes | draft/needs_review/approved等 |
| `verdict` | yes | `allow`, `allow_with_conditions`, `block`, `human_review_required` |
| `reviewer_role` | conditional | legal/privacy/ad-review等 |
| `reviewer_user_id` | conditional | review実施者 |
| `legal_signoff_ref` | conditional | GitHub comment、契約、審査記録など |
| `conditions_json` | conditional | 表示制約、文言制約、期間制約 |
| `expires_at` | conditional | 審査期限 |
| `revoked_at` | no | revocation evidence |
| `deleted_at` | no | soft delete。物理削除しない |
| `created_at` / `updated_at` | yes | audit timestamp |

gate recordはsoft deleteを基本にする。外部広告や審査証跡は、後から説明責任が必要になるため、物理削除を前提にしない。

## 自動判定と人間レビュー

自動判定でできるのは、分類、明らかなblock、明らかなhuman review requiredの振り分けまでである。

自動で通せる候補:

- `industry_category=general`
- `claim_class=informational` または `price_offer`
- `privacy_class=no_pii` または `aggregated_only`
- `data_source_classes` がMisell playlog/QR/coupon/orderに閉じる
- `measurement_label=measured` のみ
- 実名事例/数値を外部表示しない

人間レビュー必須:

- regulated category
- `performance_claim`
- `comparative`
- `incremental_claim`
- `health_or_effect_claim`
- `privacy_class=pii_consented`
- 外部POS、広告主申告売上、外部ad network
- 実名企業/実数値を外部資料へ掲載する場合

block:

- `guaranteed_outcome`
- ROAS保証、売上保証、効果保証
- baseline/holdoutなしのincremental claim
- `privacy_class=camera_or_biometric`
- `privacy_class=sensitive_profiling`
- legal sign-offなしのregulated category公開
- 出典台帳なしの実名/数値外部利用

## レポート文言の境界

広告主レポートや媒体資料では、数値に必ずラベルを付ける。

| Label | 使ってよい表現 | 禁止 |
| --- | --- | --- |
| measured | Misell上で計測したQR反応、放映回数、注文発行数 | 純増、売上保証、来店保証 |
| estimated | 推定、試算、広告主申告、POS外データ | 実測、確定成果 |
| incremental | holdout/baseline比較に基づく増分 | 比較設計なしの増分断定 |

`qr_scan_count` は反応証跡であり、購買やROI attributionではない。`qr_response_rate` は分母を明記し、視認率や来店率として扱わない。

## LLMと決定権限

LLMは、広告審査、法務判断、privacy判定、公開可否、claim可否の最終決定者ではない。

LLMを使う場合も、できることは下書き、要約、候補抽出、レビュー支援までに限定する。最終状態は、決定的なpolicy/config、reviewer、sign-off evidence、audit logで決まる。

## 既存/後続cellとの接続

| Cell | 接続 |
| --- | --- |
| Cell A Proof of Play | no-PIIのmeasured evidenceとして扱う |
| Cell C Advertiser Report | 外部表示前にscope、label、wording、regulated categoryをGATEする |
| Cell D Freshness | host向け運用品質指標。広告効果保証に転用しない |
| incremental ROI | holdout/baseline設計とlegal wording確認が必要 |
| media kit / sales material | source ledgerとclaim class確認が必要 |

## 受入基準

- [ ] この文書は法的助言ではないことを明記している。
- [ ] runtime enforcement、DB、API、UI、publish、billing、外部連携をこのPRで入れない。
- [ ] GATE triggerが広告主外部表示、regulated category、claim、PII/camera、外部データ源を含む。
- [ ] 分類軸がdeterministic policy/configで扱える粒度になっている。
- [ ] gate recordにscope、reviewer、sign-off、expiry、revocation、soft deleteが含まれる。
- [ ] no-PII/no-camera/no-sensitive-profilingがMVP defaultになっている。
- [ ] guaranteed outcome、ROAS保証、baseline/holdoutなしのincremental claimを禁止している。
- [ ] LLMが最終決定者ではない。

## 後続

1. legal/privacy/ad-review担当が本仕様をレビューし、実装版のpolicy/config値を確定する。
2. advertiser report surfaceを作る前に、scope分離、集計のみ、label必須、wording gateを接続する。
3. カメラ/属性推定/外部ad network/POS連携は、別protected cellとして扱う。
