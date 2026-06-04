# 49. 外部レビュー提案の整理と反映方針

## 目的

外部レビューで指摘された「local player / Remote CMS / field ops を混ぜすぎない」という提案を、既存設計と照合し、重複している内容と追加反映すべき内容を整理する。

## 結論

外部レビューの方向性は正しい。

Misellは、まず `misell-player` が単体で確実に動くことを最優先にする。その上で、Remote CMS、端末管理、広告運用、AI分析を外側から連動させる。

## 既に入っていた内容

### 1. MVP現地稼働の証拠化

既存文書：

- docs/03_MVP_SPEC.md
- docs/30_FIRST_30_DAYS_EXECUTION_PLAN.md
- docs/36_QA_TEST_CHECKLIST.md

既存Issue：

- #1 NiPoGi初期確認
- #2 Ubuntu 24.04セットアップ
- #3 3画面表示確認
- #9 systemdサービス
- #10 Chromium kiosk起動スクリプト
- #12 連続再生テスト

ただし、外部レビューで指摘されたように「MVP合格基準として証拠化する」という観点は弱かったため、#56を追加した。

### 2. LAN管理画面の最低限セキュリティ

既存文書：

- docs/44_NETWORK_SECURITY_SPEC.md
- docs/46_SECURITY_IMPLEMENTATION_BACKLOG.md

既存Issue：

- #13 MVP admin basic auth
- #14 素材アップロードのファイル検証
- #15 path traversal対策
- #16 ufw最低設定
- #17 SSH hardening
- #44 HTML/URL制限

この領域は既にかなりカバー済み。

### 3. device identityの先行導入

既存文書：

- docs/43_DEVICE_FLEET_MANAGEMENT_SPEC.md
- docs/46_SECURITY_IMPLEMENTATION_BACKLOG.md

既存Issue：

- #35 device_id/store_id/location_id採番実装
- #36 device_token認証

ただし、Remote CMS未導入でもlocal playerログへ先に入れる視点が不足していたため、#58を追加した。

### 4. Remote CMSは後続フェーズ

既存文書：

- docs/41_REMOTE_CMS_SPEC.md
- docs/43_DEVICE_FLEET_MANAGEMENT_SPEC.md

この方針は既に入っていたが、local playerとの責務境界が明文化されていなかったため、docs/47と#55を追加した。

## 新たに追加した内容

### 1. 責務境界の明文化

追加文書：

- docs/47_ARCHITECTURE_BOUNDARIES_AND_MVP_GATES.md

追加Issue：

- #55 local player / Remote CMS / field ops の責務境界を定義する

### 2. MVP合格基準の独立Issue化

追加Issue：

- #56 現地MVP合格基準を定義する

### 3. playlist schema / validation

追加Issue：

- #57 playlist schema / validation を実装する

理由：

Remote CMS移行時に、local playerのplaylist仕様が曖昧だと後で破綻するため。

### 4. device identityのlocal player先行導入

追加Issue：

- #58 device identity をlocal playerログへ先行導入する

理由：

クラウド未導入でも、device_id、store_id、screen_group_id、playlist_versionをログに残すことで、商用化時の移行が容易になるため。

### 5. Issueラベル/進捗管理ルール

追加文書：

- docs/48_ISSUE_LABELING_AND_PROGRESS_RULES.md

追加Issue：

- #59 Issueラベル/進捗管理ルールを定義する
- #60 GitHubラベルを作成して既存Issueへ適用する

## 優先順位の更新

### 最優先で進めるIssue

1. #55 責務境界
2. #4 Node.js/Expressサーバー構築
3. #5 three-zone実装
4. #6 wide実装
5. #7 playlist.json仕様実装
6. #57 playlist schema / validation
7. #58 device identity先行導入
8. #8 LAN管理画面
9. #13 admin basic auth
10. #14 upload file validation
11. #15 path traversal対策
12. #56 MVP合格基準

### 実端末到着後に進めるIssue

1. #1 NiPoGi初期確認
2. #2 Ubuntu setup
3. #3 3画面表示確認
4. #10 kiosk起動
5. #9 systemd
6. #12 連続再生テスト

## ラベル方針

ラベルは一気に大量適用せず、まず docs/48 の設計に従って、以下の基本ラベルから適用する。

- area:player
- area:device
- area:security
- area:cms
- area:field-ops
- area:creative
- area:sales
- area:reporting
- area:ai
- area:esl
- phase:mvp-local
- phase:mvp-device
- phase:test-intro
- phase:commercial
- priority:p0
- priority:p1
- priority:p2
- priority:p3
- type:feature
- type:docs
- type:test
- type:security
- type:research
- type:ops

## 運用上の注意

- Remote CMS系IssueをMVPプレイヤー実装より先に進めすぎない
- AI/広告/ESLは、local playerが安定した後に進める
- MVP合格までは、表示安定性とセキュリティ最低限を優先する
- field opsは開発Issueと混ぜず、SOP/チェックリストとして運用する

## 最終判断

今回の外部レビューは、Misellを商用プロダクトとして成立させる上で有効。

特に、次の4点は必ず実装計画へ反映する。

1. local player単体の安定性を最優先する
2. playlist schema / validationを早期に入れる
3. device identityをlocal playerログに先行導入する
4. MVP合格基準を証拠ベースにする
