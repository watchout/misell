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

```text
朝食100円OFF        50%
売店ドリンク無料     10%
次回予約5%OFF       40%

合計                100%
ハズレ              0%
```

### 抽選方式

MVPではパーセント方式を採用する。

- `probability_percent` は0より大きく100以下
- ガチャ単位で合計100以下
- 合計100未満の残余はハズレ
- 抽選ログにはハズレも記録する

将来、重み方式へ移行してもよいが、管理画面では店舗側が理解しやすいパーセント表示を優先する。

## ハズレ表示設定

ハズレは景品マスタではなく、ガチャキャンペーン側に表示設定を持つ。

```text
gacha_campaigns
- lose_title
- lose_message
- lose_cta_label
- lose_cta_url
```

例:

```text
lose_title: 残念！
lose_message: 今回はハズレです。LINE登録で次回もう一度チャレンジできます。
lose_cta_label: LINE登録する
lose_cta_url: https://example.com/line
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

例:

- ドリンク1杯無料
- 売店ミニ商品プレゼント
- ノベルティ引換
- 朝食券プレゼント

処理:

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

例:

- 朝食100円OFFで購入
- レイトチェックアウト申込
- レストラン予約
- 売店商品取り置き

処理:

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
3. 抽選
4. couponなら `coupon_issue` 作成
5. productなら `product_claim` 作成
6. loseならログのみ作成
7. `gacha_draws` と `action_events` に記録

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
13. ガチャ抽選
14. coupon当選時の `coupon_issue` 作成
15. product当選時の `product_claim` 作成
16. ハズレログ記録
17. ミニカート
18. 注文/予約送信
19. 店頭管理画面で注文確認
20. 簡易サマリー集計

### 実装しない

- オンライン決済
- POS連携
- LINEログイン
- 会員認証
- 請求書発行
- 領収書発行
- 返金処理
- 景品表示法の自動判定
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
- coupon景品当選時にcoupon_issueが作成される
- product景品当選時にproduct_claimが作成される
- ハズレ時にgacha_draws/action_eventsへloseが記録される
- クーポン利用済み処理が二重利用を防ぐ
- 注文/予約送信が管理画面に表示される

## Codex実装指示メモ

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
- coupon当選時は coupon_issue を作成
- product当選時は product_claim を作成
- lose時は prize_id null / result_type lose でログ保存

会計仕様:
- 決済連携なし
- 注文/予約を管理画面で確認
- payment_method は onsite / room_charge / front / store
- payment_status は unpaid / paid / room_charged / canceled
```
