# 03. MVP Specification

## MVP名

ミセル3 MVP

## 目的

最初のMVPは、完成版CMSではなく、Linux端末1台で3連サイネージの基本価値を検証するための最小実装である。

検証する内容は以下。

- Ubuntu端末で3画面を安定表示できるか
- 3画面を横長1枚のように使えるか
- 左・中央・右で別コンテンツを表示できるか
- 3面ぶち抜き表示ができるか
- LAN経由で素材を入れ替えられるか
- タイマー配信ができるか
- 現場で価値が伝わるか
- 月額運用、広告運用、POPタグ連動へ発展できるか

## 対象端末

- NiPoGi Ryzen 4300U
- RAM 16GB
- SSD 256GB
- Ubuntu 24.04 LTS 想定
- HDMI、DisplayPort、USB-C映像出力を使用

## 画面仕様

- 1画面：1920 x 1080
- 3画面横並び：5760 x 1080
- 表示方式：Chromium kiosk

## レイアウトモード

### three-zone

左、中央、右で別々の素材を表示する。

例：左に館内案内、中央にメイン広告動画、右にQR/価格/CTAを表示する。

### wide

3面ぶち抜きの横長素材を表示する。

例：季節キャンペーン、ブランド訴求、イベント告知、空間ジャック演出。

## 対応素材

初期対応：mp4、webm、jpg、png、HTMLページURL。

後続対応：天気、時計、QR自動生成、商品LP連動、外部API表示。

## 配信管理

初期MVPはデータベースを使わず、playlist.jsonで管理する。

playlist.jsonで管理する項目：

- layout
- left / center / right / wide の素材パス
- duration
- start time
- end time
- enabled

## LAN管理画面

同一LAN内のPCから以下を操作できるようにする。

- 素材アップロード
- 既存素材一覧
- playlist編集
- 表示プレビュー
- プレイヤー再読み込み

URL例：misell-player.local/admin または 端末IP:3000/admin。

## ローカル継続再生

ネットが切れても、端末内に保存された素材とplaylist.jsonで再生を継続する。

## 自動起動

Ubuntu起動後に、ローカルサーバー、画面配置、Chromium kioskを自動実行する。

## MVP完了条件

- Ubuntuで3画面が認識される
- xrandrで横並び固定できる
- Chromiumが5760 x 1080で起動する
- three-zoneが動作する
- wideが動作する
- LAN内から素材をアップロードできる
- playlist変更が反映される
- 時間帯指定が効く
- 再起動後に自動復帰する
- 6時間以上の連続再生で落ちない

## MVPに入れないもの

- クラウドCMS
- 多店舗管理
- ユーザー権限
- 決済
- 高度な広告配信
- AIカメラ
- POS連携
- 電子棚札API連携

ただし、将来拡張できるように、データ構造は広告枠、店舗、素材、表示ログへ発展できる形を意識する。
