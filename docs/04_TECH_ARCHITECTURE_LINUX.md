# 04. Linux Technical Architecture

## 基本方針

ミセルMVPは、Linuxをサイネージ専用端末として使う。

最初は既存の大型CMSを導入せず、ローカルWebプレイヤーを自作する。理由は、3連表示、広告枠、POPタグ、将来のAI連動に合わせて柔軟に設計できるため。

## 技術スタック

- OS：Ubuntu 24.04 LTS
- Display：X11 + xrandr
- Player：Chromium kiosk
- Backend：Node.js + Express
- Data：playlist.json
- Storage：local assets directory
- Remote access：Tailscale, SSH, RustDesk
- Autostart：systemd

## 表示構成

3枚の物理ディスプレイを横並びにし、Chromiumの1つのウィンドウを5760 x 1080で表示する。

画面はWebアプリ側で3分割する。

- left zone: 0〜1920px
- center zone: 1920〜3840px
- right zone: 3840〜5760px

## なぜWebプレイヤーか

- HTML/CSS/JSで3面レイアウトを作れる
- 動画、画像、QR、時計、天気、LPを統合しやすい
- 将来的にクラウドCMS化しやすい
- Codexで高速に実装できる
- 広告枠やPOPタグとの連携がしやすい

## xrandr方針

X11環境で、HDMI、DisplayPort、USB-C出力を横に並べる。

実機では出力名が異なる可能性があるため、初回セットアップで `xrandr --query` を実行して出力名を確認する。

想定出力：

- HDMI-1
- DP-1
- DP-2 または USB-C-1

## Chromium kiosk方針

Chromiumをウィンドウ位置0,0、サイズ5760 x 1080で起動する。

初期URL：

- http://localhost:3000/player

管理URL：

- http://localhost:3000/admin

## ローカルサーバー

Node.js + Expressを使う。

責務：

- player.html配信
- admin.html配信
- playlist.json読み書き
- 素材アップロード
- assets配信
- 簡易ログ保存

## データ設計 MVP

### playlist item

- id
- layout
- duration
- start
- end
- left
- center
- right
- wide
- enabled

### future fields

- advertiser_id
- campaign_id
- qr_url
- priority
- tags
- schedule_days
- impression_goal

## ログ設計 MVP

初期はCSVまたはJSONLで保存する。

保存する項目：

- timestamp
- playlist_item_id
- layout
- asset path
- duration
- result

後続で、QRアクセス数、広告主、店舗、キャンペーンと紐付ける。

## 遠隔保守

初期は以下を使う。

- Tailscale：VPN/SSH用
- SSH：設定変更、ログ確認
- RustDesk：画面確認用
- Smart plug：最終手段の電源再投入

## 自動復旧

systemdでNodeサーバーを自動復旧する。

Chromiumが落ちた場合の再起動は、専用watchdogスクリプトを後続で追加する。

## 量産時の課題

- 画面順の固定
- EDID問題
- HDMI再認識
- 電源復帰
- 熱対策
- SSD容量
- 端末ごとの出力名差異
- OSアップデート制御

## 本番化の追加要素

- EDIDエミュレータ
- 小型UPS
- 専用端末イメージ
- 自動プロビジョニング
- 端末ID発行
- クラウド同期
- 死活監視
- 障害通知
- バージョン管理

## 設計原則

1. まずローカルで完結する
2. ネット切断時も再生する
3. 管理画面はLAN内から使える
4. データ構造はクラウド化前提にする
5. 広告枠、POPタグ、AI分析へ拡張しやすくする
