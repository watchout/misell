# 65. QR Generation Guide

## 目的

Issue #22 のQR生成機能は、広告、商品、案内ごとに計測用の `campaign_id` と `qr_id` を持つQR画像を発行し、POPタグやサイネージ表示へ転用できる状態にする。

この機能はQR画像発行までを扱う。読み取りログ保存、時間帯別集計、レポート反映は後続のQRアクセス計測Issueで扱う。

## 管理画面

ローカルplayerを起動する。

```bash
cd apps/player
npm start
```

管理画面 `http://localhost:3000/admin` の `QR作成` で以下を入力する。

| 項目 | 必須 | 内容 |
| --- | --- | --- |
| キャンペーンID | 必須 | 広告、商品、導線単位のID。例: `anshin-guide-202606` |
| QR ID | 任意 | 未入力なら自動発行される。例: `anshin-guide-map` |
| 表示名 | 任意 | 管理画面の一覧表示名 |
| LP URL | 必須 | QRに埋め込むURL。`http(s)` URLまたは `/demo/...` などのローカルパス |

発行後、管理画面にQR画像プレビュー、PNGダウンロード、画像パス、QR IDが表示される。

## API

### QR一覧

```bash
curl -u admin:change-me http://localhost:3000/api/qrs
```

レスポンス例:

```json
{
  "ok": true,
  "version": 1,
  "qrs": [
    {
      "qr_id": "anshin-guide-map",
      "campaign_id": "anshin-guide-202606",
      "label": "安心お宿 館内MAP",
      "lp_url": "https://misell.example/anshin/guide",
      "image_path": "/generated/qrs/anshin-guide-map.png",
      "created_at": "2026-06-08T00:00:00.000Z",
      "updated_at": "2026-06-08T00:00:00.000Z"
    }
  ]
}
```

### QR発行

```bash
curl -u admin:change-me \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": "anshin-guide-202606",
    "qr_id": "anshin-guide-map",
    "label": "安心お宿 館内MAP",
    "lp_url": "https://misell.example/anshin/guide"
  }' \
  http://localhost:3000/api/qrs
```

レスポンスの `qr.image_path` は、そのままブラウザやPOPタグ生成で参照できるPNG URLになる。

## 保存先

| 種別 | パス |
| --- | --- |
| QRカタログ | `apps/player/data/qrs.json` |
| QR画像 | `apps/player/data/generated/qrs/<qr_id>.png` |
| 公開URL | `/generated/qrs/<qr_id>.png` |

`MISELL_QR_CATALOG_PATH` でQRカタログの保存先を変更できる。QR画像は既存の `MISELL_GENERATED_DIR` 配下に保存される。

## 運用メモ

- `campaign_id` は広告主、商品、案内導線ごとの集計軸として固定する。
- `qr_id` は個別のQR画像単位で固定する。POPタグ、サイネージ、紙掲示で別QRにすると比較しやすい。
- 発行前にコンテンツバックアップが作成され、`qrs.json` と生成済みPNGがバックアップ対象に入る。
- 後続のQRアクセス計測では、同じ `qr_id` を読み取りログのキーとして扱う。
