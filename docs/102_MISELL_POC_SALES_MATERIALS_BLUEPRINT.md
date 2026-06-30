# 102. Misell POC Sales Materials Blueprint

## Purpose

This document is the current source-bound blueprint for creating the `materials/poc_70_limited/` sales package for the Misell 30-day media partner offer.

It replaces the stale PR #194 draft path `docs/97_MISELL_POC_70_LIMITED_SALES_MATERIALS_BLUEPRINT.md`, because doc 97 is now reserved for Shirube V3 overlay material.

## Source Priority

Use these sources in this order:

1. `docs/78_FINAL_30DAY_IMPACT_OFFER_AND_PROPOSAL_STRATEGY.md`
2. `docs/77_POC_PARTNER_PRICING_AND_BUYOUT_STRATEGY.md`
3. `docs/60_TEST_INTRO_PROPOSAL_DECK.md`
4. `docs/61_CUSTOMER_PRICING_TABLE.md`
5. `docs/62_MISELL_MEDIA_KIT.md`
6. `docs/63_TEST_INTRO_AGREEMENT_TEMPLATE.md`
7. `docs/98_AD_OPERATION_ROI_STORY_AND_MEASUREMENT_CONCEPTS.md`
8. `docs/99_AD_LEGAL_PRIVACY_GATE_SPEC.md`
9. `docs/100_AD_EVIDENCE_SOURCE_LEDGER.md`
10. GitHub issue #116

## Frozen Offer Fields

| Field | Approved wording |
| --- | --- |
| External offer name | Misell 30日メディア化パートナー制度 |
| Main headline | 施設の“見られる場所”を、30日でインパクトある3連訴求面へ。 |
| Normal price | 初期398,000円 / 月額39,800円 |
| POC partner price | 初期150,000円 / 月額19,800円 |
| Tax | 価格は税別 |
| CTA | 無料診断 / 設置場所診断 |
| Guarantee | 30日立ち上げ保証 |

## Guarantee Boundary

Guarantee only the operational launch state:

```text
必要素材・QR誘導先URL・接続環境が揃った日を起点として、30日以内に初期配信環境を立ち上げます。

当社都合により、30日以内に「自社更新・QR計測・3連表示」が可能な状態を提供できなかった場合、翌月の月額利用料を無料とします。
```

Do not guarantee sales, traffic, ad revenue, QR scans, ROAS, impressions, viewer count, or incremental lift.

## POC Package Scope

Included:

- 導入ヒアリング
- Misell Studioアカウント発行
- POC用配信端末の初期設定
- 3連表示初期設定
- 初期テンプレート設定
- 初回素材登録サポート
- QRコード初期設定
- テスト配信
- 操作説明

Monthly includes:

- Misell Studio利用
- POC用配信端末レンタル
- 顧客セルフ更新機能
- スケジュール配信
- 3連表示
- 簡易死活監視
- 簡易再生ログ
- QRクリック確認
- ソフトウェア更新
- メール/チャットサポート

Not included:

- モニター本体
- 壁掛け金具/天吊り金具
- 電源工事
- LAN配線工事
- 下地補強
- 現地施工
- 現地訪問サポート
- コンテンツ制作
- 動画編集
- 素材更新代行
- 詳細月次レポート作成
- 広告主向けレポート
- 現地駆けつけ保守
- AIカメラ/AI分析

## 70 Facility Slots

| Category | Slots |
| --- | ---: |
| ホテル・宿泊施設 | 20 |
| カラオケ・エンタメ | 10 |
| ジム・温浴・サウナ | 10 |
| 貸会議室・イベント会場 | 10 |
| 飲食・小売 | 10 |
| クリニック・待合 | 10 |
| その他業種 | 応相談 |

Use category slots in sales material. Do not over-index on "70 facilities" without explaining the partner conditions.

## Measurement And Claim Guard

Allowed:

- 放映回数、QR反応、クーポン/注文などMisellレール内の値を計測できる
- QR導線の反応を確認できる
- 放映ログとQR反応を見ながら次回の表示改善につなげる
- 初期は想定表示回数と反応計測から小さく始める

Required labels:

- `measured`: Misell playlog / QR / coupon / order rails
- `estimated`: external data, advertiser-reported value, or assumptions
- `incremental`: only with accepted holdout/baseline evidence

Forbidden:

- 売上が上がります
- 集客が増えます
- QR読み取り数が増えます
- 広告収益が出ます
- 必ず広告主がつきます
- 視認者数を保証します
- インプレッションを保証します
- ROASを保証します
- 日本初 / 唯一など確認不能な最上級表現

## Material Set

Output directory: `materials/poc_70_limited/`

| File | Purpose |
| --- | --- |
| `README.md` | Usage order and gating notes |
| `01_lp_wireframe.md` | LP copy/wireframe |
| `02_one_page_sales_sheet.md` | One-page sales sheet |
| `03_poc_partner_proposal_deck.md` | 14-slide proposal deck script |
| `04_industry_mockup_briefs.md` | Industry mockup production briefs |
| `05_60sec_demo_video_script.md` | 60-second demo video script |
| `06_discovery_sheet.md` | Sales discovery sheet |
| `07_poc_agreement_draft.md` | Non-legal agreement draft |
| `08_media_kit.md` | Misell Media starter media kit |
| `09_70_facility_pipeline_tracker.csv` | Internal pipeline tracker |
| `10_outbound_scripts.md` | Email/DM/call scripts |
| `11_partner_referral_sheet.md` | Referral/partner sheet |
| `12_faq_objection_handling.md` | FAQ and objection handling |

## Approval-Gated Fields

The following require owner/legal review before customer distribution:

- final price quotation and discounts
- guarantee language
- contract/agreement use
- public LP publication
- external proof, source stories, logos, case studies
- advertising/media kit claims
- medical, financial, recruitment, health/beauty, investment, alcohol, or regulated category material

## Copy Fidelity Check

Status: PASS for source-bound draft materials.

Checked sources:

- `docs/77_POC_PARTNER_PRICING_AND_BUYOUT_STRATEGY.md`
- `docs/78_FINAL_30DAY_IMPACT_OFFER_AND_PROPOSAL_STRATEGY.md`
- `docs/62_MISELL_MEDIA_KIT.md`
- `docs/98_AD_OPERATION_ROI_STORY_AND_MEASUREMENT_CONCEPTS.md`
- `docs/99_AD_LEGAL_PRIVACY_GATE_SPEC.md`

Known limits:

- These are markdown/source materials, not designed slide exports.
- Canva/PDF export is not requested in this Cell.
- Customer distribution is not authorized by this document.
