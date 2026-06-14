# 73. 申込〜現調〜設置〜検収〜請求 業務フロー仕様

## 目的

このドキュメントは、Misellの問い合わせから運用開始までの業務フローを定義する。

対象範囲:

- 問い合わせ
- ヒアリング
- 概算提案
- 現調
- 正式見積
- 契約
- 機器手配
- キッティング
- 施工
- 検収
- 月額開始
- 初回請求

## 決定事項

| 論点 | 決定 |
| --- | --- |
| 現調 | 顧客提示上は無料。内部原価として初期費用で回収する。現調費という名目は原則明記しない |
| 機器手配 | 原則は契約後。ただし納品希望日・在庫状況により先行手配を検討できる |
| 月額開始日 | 検収完了日の翌日から開始 |
| 検収承認 | 電子署名またはメール承認で可 |
| 検収基準 | 表示・通信・再起動・素材更新・管理画面確認が完了した時点 |

## 基本フロー

```text
問い合わせ
↓
ヒアリング
↓
概算提案
↓
現調
↓
正式見積
↓
契約
↓
初期請求
↓
機器手配
↓
キッティング
↓
施工日調整
↓
設置施工
↓
表示/通信/再起動テスト
↓
顧客検収
↓
運用開始
↓
月額請求開始
```

## 1. 問い合わせ

### 入口

- LPフォーム
- 紹介
- 既存顧客
- 営業訪問
- 電話/メール

### 取得項目

- 会社名/店舗名
- 担当者名
- 連絡先
- 設置希望場所
- 導入目的
- 希望時期
- 画面台数
- 既存モニター有無
- 電源/LAN状況の分かる範囲
- 写真/図面の有無

## 2. ヒアリング

### 目的

- 導入目的の確認
- 提案プランの仮決定
- 現調必要性の判断
- 概算見積の前提整理

### 確認事項

- 何を表示したいか
- 誰が更新するか
- 3面wideが必要か
- 広告運用をするか
- QR誘導をするか
- 月次レポートが必要か
- 既存モニターを使うか
- モニター込みレンタルを希望するか
- 設置可能時間
- 夜間/閉店後作業の有無

## 3. 概算提案

### 目的

正式見積前に、顧客に価格帯と導入イメージを提示する。

### 注意

概算提案では、以下を明記する。

- 現地条件により正式見積が変わる
- 標準施工範囲外は別途調整になる
- 納期は機器在庫と施工日程により変動する

## 4. 現調

### 方針

現調は顧客提示上は無料とする。

ただし、社内では現調にかかる人件費・交通費・確認工数を初期費用の原価として扱う。

顧客向け見積では、原則として「現調費」という項目を明記しない。

### 現調で確認すること

- 設置壁面
- 設置高さ
- 壁面材質
- 下地有無
- 電源位置
- LAN位置
- Wi-Fi状況
- 搬入経路
- 作業可能時間
- 既存設備
- モニター設置可否
- 金具取り付け可否
- ケーブル露出可否
- 意匠上の制約
- 写真撮影
- 寸法採寸

### 現調結果

現調後、以下を社内記録する。

- 設置可否
- 標準施工で可能か
- 標準外作業の有無
- 追加工事の必要性
- 推奨モニターサイズ
- 推奨金具
- 施工難易度
- 想定工数
- リスク

## 5. 正式見積

### 正式見積に含めるもの

- プラン名
- 初期費用
- 月額費用
- 最低契約期間
- 標準施工範囲
- 別見積範囲
- 納期目安
- 支払条件
- レンタル対象機器
- 中途解約条件

### 標準外として切り分けるもの

- 新規電源工事
- LAN新設/長距離配線
- 下地補強
- 高所作業
- 夜間/閉店後施工
- 特注金具
- 既存設備撤去
- 複雑な意匠施工

## 6. 契約

### 契約前提

契約後に機器手配へ進む。

ただし、納品希望日が近い場合や在庫確保が必要な場合は、顧客承認・社内承認のうえで先行手配を検討できる。

### 契約時に確定するもの

- 契約プラン
- 初期費用
- 月額費用
- 最低契約期間
- 中途解約条件
- レンタル対象機器
- 設置場所
- 請求先
- 支払条件
- 納品希望日

## 7. 初期請求

### 方針

案件ごとに支払条件を設定する。

推奨:

- 契約時に初期費用の一部または全額請求
- 機器手配前に必要額を回収
- 与信が低い場合は前金比率を高くする

### 注意

モニター込みレンタルや高額機器案件では、未回収リスクを避けるため、初回入金確認後に手配を基本にする。

## 8. 機器手配

### 原則

契約後に手配する。

### 例外

納品希望日が迫っている場合、または在庫確保が必要な場合、以下の条件で先行手配を検討できる。

- 顧客の発注意思が明確
- 見積条件が確定済み
- キャンセル時の扱いが明確
- 社内承認済み

### 手配対象

- モニター
- プレイヤー端末
- 金具
- ケーブル
- ネットワーク部材
- AIカメラ
- 予備機

## 9. キッティング

### 作業内容

- 端末初期設定
- OS/アプリ設定
- Device ID発行
- CMS登録
- Tailscale/SSH設定
- 自動起動設定
- 再起動復旧設定
- 初期素材投入
- テスト再生
- アップデート確認

### 完了条件

- 管理画面に端末が表示される
- heartbeatが届く
- playlistを取得できる
- オフライン再生ができる
- 再起動後に自動復旧する

## 10. 施工日調整

### 確認事項

- 作業日
- 作業時間
- 立会者
- 搬入経路
- 駐車場所
- 作業届の有無
- 養生の必要性
- 夜間作業の有無
- 電源/LAN工事の有無

## 11. 設置施工

### 作業内容

- モニター設置
- 金具固定
- 端末設置
- 配線
- 電源接続
- LAN/Wi-Fi接続
- 画面位置調整
- 3連表示確認
- ケーブル整理
- 施工写真撮影

## 12. 表示/通信/再起動テスト

検収前に以下を確認する。

| 項目 | 確認内容 |
| --- | --- |
| 表示 | 左/中央/右が正しく表示される |
| wide | 3面wideが表示される |
| 通信 | 管理画面から端末状態を確認できる |
| 素材更新 | 素材差し替えが反映される |
| スケジュール | 指定時間の表示が動く |
| 再起動 | 再起動後に自動復旧する |
| オフライン | 通信断時もローカル再生する |
| ログ | playlog/heartbeat/error logが記録される |

## 13. 顧客検収

### 検収条件

以下が確認できたら検収完了とする。

- 3画面表示が正常
- wide表示が正常
- 指定素材が再生される
- 通信が正常
- 管理画面で端末状態が確認できる
- 再起動復旧が確認できる
- 顧客が運用開始を了承

### 検収承認方法

電子署名またはメール承認で可。

メール承認例:

```text
本日設置いただいたMisell 3連サイネージについて、表示・通信・管理画面確認が完了し、運用開始を承認します。
```

このメール返信を検収記録として保存する。

## 14. 運用開始

検収完了後、運用開始とする。

月額課金は、検収完了日の翌日から開始する。

例:

- 6月15日 検収完了
- 6月16日 月額利用開始

## 15. 月額請求開始

### 方針

月額費用は検収完了日の翌日から発生する。

請求タイミングは契約条件に従う。

案:

- 初月日割り
- または翌月分から満額
- 法人契約では月末締め翌月請求も可

この詳細は請求設計で別途決める。

## 管理ステータス

Orderのステータスは以下。

| status | 意味 |
| --- | --- |
| inquiry | 問い合わせ |
| qualified | ヒアリング済み |
| rough_proposal | 概算提案済み |
| site_survey_scheduled | 現調予定 |
| site_survey_done | 現調完了 |
| quoted | 正式見積済み |
| contracted | 契約済み |
| initial_invoice_issued | 初期請求済み |
| procurement | 機器手配中 |
| kitting | キッティング中 |
| install_scheduled | 施工予定 |
| installed | 設置済み |
| acceptance_pending | 検収待ち |
| accepted | 検収完了 |
| active | 運用中 |
| cancelled | キャンセル |

## データモデル案

### orders

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  lead_name TEXT NOT NULL,
  customer_name TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'inquiry',
  desired_install_date DATE,
  plan_key TEXT,
  site_address TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### site_surveys

```sql
CREATE TABLE site_surveys (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  surveyor_name TEXT,
  wall_condition TEXT,
  power_condition TEXT,
  network_condition TEXT,
  installation_risk TEXT,
  standard_install_possible BOOLEAN,
  extra_work_required BOOLEAN,
  internal_cost_memo TEXT,
  customer_visible_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### acceptances

```sql
CREATE TABLE acceptances (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  contract_id UUID,
  accepted_at TIMESTAMPTZ NOT NULL,
  accepted_by TEXT,
  acceptance_method TEXT NOT NULL,
  evidence_text TEXT,
  evidence_file_url TEXT,
  monthly_start_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

acceptance_method:

- email
- electronic_signature
- paper
- admin_record

## API案

```http
GET    /api/admin/orders
POST   /api/admin/orders
GET    /api/admin/orders/:id
PATCH  /api/admin/orders/:id
POST   /api/admin/orders/:id/advance-status

POST   /api/admin/orders/:id/site-survey
PATCH  /api/admin/site-surveys/:id

POST   /api/admin/orders/:id/acceptance
GET    /api/admin/orders/:id/acceptance
```

## QAチェックリスト

- 問い合わせを登録できる
- 現調予定を登録できる
- 現調完了を記録できる
- 現調費を顧客向け項目として出さない
- 契約後に機器手配ステータスへ進める
- 検収をメール承認で登録できる
- 検収完了日の翌日がmonthly_start_dateになる
- accepted後にactiveへ進める
- active後に月額請求対象になる

## Codex向けプロンプト

```text
Implement Misell Order to Install workflow Phase 1.

Read docs/73_ORDER_TO_INSTALL_WORKFLOW_SPEC.md first.

Rules:
- Site survey is customer-facing free. Do not create a customer-visible site survey fee field.
- Site survey cost may be stored only as internal cost memo.
- Procurement normally starts after contract, but order should support desired_install_date and internal exception notes.
- Monthly billing starts the day after acceptance completion.
- Acceptance can be recorded by email or electronic signature.

Phase 1 scope:
- orders table
- site_surveys table
- acceptances table
- admin CRUD/status UI
- acceptance registration
- monthly_start_date calculation

Do not implement payment processing in Phase 1.
```

## 更新日

2026-06-15
