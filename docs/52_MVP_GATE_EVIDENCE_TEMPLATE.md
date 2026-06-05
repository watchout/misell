# 52. MVP Gate Evidence Template

## 目的

Misell MVPは、コードが動くだけではなく、Ubuntu実端末で3連サイネージとして安定稼働する証拠を残して合格判断する。

このテンプレートは、docs/47 の MVP Gate を実機検証時に記録するための標準様式である。

## 使い方

1. Ubuntu端末で `misell-player` を起動する
2. 3画面を接続する
3. `apps/player/scripts/collect-device-evidence.sh` を実行する
4. 生成された `evidence/YYYYMMDD-HHMMSS/README.md` に結果を追記する
5. 写真・動画・スクリーンショットを同じ evidence ディレクトリへ保存する
6. 検証結果をGitHub Issueへ貼る

```bash
cd apps/player
scripts/collect-device-evidence.sh
```

出力先を指定する場合:

```bash
cd apps/player
scripts/collect-device-evidence.sh /path/to/evidence/run-001
```

## Gate 1: Local Dev Pass

記録項目:

- `npm install` が通る
- `npm start` が通る
- `/player` が表示される
- `/admin` が表示される
- `three-zone` が表示される
- `wide` が表示される
- playlist schema validation が不正入力を拒否する

証拠:

- `npm run check` 出力
- `/api/health` 出力
- player/admin のスクリーンショット
- validation拒否テスト結果

## Gate 2: Device Display Pass

記録項目:

- Ubuntuが起動する
- X11でログインしている
- 3画面が認識される
- `xrandr --query` で出力名を確認した
- 5760 x 1080 相当の横並び表示になる
- Chromium kioskが3画面にまたがる
- 再起動後に自動復旧する

証拠:

- `xrandr --query` 出力
- 3画面表示写真
- kiosk表示動画
- 再起動復旧動画
- systemd status

## Gate 3: Security Minimum Pass

記録項目:

- `/admin` Basic認証が有効
- 未認証で `/admin` が401になる
- 素材アップロードで拡張子/MIME/シグネチャ検証が効く
- 偽PNGなどが拒否される
- path traversalが拒否される
- HTML直接アップロードは禁止
- ufw設定を確認した
- SSH hardening方針を確認した

証拠:

- 401/200 のcurl結果
- upload拒否テスト結果
- ufw status
- SSH設定ファイル

## Gate 4: Burn-in Pass

記録項目:

- 6時間連続再生
- 停止/クラッシュなし
- ログ肥大化なし
- CPU/RAM/温度が許容範囲
- 動画カクつきなし

証拠:

- burn-in開始/終了時刻
- CPU/RAM/温度ログ
- playback log
- error log
- 途中確認写真または動画

## Gate 5: Demo Ready Pass

記録項目:

- 業種別デモ素材がある
- three-zone / wide をplaylistで切り替えられる
- QRサンプルがある
- 提案資料に使える表示動画が撮れている

証拠:

- デモplaylist
- 表示写真
- 60秒紹介動画
- 管理画面スクリーンショット

## 判定

| Gate | Result | Evidence | Follow-up Issue |
| --- | --- | --- | --- |
| Gate 1 |  |  |  |
| Gate 2 |  |  |  |
| Gate 3 |  |  |  |
| Gate 4 |  |  |  |
| Gate 5 |  |  |  |

## 合格基準

テスト導入前の最低合格ライン:

- Gate 1 pass
- Gate 2 pass
- Gate 3 pass
- Gate 4 pass

Gate 5 は営業デモ前にpassさせる。
