# 76. 共通管理画面・RBAC・セルフ運用設計仕様

## 目的

このドキュメントは、Misell Studioのアカウント、権限、公開フロー、顧客セルフ運用の方針を定義する。

Misell Studioは、顧客向け、Misell運用向け、広告主向け、代理店向け、施工会社向けに管理画面を分けない。共通管理画面を1つ作り、ロールと権限で表示メニュー・操作範囲を制御する。

## 決定事項

| 論点 | 決定 |
| --- | --- |
| 管理画面 | Misell Studioに統一する |
| 権限制御 | RBACで制御する |
| 初期ロール数 | 多くしすぎない |
| 顧客運用 | NoviSign相当のセルフ運用に寄せる |
| 通常コンテンツ公開 | 顧客が自分で公開できる方向にする |
| 広告素材公開 | Misell/operator承認を必須にする |
| 緊急停止 | Misell側で可能にする |
| 高リスク機能 | feature flag / plan / roleで制御する |

## 基本方針

### 管理画面は1つ

以下をすべてMisell Studio上で扱う。

- 顧客の素材管理
- レイアウト編集
- スケジュール作成
- 公開
- 端末状態確認
- レポート閲覧
- 広告管理
- 請求確認
- レンタル機器確認
- パートナー案件確認
- 施工情報確認

画面を分けず、ログインユーザーのrole/permission/tenant/planに応じて表示と操作を変える。

### 初期ロールは少なくする

ロールを増やしすぎると運用が重くなるため、Phase 1は最低限にする。

Phase 1ロール:

| role | 説明 |
| --- | --- |
| misell_owner | Misell/IYASAKAの全権限管理者 |
| misell_operator | Misell運用担当。顧客運用・端末監視・承認・レポートを扱う |
| customer_admin | 顧客側の管理者。自社tenant内を管理できる |
| customer_editor | 顧客側の編集者。素材・レイアウト・スケジュールを扱う |
| customer_viewer | 顧客側の閲覧者。配信状況・レポート・請求等の閲覧のみ |
| system | 端末/自動処理用。heartbeat/playlog/error ingestなど |

Phase 2以降で追加するロール:

| role | 説明 |
| --- | --- |
| advertiser_viewer | 広告主。自社広告キャンペーンのレポートのみ閲覧 |
| partner_admin | 代理店/紹介会社。自社経由案件の進捗や一部レポートを閲覧 |
| installer | 施工協力会社。現調・施工・写真・チェックリストのみ操作 |

## 権限モデル

Roleだけでなく、permission単位でも制御する。

例:

```text
asset:read
asset:create
asset:update
asset:delete
layout:read
layout:create
layout:update
schedule:read
schedule:create
schedule:update
publish:create
publish:approve
publish:emergency_stop
device:read
device:operate
report:read
billing:read
ad:read
ad:create
ad:approve
partner:read
install:read
install:update
```

Phase 1では、DB上で完全なpermission modelを持たなくてもよいが、コード上の権限判定はpermission単位で拡張できるようにする。

## 顧客運用レベル

Misellは、顧客運用をNoviSign相当のセルフサービスCMSに寄せる。

つまり、顧客は以下を自分でできる。

- 素材アップロード
- 素材差し替え
- テンプレート選択
- レイアウト作成/編集
- プレイリスト作成
- スケジュール作成
- プレビュー
- 自社Display Wallへの公開
- 端末状態確認
- レポート閲覧

ただし、Misell側で安全制御を残す。

- 緊急停止
- 公開取り消し
- テナント停止
- 危険素材/NG素材の差し止め
- 広告素材の承認
- 高度機能のplan制御

## 公開フロー

公開フローは3種類持つ。

## 1. Self Publish

通常コンテンツ向け。

```text
顧客が素材/レイアウト/スケジュール作成
↓
プレビュー
↓
顧客が公開
↓
端末へ同期
```

対象:

- customer_admin
- customer_editor

用途:

- 通常案内
- メニュー
- キャンペーン
- 館内案内
- 施設告知

## 2. Approval Publish

承認制プラン/高リスク顧客向け。

```text
顧客が作成
↓
公開申請
↓
Misell operatorが確認
↓
承認
↓
端末へ同期
```

対象:

- 運用代行プラン
- 初期導入直後
- 顧客希望による承認運用
- ブランド統制が必要な施設

## 3. Ad Approval Publish

広告素材向け。

```text
広告素材登録
↓
広告主/顧客確認
↓
Misell operator承認
↓
広告スケジュール有効化
↓
端末へ同期
```

対象:

- Mediaプランの広告素材
- 広告主が絡む掲載物
- 施設外企業の素材

広告素材は、原則としてMisell/operator承認を必須にする。

## tenant単位の公開モード

TenantまたはSiteごとに公開モードを持つ。

| publish_mode | 説明 |
| --- | --- |
| self_publish | 顧客が自分で公開できる |
| operator_approval | Misell承認後に公開 |
| ad_approval_only | 通常コンテンツは自己公開、広告だけ承認 |

推奨デフォルト:

| プラン | publish_mode |
| --- | --- |
| Lite | self_publish |
| Standard | self_publish |
| Standard Rental | self_publish |
| Media | ad_approval_only |
| AI Edge | ad_approval_only |
| Premium | 顧客要件に応じて self_publish / operator_approval |

## ロール別権限

| 機能 | misell_owner | misell_operator | customer_admin | customer_editor | customer_viewer |
| --- | ---: | ---: | ---: | ---: | ---: |
| tenant管理 | ○ | △ | - | - | - |
| 契約/請求管理 | ○ | △ | 閲覧 | - | 閲覧 |
| 素材閲覧 | ○ | ○ | ○ | ○ | ○ |
| 素材アップロード | ○ | ○ | ○ | ○ | - |
| 素材削除 | ○ | ○ | ○ | △ | - |
| レイアウト作成 | ○ | ○ | ○ | ○ | - |
| スケジュール作成 | ○ | ○ | ○ | ○ | - |
| 通常公開 | ○ | ○ | ○ | ○ | - |
| 公開承認 | ○ | ○ | △ | - | - |
| 緊急停止 | ○ | ○ | △ | - | - |
| 端末状態閲覧 | ○ | ○ | ○ | ○ | ○ |
| 端末再起動 | ○ | ○ | - | - | - |
| レポート閲覧 | ○ | ○ | ○ | ○ | ○ |
| 広告作成 | ○ | ○ | ○ | △ | - |
| 広告承認 | ○ | ○ | - | - | - |
| パートナー管理 | ○ | △ | - | - | - |
| 施工情報 | ○ | ○ | 閲覧 | - | - |

△ はplan/tenant設定により許可する。

## メニュー表示制御

Misell Studioのメニューは共通。

```text
ダッシュボード
素材
レイアウト
スケジュール
端末管理
レポート
広告管理
契約・請求
レンタル機器
施工情報
パートナー
設定
```

ロール/プランで表示制御する。

例:

| メニュー | customer_admin | customer_editor | customer_viewer | advertiser_viewer | installer |
| --- | ---: | ---: | ---: | ---: | ---: |
| ダッシュボード | ○ | ○ | ○ | ○ | △ |
| 素材 | ○ | ○ | 閲覧 | - | - |
| レイアウト | ○ | ○ | 閲覧 | - | - |
| スケジュール | ○ | ○ | 閲覧 | - | - |
| 端末管理 | ○ | 閲覧 | 閲覧 | - | - |
| レポート | ○ | ○ | ○ | 広告のみ | - |
| 広告管理 | プラン次第 | プラン次第 | 閲覧 | 広告のみ | - |
| 契約・請求 | ○ | - | 閲覧 | - | - |
| レンタル機器 | ○ | - | 閲覧 | - | - |
| 施工情報 | 閲覧 | - | - | - | ○ |
| パートナー | - | - | - | - | - |
```

## 安全設計

### 公開前バリデーション

通常コンテンツでも、公開前に自動チェックを行う。

- 素材ファイル欠落
- 解像度不足
- 縦横比ミスマッチ
- 3面wide非対応素材
- QRサイズ不足
- スケジュール未設定
- 端末未同期
- 容量不足

### 公開履歴

誰が、いつ、何を公開したかを必ず残す。

保存項目:

- tenant_id
- user_id
- layout_id
- schedule_id
- publish_target
- published_at
- previous_version_id
- status

### ロールバック

顧客セルフ公開を許可する代わりに、直前の公開状態へ戻せるようにする。

Phase 1:

- 1つ前の公開状態へ戻す

Phase 2:

- 公開履歴一覧から任意バージョンへ戻す

### 緊急停止

Misell側は、すべてのtenant/site/deviceに対して緊急停止できる。

用途:

- 誤配信
- 不適切素材
- 契約停止
- 未払い
- 障害対応

## データモデル案

### users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### user_roles

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  role_key TEXT NOT NULL,
  tenant_id UUID,
  site_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### tenant_settings

```sql
CREATE TABLE tenant_settings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  publish_mode TEXT NOT NULL DEFAULT 'self_publish',
  allow_customer_publish BOOLEAN NOT NULL DEFAULT true,
  allow_customer_schedule BOOLEAN NOT NULL DEFAULT true,
  allow_customer_layout_edit BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### publish_requests

承認制の場合のみ使う。

```sql
CREATE TABLE publish_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id UUID,
  requested_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  layout_id UUID,
  schedule_id UUID,
  target_display_wall_id UUID,
  request_note TEXT,
  review_note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);
```

status:

- pending
- approved
- rejected
- cancelled

### publish_history

```sql
CREATE TABLE publish_history (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id UUID,
  display_wall_id UUID,
  published_by UUID NOT NULL REFERENCES users(id),
  publish_mode TEXT NOT NULL,
  layout_id UUID,
  schedule_id UUID,
  previous_publish_id UUID,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMPTZ
);
```

## API案

### Auth / User

```http
GET  /api/me
GET  /api/admin/users
POST /api/admin/users
PATCH /api/admin/users/:id
POST /api/admin/users/:id/roles
DELETE /api/admin/users/:id/roles/:role_id
```

### Publish

```http
POST /api/studio/publish
POST /api/studio/publish-requests
GET  /api/studio/publish-requests
POST /api/studio/publish-requests/:id/approve
POST /api/studio/publish-requests/:id/reject
GET  /api/studio/publish-history
POST /api/studio/publish-history/:id/rollback
POST /api/admin/emergency-stop
```

## 実装優先順位

Phase 1:

1. users/user_roles
2. role_keyによるメニュー表示制御
3. tenant_settings.publish_mode
4. customer_admin/editor/viewerの基本権限
5. self_publish
6. publish_history
7. emergency_stop
8. 公開前バリデーション

Phase 2:

1. publish_requests
2. operator_approval
3. advertiser_viewer
4. partner_admin
5. installer
6. ロールバックUI
7. 監査ログ強化

## QAチェックリスト

- customer_viewerは素材をアップロードできない
- customer_editorは素材/レイアウト/スケジュールを作れる
- customer_editorはself_publish設定時のみ公開できる
- operator_approval設定時は公開申請になる
- Mediaプランの広告素材はoperator承認なしで公開できない
- 他tenantの素材/レポート/契約を見られない
- misell_operatorは緊急停止できる
- publish_historyが残る
- ロール変更後にメニュー表示が変わる

## Codex向けプロンプト

```text
Implement Misell RBAC and self-service publishing Phase 1.

Read docs/76_RBAC_AND_SELF_SERVICE_OPERATION_SPEC.md first.

Goal:
Use one shared Misell Studio admin UI and control access by role and tenant settings. Customers should be able to operate at NoviSign-like self-service level for normal content.

Rules:
- Do not create separate admin apps for customer, partner, advertiser, installer.
- Use role/permission checks and menu visibility control.
- Phase 1 roles: misell_owner, misell_operator, customer_admin, customer_editor, customer_viewer, system.
- Default publish_mode is self_publish for Lite/Standard.
- Media ads require operator approval.
- Keep publish_history for every publish action.
- Misell operator can emergency stop.

Phase 1 scope:
1. users and user_roles
2. tenant_settings publish_mode
3. role-based menu/action guards
4. self_publish endpoint
5. publish_history
6. emergency_stop endpoint
7. publish validation checks
```

## 更新日

2026-06-15
