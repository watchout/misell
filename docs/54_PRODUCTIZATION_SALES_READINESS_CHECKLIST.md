# 54. 商品化・販売開始レディネスチェックリスト

## 目的

Misellを「動くMVP」から「販売できる商品」に進めるため、営業開始前に必要な商品定義、価格、契約、導入、保守、セキュリティ、証跡、運用体制を一つの判定表にまとめる。

## 販売開始の判定

### Demo Ready

商談で見せられる状態。

- local playerが `apps/player` で起動できる
- `/player?preview=1` でthree-zoneとwideを説明できる
- 3面表示の動画または写真がある
- 管理画面で素材アップロードとplaylist保存を見せられる
- 価格表のたたき台がある
- テスト導入条件を説明できる

### Pilot Ready

テスト導入先に置ける状態。

- Ubuntu実機で3画面表示が通っている
- systemd自動起動が通っている
- `/admin` Basic認証が有効
- ufw/SSH hardening方針が適用または確認済み
- 6時間以上のburn-in evidenceがある
- 端末ID、店舗ID、設置場所IDが台帳化されている
- 簡易合意書または申込書がある
- 撤去条件、破損時責任、事例掲載可否が決まっている

### Paid Ready

有償契約として販売できる状態。

- Lite/Standard/Mediaの提供範囲が明確
- 初期費用、月額費用、標準外費用が提示できる
- 標準施工範囲と追加施工範囲が分かれている
- 請求開始日、最低契約期間、解約条件が定義されている
- 月次運用SOPがある
- 障害一次対応フローがある
- サポート窓口、対応時間、エスカレーション先が決まっている
- 顧客提出用のセキュリティ説明がある
- 契約書または利用申込書のレビューが済んでいる

## 商品パッケージ

### Lite

- 対象: 小規模施設、テスト導入後の低初期プラン
- 内容: 3連表示、月1回更新、簡易監視、基本サポート
- 営業時の訴求: 紙POPやポスター更新の負荷削減

### Standard

- 対象: 本命商品
- 内容: 3連表示、月2回更新、監視、月次レポート、QR計測
- 営業時の訴求: 店内販促と案内を運用代行込みで回せる

### Media

- 対象: 広告枠化したい施設
- 内容: Standard + 媒体資料、広告主対応、広告レポート
- 営業時の訴求: 空きスペースを地域広告メディアにする

## 営業開始前に用意するもの

- 1枚営業資料
- Web申込LP
- 10〜12枚の初回提案デック
- 価格表
- 媒体資料
- テスト導入条件表
- 申込書または簡易合意書
- 導入フロー説明資料
- セキュリティ説明資料
- 標準施工範囲表
- 標準外作業の追加費用表
- 初回デモ動画
- 業種別デモplaylist
- 設置写真テンプレート
- 月次レポートテンプレート
- 導入事例テンプレート
- 申込ステータス管理画面

## 受注前の確認事項

- 設置場所の写真
- 電源位置
- LAN/Wi-Fi条件
- 画面設置方法
- 営業時間と施工可能時間
- 表示したい内容
- QR誘導先
- 広告掲載可否
- 事例掲載可否
- 月額予算
- 契約期間
- 保守範囲
- 標準外作業の有無

## 端末・現場運用の準備

- 端末台帳
- device_id採番
- `scripts/enroll-device.sh` による端末env生成
- Ubuntu setup手順
- 3画面xrandr設定手順
- systemd自動起動手順
- security baseline手順
- evidence収集手順
- burn-in手順
- 障害時の再起動・ログ確認手順

## セキュリティ・法務

- `/admin` の認証必須化
- 管理パスワードの保管ルール
- SSH鍵認証
- root login禁止
- ufw設定
- アップロード許可形式
- 端末内に個人情報を置かない方針
- 広告素材の権利確認
- 事例掲載許諾
- 撤去・退役時のデータ削除
- 顧客ネットワークへの接続説明

## サポート定義

### MVP/Pilot

- 対応時間: 平日営業時間内
- 初動目標: 24時間以内
- 対応方法: 遠隔確認、再起動、playlist修正、必要時現地対応
- 顧客通知: 表示停止が長引く場合

### Paid

- 対応時間、初動、代替機、現地対応費用を契約プランごとに明記する
- SLAは初期から過度に約束しない
- 稼働率は社内KPIとして先に記録する

## 販売開始前の残タスク

- Ubuntu実機でMVP Gateを通す
- 3画面表示動画を撮る
- デモ素材を3業種分作る
- 価格表を顧客提示形式にする
- 申込書/簡易合意書を作る
- セキュリティ説明1枚を作る
- 月次レポート雛形を作る
- 初回テスト導入候補へ提案する

## 関連ドキュメント

- `docs/06_BUSINESS_MODEL_PRICING.md`
- `docs/07_MARKETING_SALES_PLAYBOOK.md`
- `docs/22_ONE_PAGE_SALES_SHEET.md`
- `docs/27_CONTRACT_AND_ONBOARDING_CHECKLIST.md`
- `docs/33_PROPOSAL_DECK_OUTLINE.md`
- `docs/60_TEST_INTRO_PROPOSAL_DECK.md`
- `docs/61_CUSTOMER_PRICING_TABLE.md`
- `docs/62_MISELL_MEDIA_KIT.md`
- `docs/35_OPERATIONS_SOP.md`
- `docs/36_QA_TEST_CHECKLIST.md`
- `docs/53_DEVICE_ROLLOUT_SETUP_AND_OPERATIONS.md`
- `docs/56_SELF_SERVE_LP_AND_ONBOARDING_PORTAL_SPEC.md`
