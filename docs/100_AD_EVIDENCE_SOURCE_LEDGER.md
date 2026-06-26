# 100. 広告実績ストーリー出典台帳

## 目的

この文書は、Misell Mediaの営業資料、媒体資料、LP、提案書で実名企業・実数値のストーリーを使う前に、出典確認状態を管理する台帳である。

Misellは「計測できる施設内メディア」を目指すが、外部事例を根拠に強い営業表現を作る場合、出典が曖昧なまま実名・数値を使ってはならない。

## 基本ルール

- `external_ok=true` の行だけが、外部向け資料へ利用できる。
- `external_ok=false` の行は、内部検討、設計背景、営業仮説の材料に限定する。
- `source_url` が空、または `source_status=pending_verification` の行は外部利用不可。
- 実名・数値を使う場合は、数値の分母、期間、地域、媒体、引用先を崩さない。
- Misellの成果として誤認させない。外部事例は「市場構造の参考」であり、「Misell導入成果」ではない。
- `docs/99_AD_LEGAL_PRIVACY_GATE_SPEC.md` の claim class、measurement label、source ledger gate と整合させる。

## 台帳フィールド

| Field | 意味 |
| --- | --- |
| `story_id` | 台帳内の安定ID |
| `company` | 実名企業、業態、または事例名 |
| `claim` | 使いたい主張の短文 |
| `number` | 数値。未確認なら空にする |
| `source_url` | 一次または信頼できる二次出典URL |
| `source_type` | `primary`, `credible_secondary`, `vendor_blog`, `research_summary`, `unknown` |
| `source_status` | `verified`, `pending_verification`, `conflicting`, `rejected` |
| `checked_at` | 最終確認日 |
| `external_ok` | 外部利用可否 |
| `allowed_usage` | `external_sales`, `external_media_kit`, `internal_only`, `rejected` |
| `notes` | 制約、言い換え、使用禁止表現 |

## 現在の出典台帳

現時点では、以下の候補をすべて `external_ok=false` として扱う。外部利用する前に、一次または信頼できる二次出典を確認し、別PRで `source_url`、`checked_at`、`source_status=verified`、`external_ok=true` へ更新する。

| story_id | company | claim | number | source_url | source_type | source_status | checked_at | external_ok | allowed_usage | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `regional-grocer-screen-ad-revenue` | 28店舗規模の地域スーパー事例 | 店舗内画面広告で収益化したとされる事例 | 約480,000 USD |  | unknown | pending_verification |  | false | internal_only | 中小施設でも画面を広告媒体化できる仮説。出典確認まで外部提案不可。 |
| `home-depot-retail-media-roas` | Home Depot retail media事例 | 広告主側のROAS、流入、conversion改善とされる事例 | ROAS 2倍超、増分トラフィック1.5倍、conversion率26%向上 |  | unknown | pending_verification |  | false | internal_only | 数値の期間、対象、出典、測定方法を確認するまで外部利用不可。 |
| `walmart-connect-scale` | Walmart Connect | 小売/施設内メディアが大きな広告事業になり得る構造例 | 2024年 44億 USD規模とされる |  | unknown | pending_verification |  | false | internal_only | Misellの実績ではない。市場構造説明に限定し、出典確認まで外部利用不可。 |
| `mcdonalds-menu-board-value-perception` | McDonald's menu board事例 | メニューボードが価値認識に大きく影響するという文脈 |  |  | unknown | pending_verification |  | false | internal_only | 言い換え時にMcDonald'sの発言趣旨を誇張しない。 |
| `qsr-menu-board-upsell` | QSR digital menu board事例 | デジタルメニュー/高輝度メニューがアップセルや売上改善に寄与するとされる事例 |  |  | unknown | pending_verification |  | false | internal_only | 業態、調査条件、対象メニューを確認するまで外部利用不可。 |
| `dwell-time-10s-purchase-lift` | dwell time research候補 | 滞在時間を伸ばすと購買反応が上がるとされる事例 | 10秒延長、店内購入23%増とされる |  | unknown | pending_verification |  | false | internal_only | 出典、調査主体、再引用元を確認するまで外部利用不可。 |
| `content-fatigue-40-decay` | content freshness research候補 | 同じコンテンツの繰り返しでengagementが低下するとされる事例 | 最大40%低下とされる |  | unknown | pending_verification |  | false | internal_only | Misellの効果として使わない。更新運用の設計背景に限定。 |
| `content-mix-40-50-10` | signage content mix候補 | 常時表示、定期差替、リアルタイム連動の比率目安 | 40% / 50% / 10% とされる |  | unknown | pending_verification |  | false | internal_only | 固定ルールではなく運用設計の参考値。 |

## 外部利用前チェック

外部資料に実名・数値を入れるPRでは、最低限以下を満たす。

- [ ] 台帳の `source_url` が一次または信頼できる二次出典である。
- [ ] `checked_at` が入っている。
- [ ] `source_status=verified` である。
- [ ] `external_ok=true` である。
- [ ] 引用する数値の期間、対象、分母、地域、測定方法が資料内で誤解なく扱われている。
- [ ] `docs/99_AD_LEGAL_PRIVACY_GATE_SPEC.md` の `claim_class` と `measurement_label` に反していない。
- [ ] 「Misell導入で同じ成果が出る」と読める表現にしていない。

## 推奨表現

出典確認前:

- 「施設内メディアの参考事例として、海外では収益化・広告主効果の報告例がある」
- 「Misellでは、まず放映証跡、QR反応、クーポン/注文を計測し、小さく検証する」

出典確認後でも避ける表現:

- 「Misellで売上が上がる」
- 「ROASを保証する」
- 「この事例と同じ成果が出る」
- 「増分効果が出る」

## 後続

1. 出典確認PRで、各storyの `source_url` と `checked_at` を埋める。
2. 外部資料に入れるstoryだけ `external_ok=true` へ変更する。
3. 媒体資料やLPで使用する文言は、docs/99のlegal/privacy/ad-review gateに通す。
