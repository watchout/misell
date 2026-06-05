# 53. 店舗展開向け端末セットアップ・運用固定化リスト

## 目的

Misell local playerを複数店舗へ展開するときに、作業者ごとの差、設定漏れ、監視漏れ、セキュリティ事故を減らすための固定化対象を整理する。

この文書は、Ubuntu端末の初期セットアップ、インストール、ネットワーク、監視、セキュリティ、保守、現地検証で必要になる項目を列挙する。

## 前提

- MVP端末はUbuntu 24.04 + Chromium kiosk + `apps/player` で運用する
- Remote CMSはMVP後続
- MVP時点の管理はLAN内 `/admin` とGit更新を中心にする
- 商用運用ではVPN/MDM/Remote CMS/heartbeatへ段階移行する

## 固定化すべき成果物

- 端末調達チェックリスト
- Ubuntuインストール手順
- Windows併用時のデュアルブート手順
- 端末ID採番ルール
- 店舗・設置場所・画面グループ台帳
- 初期設定スクリプト
- 端末登録env生成スクリプト
- systemd自動起動手順
- 3画面xrandr設定手順
- ネットワーク設計テンプレート
- セキュリティ初期設定手順
- LAN管理画面の認証情報管理ルール
- 死活監視・ログ確認手順
- 現地MVP Gate検証テンプレート
- 障害一次対応フロー
- 退役・交換・紛失時の手順

## 端末調達・事前準備

- CPU/GPUが3画面同時出力に耐えることを確認する
- HDMI/DisplayPort/USB-Cの実出力数を確認する
- 5760 x 1080出力が可能なGPU/ドック/変換アダプタを選定する
- 24時間連続稼働を想定し、排熱・電源・設置スペースを確認する
- 有線LANを第一候補にする
- 無線LAN利用時は電波強度、SSID固定、再接続挙動を確認する
- Windows併用端末ではBitLocker、Secure Boot、ディスク空き容量を事前確認する
- 店舗ごとに端末名、device_id、store_id、location_id、screen_group_idを発行する

## OS・インストール

- Ubuntu 24.04 LTSを標準OSにする
- 3画面kioskはX11前提とし、必要に応じてUbuntu on Xorgを選ぶ
- Windows併用時はデュアルブートにし、Windows側の重要データをバックアップしてから作業する
- Ubuntu側のディスク容量は最低64GB、推奨128GB以上を確保する
- Node.js 20以上をインストールする
- Ubuntu標準aptのNode.jsが20未満の場合は、承認済みのNodeSource等を使ってNode.js 20以上を入れる
- Chromium、xrandr、curl、ufw、lm-sensorsをインストールする
- `apps/player/scripts/setup-ubuntu-device.sh` を初期確認スクリプトとして使う
- `npm install --omit=dev` を `apps/player` で実行する

## アプリ設定

- `apps/player/data/config.json` はローカル開発用の標準値として保持する
- 実店舗端末では `~/.config/misell-player/env` の環境変数で端末IDを上書きする
- 実店舗端末ではruntimeファイルをGit checkout外へ置く
- 標準runtime rootは `~/.local/share/misell-player`
- `MISELL_DATA_DIR`、`MISELL_ASSETS_DIR`、`MISELL_LOG_DIR` を `~/.config/misell-player/env` に保存する
- `MISELL_PLAYLIST_PATH` と `MISELL_DEVICE_CONFIG_PATH` で端末ごとのplaylist/configを外部化する
- `apps/player/scripts/enroll-device.sh` で実店舗端末のenvを生成する
- `ADMIN_PASSWORD` は端末ごとに生成し、共有チャットや平文メモに残さない
- `PORT=3000` をMVP標準にする
- アップロード上限は回線・ディスク容量に合わせて `UPLOAD_MAX_MB` で設定する
- playlistはruntime側の `playlist.json` とGit管理された `data/playlist.schema.json` で検証する

## 画面・kiosk

- `xrandr --query` の結果を証跡に残す
- 左、中央、右の出力名を確定する
- `scripts/set-display-3x.sh` で 1920 x 1080 x 3 の横連結を設定する
- `scripts/start-kiosk.sh` で 5760 x 1080 kioskを起動する
- kioskは `http://localhost:3000/player` を表示する
- `/player?preview=1` は開発・事前確認用に使う
- 現地では再起動後に3画面配置とkioskが自動復旧することを確認する

## 自動起動

- `scripts/setup-autostart.sh` でsystemd user serviceを導入する
- `misell-player.service` はNodeサーバーを起動する
- `misell-kiosk.service` はChromium kioskを起動する
- `systemctl --user status` と `journalctl --user` の確認手順を固定する
- GUIログインなしでサーバーを起動したい場合は `loginctl enable-linger` の要否を判断する
- kioskはグラフィカルセッション依存のため、自動ログイン設定とセットで検証する

## ネットワーク設計

- 原則は有線LAN
- 端末用VLANまたはサイネージ専用セグメントを検討する
- 店舗LANから `/admin` へ接続できる端末を限定する
- DHCP固定割当または静的IPで端末IPを台帳管理する
- DNS、NTP、GitHub、将来CMS APIへの到達性を確認する
- 店舗側ルーターで不要な外部公開をしない
- リモート保守はTailscale等のVPNを標準候補にする
- SSHはVPN経由を原則にし、インターネットへ直接公開しない

## セキュリティ

- `/admin` はBasic auth必須
- `ADMIN_PASSWORD=change-me` のまま店舗LANへ接続しない
- `scripts/setup-ubuntu-security.sh` はドライラン確認後に `--apply` する
- ufwはincoming deny、outgoing allowを基本にする
- admin portは店舗LAN CIDRからのみ許可する
- SSHはVPN CIDRからのみ許可する
- SSH root loginを禁止する
- SSH password loginを禁止し、公開鍵認証にする
- `.env` や `~/.config/misell-player/env` はGit管理しない
- アップロードはjpg/jpeg/png/mp4/webmのみ許可する
- HTML/JS/sh/exe/zipはアップロード禁止
- 退役時は認証情報、VPN登録、端末台帳を無効化する

## 監視・ログ

- MVPではローカルログを標準化する
- `logs/playlog.jsonl`: 放映ログ
- `logs/admin.log`: 管理操作ログ
- `logs/error.log`: API/サーバーエラーログ
- `logs/burn-in.log`: 連続稼働検証ログ
- `systemctl --user status misell-player.service` を一次確認に使う
- `journalctl --user -u misell-player.service` を障害調査に使う
- `GET /api/health` と `GET /api/status` で簡易死活確認する
- 商用前にheartbeat、アラート通知、クラウドログ回収を有効化する
- Cloud通知を使う場合は `ALERT_WEBHOOK_URL` 設定後に `/api/admin/alert-notifications/test` で送信確認する
- 複数端末の監視、release channel、rollback方針は `docs/57_FLEET_MONITORING_RELEASE_OPERATIONS.md` に従う

## バージョン管理・更新

- MVPではGit更新や手動配置を許容するが、更新前後の証跡を残す
- Git更新を使う場合、アプリ checkout はcleanに保ち、端末固有データは `~/.local/share/misell-player` へ分離する
- 商用ではGit pull直更新を禁止し、release bundle/manifestで配布する
- `app_version`、`playlist_version`、`config_version` を分けて管理する
- 更新は staging、canary、stable の順に進める
- canaryでcriticalが出た場合はstable展開を止める
- 更新前に前バージョンへ戻せる状態を作る
- 更新後は `/api/health`、`/player`、systemd状態、ログを確認する
- Cloud更新を使う端末は `INSTALL_UPDATE=1 scripts/setup-autostart.sh` で `misell-update.timer` を有効化する
- `scripts/check-update.sh --dry-run` でCloudの更新指示だけを確認できる
- OS更新は店舗営業時間外のメンテナンス枠で行い、再起動復旧まで確認する

## 現地検証

- `scripts/collect-device-evidence.sh` で証跡フォルダを作成する
- OS、Node、Chromium、network、xrandr、systemd、journal、Misellログを保存する
- 障害時は `scripts/collect-device-evidence.sh --upload --label incident --reason "<内容>"` でCloudにも送信する
- 3画面の写真または動画を残す
- `/admin` が未認証で入れないことを確認する
- 安全な素材アップロードが通ることを確認する
- 危険な拡張子・偽装ファイルが拒否されることを確認する
- playlist保存とplayer自動再読み込みを確認する
- 6時間以上のburn-inを最低ラインにする
- 本番前は24時間burn-inを推奨する

## 運用・保守

- 店舗ごとの端末台帳を更新する
- 管理パスワードの保管先と共有範囲を決める
- 月次でログ、ディスク使用量、温度、再起動履歴を確認する
- アップロード素材の容量上限と削除ルールを決める
- 故障時の交換端末セットアップ手順を用意する
- 障害時は「電源、画面、ネットワーク、Node、kiosk、playlist」の順に切り分ける
- 端末交換時はdevice_idを新規発行するか、旧端末IDを引き継ぐかを台帳に記録する
- device_token再発行時は端末envの `MISELL_DEVICE_TOKEN` を更新し、`misell-heartbeat.timer` と `misell-player.service` を再起動する
- Remote CMS導入後はローカル `/admin` の露出を縮小または無効化する

## 今後スクリプト化する候補

- 端末IDを対話入力して `~/.config/misell-player/env` を生成するスクリプト
- xrandr出力名を検出して候補を表示するスクリプト
- 端末台帳CSV/JSONから設定ファイルを生成する仕組み

## スクリプト化済み

- `scripts/enroll-device.sh`: 端末ID、管理認証、device token、release channelのenv生成
- `scripts/emit-heartbeat.sh`: `/api/status` payloadの表示またはクラウド送信
- `scripts/rotate-logs.sh`: ローカルログローテーション
- `scripts/update-player.sh`: MVP向けGit更新、npm install、検証、service restart、health check
- `scripts/check-update.sh`: Cloud更新指示の取得、MVP向けGit更新実行、更新結果報告
- `scripts/collect-device-evidence.sh`: status、heartbeat、service/timer、journal、ログの証跡回収とCloud送信
