# 74. 請求・決済・支払い管理ポータル設計仕様

## 目的

このドキュメントは、Misellの初期費用、月額費用、Stripe決済、請求書払い、管理画面上の支払い管理を定義する。

`docs/72_CONTRACT_BILLING_AND_RENTAL_ASSET_SPEC.md` で定義した契約・レンタル資産管理に対し、本資料では請求・決済・顧客ポータルに特化する。

## 決定事項

| 論点 | 決定 |
| --- | --- |
| 初期費用 | 着手時50%、施工完了時50%を標準にする |
| 月額費用 | 顧客が支払い方法を選択できるようにする |
| 月額決済 | Stripeを基本対応する。ただし法人請求書払いも選択可能 |
| 管理画面 | 支払い方法、請求書、契約状況、支払い履歴を管理画面から完結できるようにする |
| 月額開始 | 検収完了日の翌日から発生 |
| 検収 | 電子署名またはメール承認で可 |

## 基本方針

初期費用と月額費用は分けて管理する。

- 初期費用: 機器、施工、初期設定、キッティング、現調原価を回収するための費用
- 月額費用: CMS、端末レンタル、監視、保守、更新、レポートを回収するための費用

初期費用は金額が大きくなるため、原則として銀行振込/請求書払いを基本にする。

月額費用は継続課金であるため、Stripeを導入して自動課金に対応する。ただし、法人顧客では請求書払いを選択できるようにする。

## 初期費用の請求ルール

### 標準

```text
契約・着手時: 初期費用の50%
施工完了時: 初期費用の50%
```

### 着手金の意味

着手金は以下のために使う。

- 機器手配
- モニター手配
- 金具/部材手配
- キッティング準備
- 施工手配
- 社内初期作業

### 施工完了時の残金

施工完了後、検収前または検収完了時に残額50%を請求する。

運用上は以下のどちらかを案件ごとに選ぶ。

| タイミング | 適用ケース |
| --- | --- |
| 施工完了時請求 | 標準 |
| 検収完了時請求 | 顧客承認フローが重い法人 |

### 高額/フルレンタル時

Standard Rental、AI Edge、PremiumなどMisell側の先行原価が大きい案件では、以下を選択可能にする。

- 契約時50%、施工完了時50%
- 契約時70%、施工完了時30%
- 契約時一括前払い

判断基準:

- 機器原価が大きい
- 顧客与信が低い
- 納期が短く先行手配が必要
- 特注金具や特殊施工がある

## 月額費用の請求ルール

### 発生日

月額費用は、検収完了日の翌日から発生する。

例:

```text
6月15日 検収完了
6月16日 月額利用開始
```

### 初月

初月は日割りを基本にする。

```text
初月日割り = 月額費用 × 利用開始日から月末までの日数 / 当月日数
```

ただし、営業判断で初月無料や翌月開始にする場合は、契約に明記する。

### 翌月以降

月額費用は以下のどちらかを顧客が選択できる。

| 支払い方法 | 内容 | 主な対象 |
| --- | --- | --- |
| Stripe自動課金 | 毎月自動決済 | 小規模店舗、Lite、Standard |
| 請求書払い | 月末締め翌月末払い等 | 法人、施設、本部契約 |

## Stripe導入方針

### Stripeで扱うもの

- 月額利用料
- 端末レンタル料
- CMS/監視/保守費
- 小額オプション
- 月次更新追加
- QR/LP追加
- レポート強化オプション

### Stripeで原則扱わないもの

- 高額な初期費用
- 大型機器一式費用
- 施工費
- 高額な特注工事

理由:

- カード手数料が重くなる
- 法人経理では銀行振込が好まれる
- 高額案件では与信/契約管理が必要

### Stripe Customer

tenantごとにStripe Customerを紐づける。

管理項目:

- stripe_customer_id
- default_payment_method
- billing_email
- invoice_settings
- subscription_id
- payment_status

### Stripe Subscription

月額契約はStripe Subscriptionで管理する。

対象:

- Lite
- Standard Purchase
- Standard Rental
- Media
- AI Edge
- Premium

ただし、請求書払い顧客はStripe Subscriptionを使わず、社内invoice管理で対応できるようにする。

## 管理画面で完結させる範囲

顧客管理画面に「契約・請求」メニューを追加する。

```text
Misell Studio
└── 契約・請求
    ├── 契約情報
    ├── 支払い方法
    ├── 請求書
    ├── 支払い履歴
    ├── レンタル機器
    └── 解約/変更申請
```

## 顧客向け 契約情報画面

表示項目:

- 契約プラン
- 契約開始日
- 最低契約期間
- 契約終了予定日
- 月額費用
- 初期費用
- 支払い方法
- 月額開始日
- レンタル対象機器
- 中途解約条件の概要

## 支払い方法画面

顧客が選択できる支払い方法:

- クレジットカード/Stripe
- 請求書払い

### Stripe選択時

機能:

- カード登録
- カード変更
- 支払い失敗時の再決済
- 領収書/請求書ダウンロード

Stripe Customer Portalを使うか、自社UIからStripe Checkout/Setup Intentへ遷移する。

### 請求書払い選択時

表示:

- 請求先会社名
- 請求先担当者
- 請求先メール
- 締日
- 支払期日
- 振込先

請求書払いは、管理者承認制にする。

## 請求書画面

表示項目:

- 請求番号
- 対象期間
- 請求種別
- 金額
- 消費税
- 合計
- 支払期日
- ステータス
- PDFダウンロード

invoice status:

- draft
- issued
- paid
- overdue
- cancelled

請求種別:

- initial_deposit
- initial_balance
- monthly
- option
- repair
- cancellation_fee

## 支払い履歴画面

表示項目:

- 支払日
- 金額
- 支払い方法
- 対象請求書
- ステータス
- 領収書URL

## レンタル機器画面

表示項目:

- 機器種別
- 型番
- シリアル
- 設置場所
- 契約ID
- ステータス
- 返却対象かどうか

## 解約/変更申請

Phase 1ではフォームだけでよい。

入力項目:

- 申請種別: plan_change / cancellation / payment_method_change / billing_info_change
- 希望日
- 理由
- メモ

解約時には、自動で概算精算額を表示できるようにする。

Phase 2以降で、中途解約精算額・返却機器一覧・撤去費見積へ接続する。

## 社内管理画面

社内向けに以下を管理する。

- 契約一覧
- 請求一覧
- Stripe連携状態
- 未払い一覧
- 督促対象
- 着手金未入金案件
- 施工完了後残金未請求案件
- 月額開始待ち案件
- 請求書払い承認待ち

## データモデル案

### contracts 追加項目

```sql
ALTER TABLE contracts ADD COLUMN initial_fee_total INTEGER DEFAULT 0;
ALTER TABLE contracts ADD COLUMN initial_deposit_rate INTEGER DEFAULT 50;
ALTER TABLE contracts ADD COLUMN initial_deposit_amount INTEGER DEFAULT 0;
ALTER TABLE contracts ADD COLUMN initial_balance_amount INTEGER DEFAULT 0;
ALTER TABLE contracts ADD COLUMN monthly_start_date DATE;
ALTER TABLE contracts ADD COLUMN billing_method TEXT DEFAULT 'stripe';
ALTER TABLE contracts ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE contracts ADD COLUMN stripe_subscription_id TEXT;
```

billing_method:

- stripe
- invoice
- bank_transfer

### invoices 追加項目

```sql
ALTER TABLE invoices ADD COLUMN invoice_type TEXT DEFAULT 'monthly';
ALTER TABLE invoices ADD COLUMN stripe_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN payment_method TEXT;
ALTER TABLE invoices ADD COLUMN pdf_url TEXT;
ALTER TABLE invoices ADD COLUMN issued_at TIMESTAMPTZ;
```

invoice_type:

- initial_deposit
- initial_balance
- monthly
- option
- repair
- cancellation_fee

### payments

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID REFERENCES contracts(id),
  invoice_id UUID REFERENCES invoices(id),
  amount INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

payment_status:

- pending
- succeeded
- failed
- refunded
- cancelled

### billing_preferences

```sql
CREATE TABLE billing_preferences (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  billing_method TEXT NOT NULL DEFAULT 'stripe',
  billing_email TEXT,
  billing_company_name TEXT,
  billing_contact_name TEXT,
  closing_day INTEGER,
  payment_due_day INTEGER,
  stripe_customer_id TEXT,
  invoice_payment_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## API案

### 顧客向け

```http
GET  /api/customer/billing/contract
GET  /api/customer/billing/invoices
GET  /api/customer/billing/invoices/:id
GET  /api/customer/billing/payments
GET  /api/customer/billing/rental-assets
POST /api/customer/billing/payment-method/stripe-setup
POST /api/customer/billing/payment-method/request-invoice
POST /api/customer/billing/change-request
```

### 社内向け

```http
GET  /api/admin/billing/contracts
GET  /api/admin/billing/invoices
POST /api/admin/billing/invoices/generate-initial-deposit
POST /api/admin/billing/invoices/generate-initial-balance
POST /api/admin/billing/invoices/generate-monthly
POST /api/admin/billing/invoices/:id/mark-paid
POST /api/admin/billing/invoices/:id/cancel
POST /api/admin/billing/preferences/:tenant_id/approve-invoice-payment
```

### Stripe Webhook

```http
POST /api/webhooks/stripe
```

処理対象イベント:

- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.paid
- invoice.payment_failed
- payment_intent.succeeded
- payment_intent.payment_failed

## 請求フロー

## 初期費用

```text
契約成立
↓
初期費用50%の請求書発行
↓
入金確認
↓
機器手配/キッティング/施工準備
↓
施工完了
↓
初期費用残50%の請求書発行
↓
検収完了
↓
月額開始日の確定
```

## 月額費用 Stripe

```text
検収完了
↓
monthly_start_date = 検収完了日の翌日
↓
Stripe Customer作成/紐づけ
↓
Subscription開始
↓
初月日割り
↓
翌月以降自動課金
```

## 月額費用 請求書払い

```text
検収完了
↓
monthly_start_date = 検収完了日の翌日
↓
初月日割り請求書作成
↓
翌月以降、月末締め/翌月末払い等で請求
```

## 未払い対応

| 段階 | 条件 | 対応 |
| --- | --- | --- |
| 1 | 支払期日超過 | 自動通知 |
| 2 | 一定期間超過 | 管理画面に警告表示 |
| 3 | 長期未払い | 更新機能制限 |
| 4 | さらに未払い | 配信停止を検討 |
| 5 | 解消しない | 契約解除・機器回収・未回収分請求 |

緊急案内用途や施設運用に重大影響がある場合、配信停止は社内承認制にする。

## 実装優先順位

### Phase 1

- 初期費用50/50の請求管理
- 月額開始日の保持
- 支払い方法選択
- 請求書一覧
- 支払い履歴
- Stripe Customer作成
- Stripe Setup Intent
- 請求書払い申請

### Phase 2

- Stripe Subscription連携
- Stripe Webhook処理
- 月次請求自動生成
- 初月日割り
- PDF請求書
- 管理画面でカード変更

### Phase 3

- Stripe Customer Portal連携
- 自動督促
- 解約精算額自動計算
- 返却機器一覧連携
- 会計ソフト連携

## QAチェックリスト

### 初期費用

- 初期費用50%の請求を作れる
- 残50%の請求を作れる
- 契約ごとに50/50以外も設定できる
- 着手金未入金案件を一覧できる
- 施工完了後の残金未請求案件を一覧できる

### 月額

- 検収完了日の翌日がmonthly_start_dateになる
- 初月日割りを計算できる
- Stripe支払い方法を登録できる
- 請求書払いを申請できる
- 請求書払いは社内承認後に有効化される

### 管理画面

- 顧客が契約情報を見られる
- 顧客が請求書を見られる
- 顧客が支払い履歴を見られる
- 顧客がレンタル機器を見られる
- 顧客が支払い方法を変更できる

### Stripe

- Stripe customerを作成できる
- Setup Intentでカード登録できる
- Webhookで支払い成功を反映できる
- Webhookで支払い失敗を反映できる

## Codex向けプロンプト

```text
Implement Misell Billing Payment Portal Phase 1.

Read docs/72_CONTRACT_BILLING_AND_RENTAL_ASSET_SPEC.md and docs/74_BILLING_PAYMENT_PORTAL_SPEC.md first.

Rules:
- Initial fee is split 50% at project start and 50% at installation completion by default.
- Monthly fee starts the day after acceptance completion.
- Customers can choose Stripe automatic payment or invoice payment.
- Invoice payment requires internal approval.
- Customer billing portal should show contract info, invoices, payment history, rental assets, and payment method.
- Phase 1 should not implement full accounting integration.

Phase 1 scope:
1. Contract billing fields
2. Invoice type support: initial_deposit, initial_balance, monthly
3. Payment records
4. Billing preferences
5. Customer billing portal read screens
6. Stripe Setup Intent endpoint
7. Invoice payment request flow
8. Admin approval for invoice payment
```

## 更新日

2026-06-15
