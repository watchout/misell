# 56. Self-Serve LP & Onboarding Portal Spec

## 目的

Misellの販売導線を、単なる問い合わせ・資料請求で終わらせず、Web申込、申込ID発行、顧客用申込ステータス画面、初期素材アップロード、社内確認、契約/請求、tenant/store/user/device発行、顧客管理画面招待までつなげる。

ただし、最初から完全自動契約・完全自動CMS開放は行わない。

理由：

- 端末設置が必要
- 契約確認が必要
- 素材審査が必要
- 表示事故を防ぐ必要がある
- 顧客ごとに設置場所・画面構成・通信環境が異なる

## 基本方針

LPは「問い合わせ窓口」ではなく、Misellの導入申込入口にする。

ただし、配信公開はMisell側Operator承認制にする。

## 導線全体

1. LP
2. Web申込
3. 申込ID発行
4. 顧客用の申込ステータス画面発行
5. 初期素材アップロード
6. 社内確認
7. 契約/請求
8. tenant/store/user/device 発行
9. 顧客管理画面招待
10. 配信公開はMisell側Operator承認

## 対象ユーザー

### 申込者

施設担当者、店舗オーナー、広告担当者。

### Misell Operator

申込内容、素材、契約、端末発行、配信承認を行う社内担当者。

### Client Viewer / Client Editor

顧客側の管理画面利用者。

## LPの役割

LPで達成すること：

- Misellの価値を伝える
- 導入対象施設を明確にする
- プランを理解させる
- テスト導入または本申込へ進ませる
- 必要情報をWeb申込で取得する

LPのCTA：

- テスト導入を申し込む
- 導入相談する
- 資料請求する
- デモを見る

## Web申込フォーム

### 入力項目

#### 会社/施設情報

- 会社名
- 施設名
- 業態
- 所在地
- 担当者名
- メールアドレス
- 電話番号

#### 導入希望

- 希望プラン
- テスト導入希望有無
- 希望導入時期
- 設置希望場所
- 画面数
- 既存モニター有無
- 電源/LAN状況

#### 表示したい内容

- 館内案内
- 商品/サービス販促
- イベント案内
- 地域広告
- 求人
- 多言語案内
- その他

#### 素材状況

- ロゴ有無
- 写真有無
- 動画有無
- チラシ/PDF有無
- 素材制作依頼希望

#### 広告運用

- 地域広告枠に興味があるか
- 既存広告主/協賛企業があるか
- 広告審査担当者

#### 同意

- プライバシーポリシー同意
- 利用規約/申込前確認への同意
- テスト導入条件の確認

## 申込ID

Web申込完了時に申込IDを発行する。

例：

- APP-2026-000001

申込IDは、顧客メール、社内管理、契約、端末発行まで一貫して使う。

## 申込ステータス

### status一覧

- submitted: 申込受付
- reviewing: 内容確認中
- need_info: 追加情報待ち
- material_upload: 素材アップロード待ち
- proposal_ready: 提案準備完了
- contract_pending: 契約確認中
- invoice_pending: 請求/支払確認中
- provisioning: tenant/store/device発行中
- invited: 管理画面招待済み
- scheduled: 設置/配信準備中
- live: 運用開始
- rejected: 見送り
- cancelled: キャンセル

## 顧客用申込ステータス画面

申込完了後、顧客専用URLを発行する。

表示内容：

- 申込ID
- 現在ステータス
- 次に必要なアクション
- 申込内容
- 素材アップロード欄
- 担当者からのコメント
- 契約/請求状況
- 管理画面招待状況

注意：

- 最初はログインなしのtoken付きURLでもよい
- 商用ではログイン必須へ移行する
- token付きURLは有効期限を設ける

## 初期素材アップロード

顧客がアップロードできる素材：

- ロゴ
- 写真
- 動画
- チラシ/PDF
- メニュー表
- 商品画像

制限：

- 拡張子制限
- MIMEチェック
- サイズ制限
- ウイルスチェックは後続検討
- アップロード素材は即時公開しない

アップロード後はMisell Operatorが確認する。

## 社内確認

Misell Operatorが確認する項目：

- 導入対象として適切か
- 設置場所の現実性
- 契約プラン
- 素材の品質
- 表示内容の審査
- 施工要否
- 追加見積要否
- 事例化可否

## 契約/請求

初期は完全自動決済にしない。

### MVP/初期商品化

- Web申込
- 社内確認
- 見積/申込書発行
- 契約確認
- 請求書発行
- 入金確認または支払条件確認
- tenant/store/user/device発行

### 後続

- クレジットカード決済
- 口座振替
- 電子契約
- 自動請求
- プラン変更

## tenant/store/user/device 発行

契約/請求確認後に発行する。

### tenant

顧客企業単位。

### store

施設/店舗単位。

### user

顧客管理画面ユーザー。

### device

実端末単位。

### screen_group

3連画面セット単位。

## 顧客管理画面招待

契約確認後、顧客に管理画面招待を送る。

初期権限：

- Client Viewer: レポート/配信プレビュー閲覧
- Client Editor: 素材アップロード/下書き作成

配信公開権限はMisell Operatorに限定する。

## 配信公開承認

顧客が素材やplaylist案を作っても、公開はMisell Operatorが承認する。

理由：

- 表示事故防止
- 広告審査
- 著作権/表現チェック
- 画面崩れ防止
- 契約外掲載防止

## データモデル案

### applications

- application_id
- tenant_name
- store_name
- contact_name
- contact_email
- phone
- industry
- desired_plan
- desired_start_date
- status
- created_at
- updated_at

### application_materials

- material_id
- application_id
- file_url
- file_type
- original_filename
- status
- uploaded_at

### application_comments

- comment_id
- application_id
- author_type
- body
- created_at

### tenants

- tenant_id
- name
- status

### stores

- store_id
- tenant_id
- name
- address
- industry

### users

- user_id
- tenant_id
- email
- role
- status

### devices

- device_id
- tenant_id
- store_id
- screen_group_id
- status

## 通知

### 顧客向け

- 申込受付メール
- 追加情報依頼
- 素材アップロード依頼
- 契約案内
- 請求案内
- 管理画面招待
- 設置/配信開始案内

### 社内向け

- 新規申込通知
- 素材アップロード通知
- 追加情報返信通知
- 契約待ち通知
- 配信承認待ち通知

## 最小実装範囲

### Phase 1

- LP CTA
- Web申込フォーム
- application_id発行
- 申込受付メール
- 社内通知
- 申込一覧
- 申込詳細

### Phase 2

- 顧客用申込ステータス画面
- 素材アップロード
- Operatorコメント
- status更新

### Phase 3

- tenant/store/user/device発行補助
- 管理画面招待
- 配信公開承認

### Phase 4

- 電子契約
- 請求/決済連携
- 自動プラン管理

## 実装しないこと MVP

- 完全自動契約
- 完全自動CMS開放
- 決済完了即配信
- 顧客による無審査公開
- AIによる無審査素材生成/公開

## 受け入れ条件 Phase 1

- LPから申込フォームに進める
- 申込送信でapplication_idが発行される
- 顧客に受付メールが届く
- 社内に通知が届く
- 管理者が申込一覧/詳細を確認できる

## 受け入れ条件 Phase 2

- 顧客が申込ステータス画面を見られる
- 顧客が素材をアップロードできる
- Operatorが素材を確認できる
- status更新が顧客画面に反映される

## 重要な考え方

申込導線は営業効率を上げるが、配信公開は必ずMisell側が承認する。

Misellは表示事故が起きると信頼を失うため、完全自動化よりも、最初は半自動オンボーディングが正しい。
