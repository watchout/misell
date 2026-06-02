# 16. Issue Backlog

## 開発チーム向けIssue化リスト

このファイルを元にGitHub Issuesへ分解する。

## Epic 1: Ubuntu端末セットアップ

### Issue: NiPoGi初期確認

- Windows状態で3画面出力確認
- BIOS確認
- USBブート確認
- Ubuntuインストール準備

### Issue: Ubuntu 24.04セットアップ

- Ubuntu Desktopインストール
- SSH有効化
- Tailscale導入
- Node.js導入
- Chromium導入

### Issue: 3画面表示確認

- xrandr出力名確認
- 3画面横並び設定
- 画面順固定
- 解像度確認
- 再起動後確認

## Epic 2: misell-player MVP

### Issue: Node.js/Expressサーバー構築

- 静的ファイル配信
- playlist読み込み
- assets配信
- admin/playerルート作成

### Issue: Player画面 three-zone実装

- 左/中央/右の3ゾーン
- 画像表示
- 動画表示
- duration切替

### Issue: Player画面 wide実装

- 3面ぶち抜き表示
- wide素材表示
- three-zoneとの切替

### Issue: playlist.json仕様実装

- layout
- duration
- start/end
- enabled
- asset path

### Issue: LAN管理画面

- 素材アップロード
- 素材一覧
- playlist編集
- 保存
- プレイヤー反映

## Epic 3: 自動起動・運用

### Issue: systemdサービス

- misell-player.service作成
- 自動起動
- 異常終了時再起動

### Issue: Chromium kiosk起動スクリプト

- window size 5760x1080
- window position 0,0
- kiosk mode
- display指定

### Issue: ログ保存

- 表示ログ
- エラーログ
- playlist変更ログ

### Issue: 連続再生テスト

- 6時間
- 12時間
- 24時間
- 温度/CPU/メモリ確認

## Epic 4: 営業デモ

### Issue: 安心お宿デモ素材

- 館内案内
- サウナ/休憩訴求
- 近隣広告枠例
- QRサンプル

### Issue: バリアンデモ素材

- ルームサービス
- 記念日
- アメニティ
- 予約導線

### Issue: パセラデモ素材

- フード/ドリンク
- コラボ
- イベント
- 回遊導線

### Issue: ビジョンセンターデモ素材

- 会場案内
- 配信パック
- スポンサー枠
- 受付案内

## Epic 5: POPタグ/QR

### Issue: QR生成

- campaign_id
- qr_id
- LP URL
- QR画像出力

### Issue: POPタグPDF生成

- 90x40mm
- 100x45mm
- 120x50mm
- 商品名、コピー、QR

### Issue: QRアクセス計測

- timestamp
- store_id
- campaign_id
- qr_id
- LP path

### Issue: 商品/広告LP生成

- シンプルなLPテンプレート
- CTA
- クーポン
- 問い合わせ

## Epic 6: レポート

### Issue: 月次レポートv1

- 放映回数
- QR数
- 時間帯別
- 広告主別
- 改善コメント欄

### Issue: AIレポート文生成

- ログ要約
- 改善案
- 次月提案

## Epic 7: 事業化

### Issue: 提案資料作成

- 表紙
- 価値説明
- デモ画像
- プラン表
- テスト導入条件

### Issue: 価格表作成

- Lite
- Standard
- Media
- AI Edge

### Issue: テスト導入契約雛形

- 期間
- 費用
- 事例掲載
- データ利用
- 解約条件

### Issue: 媒体資料作成

- 店舗属性
- 想定表示回数
- 広告枠
- QR計測
- 料金

## Epic 8: AI/ESL調査

### Issue: ESLスターターキット候補調査

- Alibaba候補
- ゲートウェイ有無
- API有無
- 日本語対応
- QR対応
- 価格

### Issue: AI制作プロンプト作成

- 3面コピー
- POPタグ文言
- 15秒台本
- LP見出し

### Issue: AIカウント要件定義

- 個人識別しない
- 録画しない
- 人数/滞留のみ
- 店舗掲示

## 優先順位

最優先：Epic 1〜3

営業開始に必要：Epic 4

事業価値強化：Epic 5〜6

バイアウト準備：Epic 7〜8
