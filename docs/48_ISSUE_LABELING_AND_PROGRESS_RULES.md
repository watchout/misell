# 48. Issue Labeling & Progress Rules

## 目的

GitHub Issuesを開発進捗管理として使うため、ラベルと運用ルールを定義する。

Issueが増えても、local player / Remote CMS / field ops / sales / security が混ざらないようにする。

## ラベル設計方針

ラベルは4系統に分ける。

1. area: 領域
2. phase: フェーズ
3. priority: 優先度
4. type: 作業種別

## areaラベル

### area:player

local player本体。

対象：

- player画面
- playlist
- admin MVP
- kiosk
- local logs

### area:device

端末/OS/表示/実機。

対象：

- Ubuntu
- xrandr
- 3画面
- systemd
- burn-in

### area:security

認証、アップロード制限、SSH、Firewall、token、退役。

### area:cms

Remote CMS、端末同期、複数店舗管理。

### area:field-ops

現調、施工、QA、導入、保守。

### area:creative

動画、デモ素材、3面演出。

### area:sales

提案資料、価格表、契約、媒体資料。

### area:reporting

放映ログ、QRログ、月次レポート、AIレポート。

### area:ai

AI制作、AIレポート、AIカウント、AIコンシェルジュ。

### area:esl

POPタグ、電子棚札、NFC、QR棚札。

## phaseラベル

### phase:mvp-local

ローカル開発で進めるもの。

### phase:mvp-device

実端末で検証するもの。

### phase:test-intro

テスト導入前に必要なもの。

### phase:commercial

商用複数台運用で必要なもの。

### phase:scale

30店舗以上、買収準備で必要なもの。

## priorityラベル

### priority:p0

今すぐ必要。MVPが成立しない。

### priority:p1

テスト導入前に必要。

### priority:p2

有償PoC/商品化前に必要。

### priority:p3

商用拡張/将来機能。

## typeラベル

### type:feature

機能実装。

### type:docs

仕様書、資料、手順書。

### type:research

調査。

### type:test

実機テスト、QA。

### type:ops

運用、SOP、導入、保守。

### type:security

セキュリティ実装/設計。

## 既存Issueへの推奨ラベル適用

### #1〜#3

- area:device
- phase:mvp-device
- priority:p0
- type:test

### #4〜#8

- area:player
- phase:mvp-local
- priority:p0
- type:feature

### #9〜#12

- area:device
- area:player
- phase:mvp-device
- priority:p1
- type:ops

### #13〜#17

- area:security
- phase:mvp-local
- priority:p0〜p1
- type:security

### #18〜#21

- area:creative
- phase:test-intro
- priority:p1
- type:docs

### #22〜#27

- area:reporting
- area:esl
- phase:test-intro
- priority:p2
- type:feature

### #28〜#34

- area:sales
- area:ai
- area:esl
- phase:test-intro
- priority:p1〜p2
- type:docs / type:research

### #35〜#54

- area:security
- area:cms
- phase:commercial
- priority:p2〜p3
- type:security / type:feature

### #55〜#58

- area:player
- area:architecture
- phase:mvp-local
- priority:p0
- type:docs / type:feature

## 進捗ステータス

GitHub Projectsを使う場合、カラムは以下。

1. Backlog
2. Ready
3. In Progress
4. Review
5. Device Test
6. Done
7. Deferred

## 運用ルール

- 1 Issue = 1明確な完了条件
- Issue本文にDone条件を必ず書く
- コードPRはIssue番号を含める
- 実機検証が必要なものはDevice Testへ移す
- Remote CMSやAI系はMVP local playerを阻害しない
- priority:p0は同時に増やしすぎない

## 最初に着手するIssue

最初のスプリントは以下。

1. #55 責務境界
2. #4 Node.js/Expressサーバー
3. #5 three-zone
4. #6 wide
5. #7 playlist.json
6. #57 playlist validation
7. #58 device identity
8. #8 LAN管理画面
9. #13 admin basic auth
10. #14 upload file validation
11. #15 path traversal

実端末到着後：

1. #1 NiPoGi初期確認
2. #2 Ubuntu setup
3. #3 3画面確認
4. #10 kiosk
5. #56 MVP gate
6. #12 burn-in

## 注意

ラベルは進捗管理のために使う。完璧な分類にこだわりすぎず、チームが次に何をやるべきか分かることを優先する。
