# 72. 契約・請求・レンタル資産管理 設計仕様

## 目的

このドキュメントは、Misellの料金プラン、レンタル資産、最低契約期間、中途解約条件、請求、機器回収に関する基本設計を定義する。

端末やモニターをレンタルにする場合、契約条件と資産管理が曖昧だと、途中解約、未払い、破損、返却不能、撤去費で赤字化する。したがって、プロダクト実装・営業資料・契約書・請求運用の前提として本仕様を置く。

## 決定事項

### レンタル資産の基本方針

| 商品 | レンタル対象 | 方針 |
| --- | --- | --- |
| Lite | 端末のみ | 既存モニター/小規模/PoC後の低価格継続向け |
| Standard Purchase | 端末のみ | 標準商品。モニター/金具/施工は初期費用で回収 |
| Standard Rental | モニター + 端末 | USEN対抗。フルレンタル型。審査付き |
| Media | 端末のみ or モニター込み選択 | 広告運用向け。案件規模に応じて選択 |
| AI Edge | 端末 + AIカメラ | 上位アップセル。AI機器はレンタル管理 |
| Premium | BrightSign/高信頼端末 | 大手/高信頼案件向け |

標準商品は、端末のみレンタルを基本にする。

モニター込みフルレンタルは、初期費用を抑えたい顧客やUSEN対抗時に使うが、審査付き・長期契約前提にする。

## プラン別契約期間

| 商品 | 最低契約期間 | 理由 |
| --- | ---: | --- |
| Lite | 12か月 | 低価格・既存モニター活用・PoC後導入向け |
| Standard Purchase | 24か月 | モニター/施工は初期回収、端末と運用費を月額回収 |
| Standard Rental | 36か月 | モニター・端末・施工費の回収が必要 |
| Media | 24〜36か月 | 広告運用範囲と機器レンタル範囲により決定 |
| AI Edge | 36か月 | AI端末/AIカメラの原価と運用負荷が高い |
| Premium | 36か月 | BrightSign等の高額端末を回収するため |

## 中途解約条件

### Lite

端末のみレンタル。顧客の既存モニターまたは別途購入モニターを使う前提。

中途解約精算:

```text
残契約月数 × 月額利用料の50%
または
端末未回収相当額
のいずれか高い方
```

### Standard Purchase

モニター、金具、標準施工は初期費用で回収。端末のみレンタル。

中途解約精算:

```text
残契約月数 × 月額利用料の50%
または
端末未回収相当額
のいずれか高い方
```

### Standard Rental / AI Edge / Premium

機器原価が大きい。モニター、端末、AIカメラ、高信頼端末をMisell/IYASAKA側が保有する。

中途解約精算:

```text
残契約月数 × 月額利用料
または
未回収機器原価 + 撤去費
のいずれか高い方
```

### Media

Mediaは案件ごとに2系統に分ける。

- 端末のみレンタル型: Standard Purchaseと同等
- モニター込みレンタル型: Standard Rentalと同等

広告運用契約を含む場合、広告主対応やレポート作成工数を別途考慮する。

## プラン別の含まれる範囲

## Lite

### 位置づけ

- PoC後の低価格継続
- 小規模施設向け
- 既存モニター活用
- 最小構成の3連表示

### 含めるもの

- 端末レンタル
- Misell Player
- LAN/クラウド簡易管理
- 3連表示
- 基本テンプレート
- 月1回程度の素材差し替え
- 簡易死活確認
- メール/チャットサポート

### 含めないもの

- モニター込みレンタル
- 広告主レポート
- Proof of Play
- 詳細月次レポート
- AI分析
- 優先保守
- 現地駆けつけ
- 高度なレイアウト編集
- 複数店舗管理

## Standard Purchase

### 位置づけ

Misellの標準商品。

### 初期費用に含めるもの

- モニター販売
- 金具販売
- 標準施工
- ケーブル/部材
- 端末キッティング
- 初期設定
- 初期表示確認
- 操作説明

### 月額に含めるもの

- 端末レンタル
- CMS利用
- 死活監視
- 軽微な素材更新
- 一次保守
- 簡易レポート

## Standard Rental

### 位置づけ

USEN対抗のフルレンタル型。

### 初期費用に含めるもの

- 現調
- 初期キッティング
- 標準施工の一部または全部
- 初期設定
- 操作説明

### 月額に含めるもの

- モニター3台レンタル
- 端末レンタル
- 標準金具
- CMS利用
- 死活監視
- 一次保守
- 軽微な素材更新
- 簡易レポート
- 自然故障時の交換対応

### 提供条件

- 36か月契約
- 与信/審査付き
- 中途解約精算あり
- 返却義務あり
- 顧客過失破損は実費請求

## Media

### 位置づけ

施設内メディア/広告枠運用プラン。

### 含めるもの

- Standard相当のCMS/監視
- 広告主管理
- キャンペーン管理
- Proof of Play
- 広告主別CSV/PDFレポート
- QRログ
- 媒体レポート

### レンタル対象

- 原則は端末のみレンタル
- USEN対抗/初期費用圧縮時はモニター込みレンタルも可能

## AI Edge

### 位置づけ

AIカメラ/センサー/分析の上位プラン。

### レンタル対象

- プレイヤー端末
- AI Edge端末
- AIカメラ
- 必要に応じてセンサー

### 注意

- プライバシー掲示必須
- カメラ設置条件確認必須
- 個人識別をしない設計を基本にする
- 36か月契約

## Premium

### 位置づけ

大手/高信頼/止められない現場向け。

### レンタル対象

- BrightSign XC4055 または高信頼産業用PC
- 必要に応じて予備機

### 注意

- 36か月契約
- 優先保守メニューとセットにする
- 高額端末のため中途解約精算を厳格にする

## 所有権

レンタル対象機器の所有権は、Misell/IYASAKA側に残す。

顧客は契約期間中、設置場所で通常の使用目的に限り利用できる。

対象:

- プレイヤー端末
- BrightSign/産業用PC
- AIカメラ
- レンタル対象モニター
- レンタル対象金具
- その他レンタル明細に記載した機器

## 自然故障・過失破損・盗難

| 事象 | 扱い |
| --- | --- |
| 自然故障 | プラン条件に従い無償交換または代替機提供 |
| 初期不良 | Misell/IYASAKA側で交換対応 |
| 顧客過失破損 | 実費請求 |
| 水濡れ/落下/改造 | 実費請求 |
| 紛失/盗難 | 再調達費請求 |
| 返却不能 | 再調達費または残価請求 |
| 設置場所変更の無断移動 | 契約違反。再設定/再施工費を請求可能 |

## 未払い時の扱い

未払いが発生した場合の段階対応。

1. 支払期日超過: 自動通知
2. 一定期間超過: 管理画面/更新機能の制限
3. さらに超過: 配信停止
4. 長期未払い: 契約解除、機器回収、未回収分請求

注意:

- 緊急案内用途など顧客業務に影響が大きい場合は、停止前に個別判断する。
- 契約書に停止条件を明記する。

## 解約時の返却・撤去

### 端末のみレンタル

- 顧客が端末を返送
- またはMisell/IYASAKAが回収
- 回収後に初期化
- 再利用可否を判定

### モニター込みレンタル

- 原則として撤去作業が必要
- 撤去費は契約条件に含めるか別途請求
- 壁面補修は原則顧客負担
- 金具撤去の有無を事前に決める

## レンタル資産台帳

レンタル機器は資産台帳で管理する。

管理項目:

| 項目 | 内容 |
| --- | --- |
| asset_id | 資産ID |
| asset_type | player / display / camera / mount / other |
| manufacturer | メーカー |
| model | 型番 |
| serial_number | シリアル |
| purchase_date | 購入日 |
| purchase_cost | 取得原価 |
| assigned_tenant_id | 割当先 |
| assigned_site_id | 設置先 |
| contract_id | 契約ID |
| status | in_stock / deployed / repair / retired / lost |
| installed_at | 設置日 |
| returned_at | 返却日 |
| condition | new / good / worn / damaged |
| memo | メモ |

## データモデル案

### contracts

```sql
CREATE TABLE contracts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  plan_key TEXT NOT NULL,
  contract_status TEXT NOT NULL DEFAULT 'draft',
  start_date DATE,
  end_date DATE,
  minimum_months INTEGER NOT NULL,
  monthly_fee INTEGER NOT NULL,
  initial_fee INTEGER NOT NULL DEFAULT 0,
  cancellation_policy_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

plan_key:

- lite
- standard_purchase
- standard_rental
- media
- ai_edge
- premium

contract_status:

- draft
- active
- suspended
- cancelled
- ended

### rental_assets

```sql
CREATE TABLE rental_assets (
  id UUID PRIMARY KEY,
  asset_type TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  purchase_date DATE,
  purchase_cost INTEGER,
  status TEXT NOT NULL DEFAULT 'in_stock',
  condition TEXT NOT NULL DEFAULT 'good',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### contract_assets

```sql
CREATE TABLE contract_assets (
  id UUID PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES contracts(id),
  rental_asset_id UUID NOT NULL REFERENCES rental_assets(id),
  tenant_id UUID NOT NULL,
  site_id UUID,
  installed_at DATE,
  returned_at DATE,
  status TEXT NOT NULL DEFAULT 'deployed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### invoices

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL REFERENCES contracts(id),
  invoice_number TEXT NOT NULL,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  amount INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

invoice status:

- draft
- issued
- paid
- overdue
- cancelled

## API案

### 契約

```http
GET    /api/admin/contracts
POST   /api/admin/contracts
GET    /api/admin/contracts/:id
PATCH  /api/admin/contracts/:id
POST   /api/admin/contracts/:id/activate
POST   /api/admin/contracts/:id/suspend
POST   /api/admin/contracts/:id/cancel
```

### レンタル資産

```http
GET    /api/admin/rental-assets
POST   /api/admin/rental-assets
GET    /api/admin/rental-assets/:id
PATCH  /api/admin/rental-assets/:id
POST   /api/admin/contracts/:id/assets
DELETE /api/admin/contracts/:id/assets/:asset_id
```

### 請求

```http
GET    /api/admin/invoices
POST   /api/admin/invoices/generate-monthly
GET    /api/admin/invoices/:id
PATCH  /api/admin/invoices/:id
POST   /api/admin/invoices/:id/mark-paid
POST   /api/admin/invoices/:id/cancel
```

## QAチェックリスト

### 契約

- Liteは最低契約12か月で作成できる
- Standard Purchaseは最低契約24か月で作成できる
- Standard Rental/AI Edge/Premiumは最低契約36か月で作成できる
- 契約にレンタル資産を紐づけられる
- active契約以外には請求生成しない

### レンタル資産

- 資産ID/型番/シリアルを登録できる
- deployed中の資産を別契約に二重割当できない
- 返却時にstatusをin_stockまたはrepairに戻せる
- lost/damagedを記録できる

### 請求

- 月次請求を生成できる
- 初期費用と月額を分けて管理できる
- 支払済みにできる
- overdueを判定できる

### 解約

- 中途解約精算額を表示できる
- 返却対象資産一覧を出せる
- 未返却資産を追跡できる

## 実装優先順位

Phase 1:

1. プラン別契約期間の定義
2. contractsテーブル
3. rental_assetsテーブル
4. contract_assetsテーブル
5. 契約に資産を紐づけるUI
6. レンタル資産台帳UI

Phase 2:

1. invoicesテーブル
2. 月次請求生成
3. 未払いステータス
4. 解約時精算額表示
5. 返却/回収管理

Phase 3:

1. 会計連携
2. 電子契約連携
3. 自動督促
4. 与信/審査管理
5. 減価償却/資産残価レポート

## Codex向けプロンプト

```text
Implement Misell contract and rental asset management Phase 1.

Read docs/72_CONTRACT_BILLING_AND_RENTAL_ASSET_SPEC.md first.

Goal:
Build contracts, rental_assets, and contract_assets management so Misell can track which rental devices/displays/cameras are assigned to which customer contract.

Rules:
- Lite minimum term: 12 months.
- Standard Purchase minimum term: 24 months.
- Standard Rental, AI Edge, Premium minimum term: 36 months.
- Lite and Standard Purchase rent only player devices by default.
- Standard Rental rents displays + player devices.
- AI Edge rents player/AI edge devices + AI cameras.
- Premium rents BrightSign or high reliability devices.
- A rental asset with status deployed cannot be assigned to two active contracts.

Phase 1 scope:
- DB migrations
- CRUD APIs
- Basic admin UI
- Contract to asset assignment
- Asset status management

Do not implement payment processing in Phase 1.
Do not implement accounting integration in Phase 1.
```

## 更新日

2026-06-15
