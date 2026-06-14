# 75. 代理店・紹介・元請/下請チャネル設計仕様

## 目的

このドキュメントは、Misellを直販だけでなく、紹介会社、販売代理店、元請会社、施工協力会社、複数社が間に入る案件でも運用できるようにするためのチャネル設計を定義する。

3連サイネージは、機器・施工・CMS・保守・広告運用が絡むため、案件によって以下のような構造になる。

- 直販
- 紹介のみ
- 販売代理店経由
- 元請会社経由
- 施工会社経由
- 広告代理店経由
- 会場/施設運営会社経由
- 複数社が間に入る商流

このとき、価格、責任範囲、顧客窓口、請求先、保守対応、紹介料/代理店手数料が曖昧だと事故る。

## 基本方針

Misellは、商流に関係なく以下を守る。

1. 顧客への品質責任を曖昧にしない
2. 標準価格を崩さない
3. 代理店手数料を粗利内で吸収しすぎない
4. 保守窓口を明確にする
5. 施工責任とCMS運用責任を分ける
6. 誰が顧客窓口かを案件ごとに固定する
7. 複数社が挟まる場合は、価格表を表向きと社内原価で分ける

## チャネル種別

| 種別 | 役割 | 報酬 | 顧客窓口 | 備考 |
| --- | --- | --- | --- | --- |
| Referral Partner | 紹介のみ | 紹介料 | Misell | 最も安全 |
| Sales Agent | 商談同席/営業支援 | 成約手数料 | Misellまたは代理店 | 案件管理が必要 |
| Reseller | 再販売 | 卸値/代理店価格 | 代理店 | 顧客契約先が代理店になる可能性 |
| Prime Contractor | 元請 | 元請マージン | 元請 | Misellは下請/提供元 |
| Installation Partner | 施工協力会社 | 施工費 | Misell | 品質管理が重要 |
| Advertising Partner | 広告販売代理 | 広告売上手数料 | 代理店またはMisell | Mediaプラン向け |
| Venue Partner | 会場/施設紹介 | 紹介料またはレベニューシェア | 案件ごと | ビジョンセンター等を想定 |

## 推奨する優先順位

初期は以下の順で進める。

1. Referral Partner
2. Installation Partner
3. Sales Agent
4. Venue Partner
5. Advertising Partner
6. Reseller
7. Prime Contractor

理由:

- 紹介のみが最も事故りにくい
- 施工協力会社はスケールに必須
- 再販売/元請構造は価格・責任・保守が複雑になるため、後から整備する

## 標準手数料の考え方

### 紹介料

紹介のみの場合。

推奨:

```text
初期粗利の10〜15%
または
初期売上の3〜5%
または
月額1〜3か月分
```

初期は分かりやすく、以下を標準にする。

| 案件種別 | 紹介料案 |
| --- | --- |
| Lite | 成約時 3万円〜5万円 |
| Standard Purchase | 初期売上の5% または固定5万〜10万円 |
| Standard Rental | 初期売上の5% + 月額1か月分 |
| Media | 初期売上の5% + 広告運用粗利の一部 |
| AI Edge/Premium | 個別設定 |

### 販売代理店手数料

営業活動を代理店が担う場合。

推奨:

```text
初期売上の10〜15%
または
粗利の20〜30%
```

過去判断として、10%では弱く、15%前提で見る方が現実的。

### 月額レベニューシェア

月額の一部を継続支払いする場合。

推奨:

```text
月額粗利の10〜20%
または
月額売上の5〜10%
期間は12か月までを原則
```

注意:

- 永続コミッションにしない
- MRRの価値を削りすぎない
- 解約時は支払い終了
- 未払い月は支払わない

### 広告販売手数料

広告主を代理店が獲得する場合。

推奨:

```text
広告売上の20〜40%
```

役割により変える。

| 役割 | 手数料目安 |
| --- | ---: |
| 広告主紹介のみ | 10〜15% |
| 広告営業・契約まで | 20〜30% |
| 広告主対応・素材回収・更新まで | 30〜40% |

## 商流パターン

## Pattern A: 直販

```text
顧客 → Misell/IYASAKA
```

- 契約: 顧客とMisell/IYASAKA
- 請求: Misell/IYASAKAから顧客
- 保守窓口: Misell/IYASAKA
- 価格: 標準価格

最もシンプル。

## Pattern B: 紹介のみ

```text
紹介者 → Misell/IYASAKA → 顧客
```

- 契約: 顧客とMisell/IYASAKA
- 請求: Misell/IYASAKAから顧客
- 紹介者: 成約時紹介料
- 保守窓口: Misell/IYASAKA

推奨パターン。

## Pattern C: 販売代理店同席

```text
代理店 + Misell/IYASAKA → 顧客
```

- 契約: 原則 顧客とMisell/IYASAKA
- 代理店: 営業支援/同席
- 報酬: 成約手数料
- 保守窓口: Misell/IYASAKA

初期に扱いやすい。

## Pattern D: 代理店再販売

```text
Misell/IYASAKA → 代理店 → 顧客
```

- 契約: 代理店と顧客
- Misell契約: Misell/IYASAKAと代理店
- 請求: Misell/IYASAKAから代理店
- 顧客窓口: 代理店
- 保守: 一次窓口は代理店、二次対応はMisell

注意:

- 顧客情報が見えにくくなる
- 保守責任が曖昧になりやすい
- 値引きされやすい
- ブランド表記を決める必要がある

## Pattern E: 元請/下請

```text
顧客 → 元請 → Misell/IYASAKA → 施工協力会社
```

- 契約: 顧客と元請
- Misell契約: 元請とMisell/IYASAKA
- 請求: Misell/IYASAKAから元請
- 保守窓口: 契約上は元請、技術対応はMisell

注意:

- 元請マージンが乗る
- 顧客への価格が見えにくい
- 追加見積の承認が遅れる
- 検収責任を明確にする

## Pattern F: 施工会社経由

```text
施工会社 → Misell/IYASAKA → 顧客
```

または

```text
顧客 → Misell/IYASAKA → 施工会社
```

2パターンある。

推奨は後者。

- Misellが顧客契約を持つ
- 施工会社は協力会社として使う
- 施工品質はMisellが検収する

## 複数社が挟まる場合のルール

複数社が入る場合、案件登録時に以下を必ず記録する。

- 顧客契約先
- 請求先
- 一次窓口
- 技術窓口
- 保守窓口
- 施工責任者
- 紹介者
- 代理店
- 元請
- 下請
- 手数料対象者
- 手数料率
- 手数料支払期間

## 価格設計ルール

### 標準価格を基準にする

代理店が入っても、顧客向け標準価格を崩さない。

```text
顧客向け価格 = 標準価格
代理店報酬 = 社内粗利/販売管理費から支払う
```

ただし、代理店が元請/再販売する場合は、代理店向け卸価格を別途設定する。

### 代理店が入る場合の価格余白

Misellの標準価格には、以下の余白を持たせる。

- 紹介料 5%
- 販売代理店手数料 10〜15%
- 施工管理費
- 保守対応費
- 予備費

### 値引きルール

代理店が入っている案件で値引きする場合、原則として以下の順で調整する。

1. 標準外オプションを削る
2. 月額範囲を削る
3. 代理店手数料を調整する
4. Misell粗利を削るのは最後

## 顧客窓口ルール

案件ごとに、顧客に対する一次窓口を1つだけ決める。

| パターン | 一次窓口 | 二次窓口 |
| --- | --- | --- |
| 直販 | Misell | 施工協力会社 |
| 紹介 | Misell | 紹介者は原則関与しない |
| 販売代理 | Misellまたは代理店 | 事前に固定 |
| 再販売 | 代理店 | Misellは技術二次対応 |
| 元請 | 元請 | Misellは技術二次対応 |
| 施工協力 | Misell | 施工会社 |

## 保守責任ルール

### Misellが直接契約する場合

- Misellが保守責任を持つ
- 施工会社は作業委託
- 顧客への説明はMisellが行う

### 代理店再販売の場合

- 一次保守窓口は代理店
- 技術二次対応はMisell
- 代理店が顧客に誤説明しないようFAQ/運用マニュアルを提供

### 元請案件の場合

- 契約上の保守窓口は元請
- Misellは元請からの依頼で対応
- 顧客直接対応する場合は、元請承認を得る

## パートナー管理データモデル

### partners

```sql
CREATE TABLE partners (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  partner_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  default_commission_type TEXT,
  default_commission_rate NUMERIC,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

partner_type:

- referral
- sales_agent
- reseller
- prime_contractor
- installation_partner
- advertising_partner
- venue_partner

### deal_partners

```sql
CREATE TABLE deal_partners (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  partner_id UUID NOT NULL REFERENCES partners(id),
  role TEXT NOT NULL,
  commission_type TEXT,
  commission_rate NUMERIC,
  commission_amount INTEGER,
  commission_months INTEGER,
  is_primary_contact BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

role:

- referrer
- sales_agent
- reseller
- prime
- installer
- ad_sales
- venue

### partner_commissions

```sql
CREATE TABLE partner_commissions (
  id UUID PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES partners(id),
  order_id UUID,
  contract_id UUID,
  invoice_id UUID,
  commission_type TEXT NOT NULL,
  base_amount INTEGER NOT NULL,
  commission_rate NUMERIC,
  commission_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payable_at DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

status:

- pending
- approved
- payable
- paid
- cancelled

## 案件登録時の必須項目

案件にパートナーが関わる場合、以下を必須にする。

- partner_id
- partner role
- 顧客契約先
- 請求先
- 一次窓口
- 手数料条件
- 手数料支払タイミング
- 保守窓口

## 手数料支払タイミング

原則:

```text
Misellが顧客/元請/代理店から入金確認後に支払う
```

未入金の場合、パートナー手数料は支払わない。

月額レベニューシェアの場合、該当月の入金確認後に支払う。

## パートナー向け資料

必要な資料:

- パートナー向け1枚資料
- 紹介トークスクリプト
- NG説明集
- 標準価格表
- 標準施工範囲
- 別見積範囲
- よくある質問
- 事例資料
- デモ動画

## NGルール

パートナーに禁止すること。

- 広告収益を保証すること
- AIカメラで個人を特定できると説明すること
- 標準外工事を標準内と説明すること
- 無断値引き
- Misellの保守範囲を超えた約束
- 顧客情報の無断利用
- 競合排除を無断で約束すること

## 実装優先順位

Phase 1:

- partnersテーブル
- deal_partnersテーブル
- 案件に紹介者/代理店/施工会社を紐づける
- 手数料条件を記録する
- 一次窓口を記録する

Phase 2:

- partner_commissionsテーブル
- 入金後の手数料計算
- 支払予定一覧
- パートナー別案件一覧

Phase 3:

- パートナー専用ポータル
- 案件登録フォーム
- 紹介URL/トラッキング
- パートナー向け資料ダウンロード
- パートナーランク制度

## Codex向けプロンプト

```text
Implement Misell partner and channel management Phase 1.

Read docs/75_PARTNER_RESELLER_CHANNEL_STRATEGY_SPEC.md first.

Goal:
Allow Misell admins to register partners, attach partners to orders/contracts, record partner roles, contact responsibility, and commission terms.

Rules:
- Every partner deal must record customer contract party, billing party, primary customer contact, support contact, and commission terms.
- Partner commission is only payable after Misell receives payment.
- Partner roles include referral, sales_agent, reseller, prime_contractor, installation_partner, advertising_partner, venue_partner.
- Do not implement automatic commission payout in Phase 1.

Phase 1 scope:
1. partners table
2. deal_partners table
3. Admin CRUD for partners
4. Attach partners to orders
5. Store commission terms
6. Store primary contact/support responsibility
```

## 更新日

2026-06-15
