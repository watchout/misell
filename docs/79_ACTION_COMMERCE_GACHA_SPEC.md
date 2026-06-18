# 79. Action Commerce / サイネージ限定ガチャ 実装仕様

## 目的

このドキュメントは、Misellを「見せるサイネージ」から「行動・販売・予約までつなげるサイネージ」へ拡張するための実装仕様である。

既存のQR生成、QRログ、Media広告配信、Proof of Play、レポート機能と統合し、以下をMVPとして実装できる粒度まで落とし込む。

- QR機能
- クーポン機能
- 販売/商品機能
- サイネージ限定ガチャ機能
- ミニカート/注文・予約管理
- 店頭管理画面での会計確認
- Action Eventsによる効果測定

オンライン決済はMVPでは実装しない。会計は店頭/フロント/部屋付け/現地精算として管理画面で確認する。

ただし、ガチャ、クーポン、商品注文、予約、部屋番号、氏名、電話番号、メールアドレスを扱うため、本仕様は `needs:legal-privacy` および `route:ceo-approval` の対象とする。実装着手前に、本ドキュメントのLegal/Privacy Gateを満たすこと。

## Phase位置づけ / doc-tree

本仕様は `docs/` 配下のプロダクト仕様であり、既存の以下ドキュメントを拡張する。

- `docs/65_QR_GENERATION_GUIDE.md`
- `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md`
- `docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md`

`cloud-main/docs/` 側へ分岐した仕様がある場合は、本仕様を正とし、重複仕様は後続PRで `docs/` 配下へ統合する。

Phase上の位置づけは以下。

| Phase | 位置づけ | 内容 |
| --- | --- | --- |
| Phase 0 | 現行MVP | 3連表示、LAN更新、ローカル継続再生、監視 |
| Phase 1 | QR/Media | QR生成、QRログ、広告配信、Proof of Play |
| Phase 2 | Action Commerce MVP | クーポン、商品LP、ガチャ、ミニカート、店頭確認 |
| Phase 3 | Commerce拡張 | 決済、POS/LINE/ホテルシステム連携 |

本PRはPhase 2の仕様追加であり、実装PRではない。

## Gate / Governance

### 実装前必須Gate

Action Commerceは、単なるサイネージ表示機能ではなく、景品、個人情報、注文/予約、会計確認に関わる。

そのため、以下を満たすまで実装着手しない。

| Gate | 内容 | 判定 |
| --- | --- | --- |
| Legal Gate | 景品表示法、特定商取引法、業種別規制、施設運用ルールの確認 | `needs:legal-privacy` |
| Privacy Gate | APPI/個人情報保護、取得項目、利用目的、保持期間、削除、アクセス権限の確認 | `needs:legal-privacy` |
| CEO Scope Gate | サイネージから注文/予約/会計確認へ拡張する戦略判断 | `route:ceo-approval` |
| Integrity Gate | 抽選整合性、在庫、最大当選数、冪等性、参加制限のテスト定義 | required |
| CI Gate | 既存CIとauditをgreenにする。既存脆弱性は別PRで解消する | required |

### CI / audit運用

本PRは仕様書追加のみであり、runtime codeは変更しない。

ただし、Layer 0として既存CIと `npm audit` がredの場合、Action Commerce実装PRへ進まない。既存依存脆弱性が本PR起因でない場合でも、別PRで修正し、green化してから実装PRを切る。

### Codex/実装指示の扱い

本ドキュメント末尾に実装メモを置く場合でも、Codexまたは開発担当者は、Legal Gate、Privacy Gate、CEO Scope Gateを通過するまで実装してはならない。

実装指示メモは設計補助であり、承認フローをバイパスするものではない。

## 既存仕様との関係

### 既存QR機能との統合

`docs/65_QR_GENERATION_GUIDE.md` では、QRは `campaign_id` と `qr_id` を持ち、広告、商品、案内ごとの計測軸として使う方針である。

Action Commerceではこの前提を維持する。

- QRは入口である
- `qr_id` はQR単位の計測キーである
- `campaign_id` は広告/商品/クーポン/ガチャ/案内導線を束ねるキーである
- QR着地ページは `/a/:qr_id` とする
- QR読取、ガチャ参加、クーポン取得、商品閲覧、カート投入、注文送信はAction Eventsへ記録する

### Media広告配信との統合

`docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md` では、広告主、キャンペーン、Creative、Placement、Proof of Play、QR反応をMediaプランの価値として定義している。

Action CommerceはMedia機能を置き換えない。Mediaの上に「行動導線」を追加する。

- 広告素材からQRへ誘導できる
- QRからクーポン/ガチャ/商品ページへ遷移できる
- 広告主レポートにQR反応だけでなく、クーポン取得数、クーポン利用数、商品閲覧数、注文/予約数を追加できる
- 協賛広告の成果報告に利用できる

### レポート機能との統合

`docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md` のQR反応レポートを拡張し、Action Commerceでは以下を追加集計する。

- QR読取数
- ガチャ参加数
- 当選数
- ハズレ数
- クーポン発行数
- クーポン利用数
- 商品閲覧数
- カート投入数
- 注文/予約送信数
- 注文/予約完了数
- 商品別反応
- 時間帯別反応
- 店舗別反応

## 商品コンセプト

### Misell Action Commerce

サイネージからQRで来店客をスマホへ誘導し、クーポン、ガチャ、商品LP、ミニカート、注文/予約までつなげる販促導線機能。

### Misell Action Gacha

登録済みクーポン、登録済み商品を景品として選択し、出現割合を設定できるサイネージ限定ガチャ機能。

合計確率が100%未満の場合、残りは自動的にハズレとして扱う。

## Legal / Privacy Spec

### 景品表示法リスク

サイネージ限定ガチャ、クーポン、商品引換、無料特典は、日本では景品表示法上の「景品類」に該当する可能性がある。

特に、来店者、購入者、予約者、サービス利用者を対象に、抽選、偶然性、先着、全員付与等で経済上の利益を提供する場合は、懸賞または総付景品としての確認が必要である。

本機能は、景品表示法の適合性を自動判定しない。実施責任は運用者にある。ただし、システムは運用者が法務確認しやすいよう、景品価額、懸賞種別、売上予定総額、提供上限数を入力・記録できる予約フィールドを持つ。

### 景品法務メタデータ

以下を `gacha_campaigns` または関連するlegal metadataとして保持する。

```text
gacha_campaigns
- legal_review_status: not_required / pending / approved / rejected
- legal_reviewed_at
- legal_reviewer
- promotion_type: unknown / general_lottery / joint_lottery / total_premium / open_campaign / non_premium
- transaction_value_yen
- expected_sales_yen
- max_prize_value_yen
- total_prize_budget_yen
- operator_responsible_party
- legal_notes
```

### 景品登録時の予約フィールド

クーポン、商品、商品引換券には以下を持たせる。

```text
coupons / products / product_claim_prizes
- prize_value_yen
- cost_basis_yen
- is_premium_candidate
- legal_notes
```

`prize_value_yen` は、景品表示法上の景品価額判断に使う。MVPでは自動判定しないが、未入力のままガチャに紐づける場合は管理画面で警告する。

### 運用者責任の明示

管理画面のガチャ公開前確認で、以下の確認チェックを必須にする。

```text
[ ] 景品表示法・業種別規制・施設ルールを確認した
[ ] 景品価額・提供総額・当選上限を確認した
[ ] 必要に応じて法務/責任者承認を取得した
[ ] 表示文言、当選条件、利用条件、期限を確認した
```

MVPではこのチェックをログとして残す。

```text
promotion_approvals
- approval_id
- campaign_id
- approved_by
- approved_at
- checklist_json
- notes
```

### 個人情報 / APPI

注文/予約では、氏名、部屋番号、電話番号、メールアドレス等を扱う可能性がある。これらは個人情報または個人関連情報に該当し得るため、利用目的、保存期間、削除、アクセス制御、監査ログを定義する。

MVPでは以下を必須とする。

1. 注文/予約フォームに利用目的を表示する
2. 取得項目を必要最小限にする
3. 保持期間を設定する
4. 管理画面で削除/匿名化できる
5. 管理画面アクセスはBasic認証だけでなく、将来的なRBAC対象とする
6. 注文/予約データの閲覧・更新・削除を監査ログに記録する

### PII保持・削除ポリシー

```text
privacy_policy
- default_order_retention_days: 90
- default_action_event_retention_days: 365
- anonymize_after_fulfilled_days: 30
- delete_after_retention_days: 90
```

MVPでは自動削除ジョブはPhase 2でもよい。ただし、データモデルと管理操作には削除/匿名化の概念を入れる。

```text
orders
- pii_deleted_at
- pii_deleted_by
- anonymized_at
- privacy_notes
```

### 注文/予約で取得する情報

MVPでは、注文種別ごとに必要最小限の項目のみを使う。

| 用途 | 推奨項目 | 注意 |
| --- | --- | --- |
| ホテル部屋付け | 部屋番号、名前、受取時間 | 部屋番号だけで本人確認しない |
| 店頭取り置き | 名前、電話番号、受取時間 | 電話番号は任意から開始可能 |
| メール通知 | メールアドレス | 必須にしない設計を優先 |
| レストラン予約 | 名前、人数、時間、連絡先 | 店舗運用に合わせる |

### 特定商取引法 / 通信販売表示

オンライン決済をMVPで実装しない場合でも、サイネージQRから商品LP、注文、予約、申込を受ける場合、表示事項の整理が必要になる可能性がある。

MVPでは、商品LPに以下の表示領域を持つ。

```text
product_compliance_display
- seller_name
- store_name
- price_display
- tax_display
- payment_method_display
- delivery_or_pickup_timing
- cancellation_policy
- contact_display
- terms_url
```

本機能は特定商取引法の自動判定を行わない。運用者が商品/サービスごとに表示事項を確認する。

## 機能構成

```text
QR機能
├── QR作成
├── QR着地ページ
├── QR読取ログ
└── campaign_id / qr_id 紐付け

クーポン機能
├── クーポン登録
├── クーポン発行
├── クーポン取得
├── 店頭提示
└── 利用済み処理

販売/商品機能
├── 商品登録
├── 商品LP
├── 商品引換券
├── ミニカート
├── 注文/予約送信
└── 店頭会計確認

ガチャ機能
├── ガチャ作成
├── 景品設定
├── 出現割合設定
├── 自動ハズレ補完
├── 抽選ログ
├── クーポン発行
└── 商品引換券発行
```

## ユーザーフロー

### 1. QRクーポン

```text
サイネージ右面にQR表示
↓
来店客がQRを読み取る
↓
/a/:qr_id にアクセス
↓
クーポンページ表示
↓
クーポン取得
↓
店頭で提示
↓
スタッフが管理画面/PINで利用済みにする
```

### 2. サイネージ限定ガチャ

```text
サイネージ右面に「サイネージ限定ガチャ」QR表示
↓
来店客がQRを読み取る
↓
/a/:qr_id にアクセス
↓
ガチャページ表示
↓
抽選
↓
結果
├── クーポン当選: coupon_issue を作成
├── 商品当選: product_claim を作成
└── ハズレ: lose result を記録
↓
クーポン提示 / 商品引換 / 商品購入・予約導線へ
```

### 3. 商品/ミニカート

```text
サイネージで商品訴求
↓
QRから商品LPへ
↓
商品をカートに入れる
↓
名前/部屋番号/受取時間/連絡先を入力
↓
注文/予約送信
↓
店頭管理画面に新規注文として表示
↓
スタッフが提供・会計・部屋付け等を処理
↓
注文ステータスを完了へ変更
```

## ガチャ景品仕様

### 景品タイプ

ガチャ景品は以下の2種類を明示登録できる。

| type | 内容 | 当選時の処理 |
| --- | --- | --- |
| coupon | 登録済みクーポン | `coupon_issue` を作成 |
| product | 登録済み商品 | `product_claim` を作成 |

ハズレは景品マスタには明示登録しない。

### 自動ハズレ仕様

登録済み景品の出現割合合計によって、ハズレを自動判定する。

| 景品合計 | 挙動 |
| ---: | --- |
| 100%未満 | 残りを自動でハズレにする |
| 100% | ハズレなし |
| 100%超過 | 保存不可。バリデーションエラー |

例:

```text
朝食100円OFF        50%
売店ドリンク無料     10%
次回予約5%OFF       30%

合計                90%
ハズレ              10% 自動
```

ハズレなしにしたい場合は、登録景品の合計を100%にする。

### 抽選方式

MVPではパーセント方式を採用する。

- `probability_percent` は0より大きく100以下
- ガチャ単位で合計100以下
- 合計100未満の残余はハズレ
- 抽選ログにはハズレも記録する

## 抽選整合性 / Edge Case

### 参加制限

MVPの参加制限は `user_token` に依存する。ただし、cookie削除、別端末利用、ブラウザ変更で回避され得る。

MVPでは以下を仕様として受容し、追加緩和策を実装する。

- `user_token` はcookie/localStorageで発行する
- `qr_id + gacha_id + user_token` で参加制限する
- 任意でIP/UA hashを補助キーとして保存する
- 厳密な本人認証はMVPでは実装しない
- 管理画面に「MVP参加制限は完全な不正防止ではない」と表示する

将来対応:

- LINE連携
- SMS認証
- 宿泊予約番号連携
- 会員ID連携

### 最大当選数到達時

景品ごとに `max_wins` を持てる。

抽選時、`current_wins >= max_wins` の景品は抽選対象から除外する。

除外された景品の確率質量は、MVPでは自動的にハズレへ移す。その他景品へ再配分しない。

理由:

- 管理者が設定した確率を勝手に上げない
- 景品価額/提供総額管理を単純にする
- 「売り切れたらハズレが増える」という運用説明がしやすい

### 在庫0の扱い

`product` 景品は、`stock_quantity <= 0` の場合、抽選対象から除外する。

除外された確率質量は自動的にハズレへ移す。

在庫0景品が存在する場合、管理画面には警告を表示する。

### 抽選冪等性

ガチャ抽選APIは冪等性キーを受け付ける。

```text
POST /api/action/gachas/:gacha_id/draw
Header: Idempotency-Key: <client-generated-key>
```

同一 `gacha_id + user_token + idempotency_key` のリクエストは、同じ `gacha_draw` を返す。

リロード、二重タップ、通信再送で二重抽選されないようにする。

```text
gacha_draws
- idempotency_key
- unique(gacha_id, user_token, idempotency_key)
```

### 抽選処理の順序

```text
1. gacha_id を取得
2. campaign状態・期間を確認
3. user_token と参加制限を確認
4. idempotency_key の既存drawを確認
5. 有効景品だけを抽出
6. max_wins / stock_quantity を満たさない景品を除外
7. 残り景品の確率合計を計算
8. 合計が100超なら設定エラー
9. 合計100未満の残余をハズレとして扱う
10. 抽選
11. couponならcoupon_issue作成
12. productならproduct_claim作成
13. loseならログのみ
14. gacha_draws / action_events に記録
```

## ハズレ表示設定

ハズレは景品マスタではなく、ガチャキャンペーン側に表示設定を持つ。

```text
gacha_campaigns
- lose_title
- lose_message
- lose_cta_label
- lose_cta_url
```

ハズレでも完全離脱させず、LINE登録、通常クーポン、商品ページ、アンケートなどへ誘導できるようにする。

## クーポン機能

### クーポン登録項目

```text
coupons
- coupon_id
- tenant_id
- store_id
- title
- description
- discount_type: amount / percent / free_item / custom
- discount_value
- display_text
- prize_value_yen
- usage_limit
- per_user_limit
- starts_at
- expires_at
- status: draft / active / paused / ended
- created_at
- updated_at
```

### クーポン発行

ガチャ当選またはQRクーポンページでクーポンを取得したとき、`coupon_issues` を作成する。

```text
coupon_issues
- issue_id
- coupon_id
- campaign_id
- qr_id
- user_token
- issued_at
- used_at
- used_store_id
- used_by_staff
- status: issued / used / expired / canceled
```

### 利用済み処理

MVPでは以下の2方式を実装する。

1. 店頭提示型
   - ユーザーがスマホ画面を提示
   - スタッフが管理画面で利用済みにする

2. PIN入力型
   - スタッフ用PINを入力すると利用済みになる
   - 不正利用を軽減する

QR読み取り消し込み、POS連携はPhase 2以降とする。

## 販売/商品機能

### 商品登録項目

```text
products
- product_id
- tenant_id
- store_id
- name
- description
- price
- tax_type
- image_url
- stock_quantity
- prize_value_yen
- product_type: sale / reservation / claim / inquiry
- fulfillment_type: onsite / front / room_charge / pickup
- starts_at
- ends_at
- status: draft / active / paused / ended
- created_at
- updated_at
```

### 商品景品の扱い

商品がガチャ景品として当選した場合、MVPでは `product_claim` を発行する。

```text
product_claims
- claim_id
- product_id
- campaign_id
- gacha_draw_id
- qr_id
- user_token
- issued_at
- redeemed_at
- redeemed_store_id
- redeemed_by_staff
- status: issued / redeemed / expired / canceled
```

商品景品には2種類ある。

#### 無料引換型

```text
商品当選
↓
product_claim 発行
↓
店頭で提示
↓
スタッフが引換済みにする
```

#### 購入/予約導線型

```text
商品当選
↓
商品LPへ誘導
↓
ミニカート/申込フォーム
↓
店頭管理画面で確認
↓
現地精算/部屋付け/フロント精算
```

## ミニカート/注文・予約管理

### carts

```text
carts
- cart_id
- tenant_id
- store_id
- user_token
- status: active / submitted / abandoned / canceled
- created_at
- updated_at
```

### cart_items

```text
cart_items
- cart_item_id
- cart_id
- product_id
- quantity
- unit_price
- created_at
```

### orders

```text
orders
- order_id
- tenant_id
- store_id
- user_token
- cart_id
- order_type: purchase / reservation / claim / inquiry
- customer_name
- room_number
- phone
- email
- pickup_time
- total_amount
- payment_method: onsite / room_charge / front / store
- payment_status: unpaid / paid / room_charged / canceled
- fulfillment_status: new / confirmed / fulfilled / canceled
- staff_note
- pii_deleted_at
- pii_deleted_by
- anonymized_at
- privacy_notes
- created_at
- updated_at
```

MVPでは決済は処理しない。

店頭/フロントの管理画面で注文・予約を確認し、現地精算、部屋付け、フロント精算、店頭支払いを行う。

## Action Events

すべての行動を `action_events` に記録する。

```text
action_events
- event_id
- event_type
- tenant_id
- store_id
- device_id
- campaign_id
- qr_id
- user_token
- related_type
- related_id
- metadata_json
- created_at
```

### event_type

```text
qr_scan
gacha_view
gacha_draw
gacha_win_coupon
gacha_win_product
gacha_lose
coupon_view
coupon_issue
coupon_use
product_view
product_claim_issue
product_claim_redeem
cart_create
add_to_cart
order_submit
order_confirm
order_fulfill
order_cancel
order_pii_delete
```

## Public API / Landing

### QR着地

```text
GET /a/:qr_id
```

処理:

1. `qr_id` を解決
2. QR scan eventを記録
3. 紐づくAction Campaignを判定
4. typeに応じてガチャ/クーポン/商品/案内ページを表示

### ガチャ実行

```text
POST /api/action/gachas/:gacha_id/draw
```

処理:

1. 参加回数制限を確認
2. 景品合計が100以下であることを確認
3. 最大当選数/在庫0景品を除外
4. 除外された確率質量をハズレへ移す
5. 冪等性キーを確認
6. 抽選
7. couponなら `coupon_issue` 作成
8. productなら `product_claim` 作成
9. loseならログのみ作成
10. `gacha_draws` と `action_events` に記録

### クーポン利用

```text
POST /api/action/coupon-issues/:issue_id/use
```

MVPでは管理画面またはPIN認証で利用済みにする。

### 注文/予約送信

```text
POST /api/action/orders
```

MVPでは支払い処理を行わず、店頭確認用の注文/予約データを作成する。

## Admin API

```text
GET    /api/admin/action/summary

GET    /api/admin/coupons
POST   /api/admin/coupons
PATCH  /api/admin/coupons/:coupon_id

GET    /api/admin/products
POST   /api/admin/products
PATCH  /api/admin/products/:product_id

GET    /api/admin/gachas
POST   /api/admin/gachas
PATCH  /api/admin/gachas/:gacha_id

GET    /api/admin/gachas/:gacha_id/prizes
POST   /api/admin/gachas/:gacha_id/prizes
PATCH  /api/admin/gacha-prizes/:prize_id
DELETE /api/admin/gacha-prizes/:prize_id

GET    /api/admin/orders
PATCH  /api/admin/orders/:order_id
POST   /api/admin/orders/:order_id/anonymize
POST   /api/admin/orders/:order_id/delete-pii

POST   /api/admin/coupon-issues/:issue_id/use
POST   /api/admin/product-claims/:claim_id/redeem
```

## 管理画面メニュー

```text
Misell Studio
├── ダッシュボード
├── 素材
├── レイアウト
├── スケジュール
├── 端末管理
├── レポート
├── 広告管理
└── Action Commerce
    ├── サマリー
    ├── QR導線
    ├── クーポン
    ├── 商品
    ├── ガチャ
    ├── 注文/予約
    └── 利用/引換ログ
```

## ガチャ管理画面

### 基本情報

- ガチャ名
- 開催期間
- 対象店舗
- 対象QR
- 1ユーザーあたり参加回数
- 1日あたり参加回数
- ステータス
- ハズレ時メッセージ
- ハズレ時CTA
- 景品法務メタデータ
- 法務/責任者承認チェック

### 景品設定

景品タイプ:

- クーポン
- 商品

入力項目:

- 登録済みクーポン選択、または登録済み商品選択
- 表示名
- 出現割合
- 最大当選数
- 有効/無効
- 景品価額

### 確率表示

管理画面では必ず以下を表示する。

```text
登録景品合計: 90%
自動ハズレ: 10%
```

100%超過時:

```text
登録景品合計: 110%
エラー: 出現割合の合計が100%を超えています。
```

最大当選数到達または在庫0で除外された場合:

```text
登録景品合計: 90%
除外景品: 売店ドリンク無料 10%（在庫0）
抽選対象景品合計: 80%
自動ハズレ: 20%
```

## 店頭会計確認

### 方針

オンライン決済はMVPに入れない。

注文/予約/引換は、店頭またはフロントの管理画面で確認し、以下の方法で処理する。

- 現地精算
- フロント精算
- 部屋付け
- 店頭支払い
- 引換のみ

### 管理画面の注文ステータス

```text
new
confirmed
fulfilled
canceled
```

### 支払いステータス

```text
unpaid
paid
room_charged
canceled
```

## MVP実装範囲

### 実装する

1. QR着地ページ `/a/:qr_id`
2. Action Events記録
3. クーポン登録
4. クーポン取得
5. クーポン利用済み処理
6. 商品登録
7. 商品LP
8. ガチャ作成
9. ガチャ景品としてクーポン/商品を選択
10. 出現割合設定
11. 100%未満時の自動ハズレ
12. 100%超過時の保存エラー
13. 最大当選数/在庫0時の自動ハズレ再配分
14. ガチャ抽選の冪等性
15. coupon当選時の `coupon_issue` 作成
16. product当選時の `product_claim` 作成
17. ハズレログ記録
18. ミニカート
19. 注文/予約送信
20. 店頭管理画面で注文確認
21. PII削除/匿名化操作
22. 法務/責任者承認チェックログ
23. 簡易サマリー集計

### 実装しない

- オンライン決済
- POS連携
- LINEログイン
- 会員認証
- 請求書発行
- 領収書発行
- 返金処理
- 景品表示法の自動判定
- 特定商取引法の自動判定
- 複雑な在庫引当
- 多店舗横断の高度な広告在庫管理

## CI / QA

実装時は既存CIを壊さない。

```bash
npm run check:player
npm run validate:playlist
npm run check:cloud
npm run check:shell
npm run test:e2e
```

Action Commerce追加時は以下のテストを追加する。

- ガチャ景品合計100%未満で自動ハズレが発生する
- ガチャ景品合計100%でハズレが発生しない
- ガチャ景品合計100%超過で保存不可
- max_wins到達景品が抽選対象から除外され、確率質量がハズレへ移る
- stock_quantity 0 のproduct景品が抽選対象から除外され、確率質量がハズレへ移る
- coupon景品当選時にcoupon_issueが作成される
- product景品当選時にproduct_claimが作成される
- ハズレ時にgacha_draws/action_eventsへloseが記録される
- 同一Idempotency-Keyで二重抽選されない
- user_token参加制限が動作する
- クーポン利用済み処理が二重利用を防ぐ
- 注文/予約送信が管理画面に表示される
- 注文PIIを削除/匿名化できる
- 法務/責任者承認チェックがないガチャは公開できない

## 公式情報メモ

本仕様の法務メタデータは、以下の公開一次情報を参照して設計した。以下は参考情報であり、最終判断は運用者・法務責任者が行う。

- 消費者庁「景品規制の概要」
  - https://www.caa.go.jp/policies/policy/representation/fair_labeling/premium_regulation/
  - 景品類は、顧客誘引、取引付随、経済上の利益として定義される。
  - 一般懸賞は、5,000円未満の場合は取引価額の20倍、5,000円以上の場合は10万円、総額は懸賞に係る売上予定総額の2%。
  - 共同懸賞は、取引価額にかかわらず最高額30万円、総額は懸賞に係る売上予定総額の3%。
  - 総付景品は、取引価額1,000円未満の場合は200円、1,000円以上の場合は取引価額の10分の2。
- 個人情報保護委員会「法令・ガイドライン等」
  - https://www.ppc.go.jp/personalinfo/legal/
  - 個人情報保護法、政令、規則、ガイドライン確認の一次情報として扱う。
- 消費者庁「特定商取引法ガイド 通信販売」
  - https://www.no-trouble.caa.go.jp/what/mailorder/
  - 商品LP、注文、予約、申込を扱う場合の表示事項確認に使う。

## 実装メモ（Gate通過後のみ有効）

以下は、Legal Gate、Privacy Gate、CEO Scope Gate、Integrity Gate、CI Gateを通過した後にのみ有効な実装メモである。

```text
watchout/misell の apps/cloud に Misell Action Commerce MVP を追加する。

目的:
サイネージQRから、クーポン取得、ガチャ参加、商品LP、ミニカート、注文/予約送信、店頭管理画面での確認までを実装する。
オンライン決済は実装しない。

既存方針:
- Express + better-sqlite3 の既存 apps/cloud に追加
- 既存の campaign_id / qr_id / QR生成 / QRイベント / Mediaレポート設計と整合させる
- 管理APIと管理UIは既存admin Basic認証配下
- public landing は /a/:qr_id
- SQLiteでよい
- 既存 test:ci を壊さない

ガチャ仕様:
- 景品タイプは coupon / product
- ハズレは景品マスタに登録しない
- 登録景品の確率合計が100%未満なら残りを自動ハズレ
- 合計100%ならハズレなし
- 合計100%超過なら保存不可
- max_wins到達/在庫0景品は抽選対象から除外し、その確率質量はハズレへ移す
- coupon当選時は coupon_issue を作成
- product当選時は product_claim を作成
- lose時は prize_id null / result_type lose でログ保存
- 同一Idempotency-Keyでは同じdrawを返す

会計仕様:
- 決済連携なし
- 注文/予約を管理画面で確認
- payment_method は onsite / room_charge / front / store
- payment_status は unpaid / paid / room_charged / canceled
```
