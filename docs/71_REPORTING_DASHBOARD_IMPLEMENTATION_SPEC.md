# 71. レポート・ダッシュボード実装仕様

## 目的

このドキュメントは、Misellのレポート機能を、顧客継続・広告主報告・社内運用改善に使える商品機能として実装するための仕様である。

既存の `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md` では広告配信とProof of PlayのMVPを定義した。本資料では、レポート機能を単なる集計画面ではなく、料金プランごとの課金価値として整理し、画面・API・集計・CSV/PDF・AIコメント生成まで落とし込む。

## 結論

現時点のレポート仕様は、広告MVPとしては十分だが、Media/AI Edgeの商品価値としてはまだ完璧ではない。

追加で必要なのは以下。

1. 顧客向け月次レポート
2. 広告主向けProof of Playレポート
3. 社内運用向け端末稼働レポート
4. QR/LP反応レポート
5. コンテンツ改善レポート
6. AIコメント/改善提案
7. CSV/PDF出力
8. 自動送付

## レポートの種類

Misellでは、レポートを1種類にしない。

| レポート | 対象 | 目的 | 主なプラン |
| --- | --- | --- | --- |
| 稼働レポート | 施設/店舗/社内 | 止まらず動いていることを示す | Standard以上 |
| コンテンツレポート | 施設/店舗 | 何がどれだけ流れたかを見る | Standard以上 |
| QR反応レポート | 施設/店舗 | 来店/予約/LP誘導の反応を見る | Standard以上 |
| 広告主レポート | 広告主 | 掲載証跡を出す | Media以上 |
| 媒体レポート | 施設本部 | 広告枠価値を説明する | Media以上 |
| AI改善レポート | 施設/本部 | 改善提案を出す | AI Edge |
| 社内運用レポート | Misell運用チーム | 障害/保守/品質改善に使う | 社内 |

## プラン別提供範囲

| 機能 | Lite | Standard | Media | AI Edge |
| --- | ---: | ---: | ---: | ---: |
| 端末稼働率 | 簡易 | ○ | ○ | ○ |
| 再生回数 | - | 簡易 | ○ | ○ |
| QRクリック数 | - | ○ | ○ | ○ |
| 月次簡易レポート | - | ○ | ○ | ○ |
| CSV出力 | - | △ | ○ | ○ |
| 広告主別レポート | - | - | ○ | ○ |
| Proof of Play | - | - | ○ | ○ |
| PDF出力 | - | - | ○ | ○ |
| 自動メール送付 | - | - | Phase 2 | ○ |
| AIコメント | - | - | △ | ○ |
| AI改善提案 | - | - | - | ○ |

## KPI定義

### 1. 端末稼働率

定義:

```text
稼働率 = オンライン確認できた時間 / 対象期間の予定稼働時間
```

Phase 1では厳密な分単位ではなく、heartbeat間隔を使って近似する。

例:

- 5分ごとのheartbeatがある
- 1時間に12回heartbeat予定
- 11回取得できたら、その時間の稼働率は約91.7%

### 2. 再生開始数

定義:

```text
play_events の件数
```

### 3. 再生完了数

定義:

```text
completed = true の play_events 件数
```

### 4. 再生完了率

定義:

```text
再生完了率 = 再生完了数 / 再生開始数
```

### 5. QRクリック数

定義:

```text
qr_events の件数
```

### 6. QRクリック率

定義:

```text
QRクリック率 = QRクリック数 / QR付き素材の再生完了数
```

注意:

- 視認者数がない状態ではCTRではなく、再生回数に対するQR反応率として扱う。
- AIカメラ導入後は、推定視認者数ベースの反応率を別指標にする。

### 7. 広告掲載達成率

定義:

```text
掲載達成率 = 実再生回数 / 予定再生回数
```

Phase 1では予定再生回数を厳密に持たないため、Campaignに `target_impressions` を持つ場合のみ表示する。

## データソース

レポートは以下のデータから作る。

| データ | 用途 |
| --- | --- |
| heartbeat | 稼働率、停止時間、最終通信 |
| playlog | コンテンツ再生数、素材別再生数 |
| ad_play_events | 広告再生数、Proof of Play |
| qr_events | QR反応 |
| error logs | 障害/品質レポート |
| device metadata | 店舗/端末/バージョン別集計 |
| schedule data | 配信予定との比較 |

## 画面構成

```text
Misell Studio
└── レポート
    ├── サマリー
    ├── 稼働レポート
    ├── コンテンツレポート
    ├── QRレポート
    ├── 広告レポート
    ├── 端末品質レポート
    └── 月次レポート出力
```

## 1. サマリーレポート

### 表示項目

- 対象期間
- 店舗/施設
- 端末数
- 稼働率
- 総再生回数
- QRクリック数
- 広告再生回数
- エラー件数
- オフライン発生回数
- 前月比

### UI

カード表示:

```text
稼働率: 99.2%
総再生回数: 12,340回
QRクリック: 126回
広告再生: 3,210回
エラー: 2件
```

グラフ:

- 日別再生回数
- 日別QRクリック数
- 端末稼働率推移

## 2. 稼働レポート

### 表示項目

- 端末名
- 店舗名
- 対象期間
- 稼働率
- オフライン時間
- 最終通信
- エラー件数
- アプリバージョン
- 空き容量

### 集計単位

- 端末別
- 店舗別
- 日別
- 月別

### 価値

Standard以上の「監視費用」の根拠になる。

## 3. コンテンツレポート

### 表示項目

- 素材名
- 素材種別
- 再生開始数
- 再生完了数
- 完了率
- 掲載期間
- 表示枠
- 店舗

### 集計単位

- 素材別
- レイアウト別
- 画面別: left / center / right / wide
- 店舗別
- 日別

### 価値

どの告知/キャンペーンがどれだけ露出したかを示す。

## 4. QRレポート

### 表示項目

- QR名
- 遷移先URL
- 表示素材
- 再生回数
- QRクリック数
- QR反応率
- 日別クリック数
- 店舗別クリック数

### 注意

- IPアドレスは生で保存しない。
- 個人識別はしない。
- QRレポートはあくまで反応の傾向を見るもの。

## 5. 広告レポート

### 広告主向け表示項目

- 広告主名
- キャンペーン名
- 掲載期間
- 掲載店舗
- 掲載枠
- 素材名
- 再生開始数
- 再生完了数
- 完了率
- QRクリック数
- 日別再生数
- 日別QRクリック数

### Proof of Play項目

- 再生日時
- 店舗
- 端末
- 掲載枠
- 素材
- 再生完了/未完了
- 同期日時

Phase 1では、詳細ログはCSVで出し、画面では集計のみ表示する。

## 6. 端末品質レポート

社内向け。

### 表示項目

- 端末ID
- 店舗
- アプリバージョン
- 最終通信
- エラー件数
- 再起動回数
- ストレージ空き容量
- 素材同期失敗数
- offline playlog未同期件数

### 価値

保守品質改善、障害予防、月額保守の根拠になる。

## 7. 月次レポート出力

### 出力形式

Phase 1:

- CSV
- 管理画面表示

Phase 2:

- PDF
- 自動メール送付

Phase 3:

- AIコメント付きPDF
- 広告主別自動生成
- 施設本部向け複数店舗まとめ

## データモデル

## report_snapshots

月次レポートの固定化用。

```sql
CREATE TABLE report_snapshots (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id UUID,
  report_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  summary_json JSONB NOT NULL,
  generated_by UUID,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

report_type:

- monthly_summary
- advertiser_report
- device_quality
- ai_insight

status:

- draft
- published
- archived

## report_exports

CSV/PDF出力履歴。

```sql
CREATE TABLE report_exports (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  report_snapshot_id UUID REFERENCES report_snapshots(id),
  export_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

export_type:

- csv
- pdf

## API設計

## Summary

```http
GET /api/admin/reports/summary?from=2026-06-01&to=2026-06-30&site_id=...
```

レスポンス例:

```json
{
  "period": { "from": "2026-06-01", "to": "2026-06-30" },
  "site_id": "uuid",
  "uptime_rate": 0.992,
  "total_play_count": 12340,
  "completed_play_count": 12100,
  "qr_click_count": 126,
  "ad_play_count": 3210,
  "error_count": 2,
  "offline_count": 1,
  "daily": [
    { "date": "2026-06-01", "play_count": 410, "qr_click_count": 4, "ad_play_count": 100 }
  ]
}
```

## Device uptime

```http
GET /api/admin/reports/device-uptime?from=...&to=...&site_id=...
```

## Content performance

```http
GET /api/admin/reports/content-performance?from=...&to=...&asset_id=...&site_id=...
```

## QR report

```http
GET /api/admin/reports/qr?from=...&to=...&site_id=...
```

## Advertiser report

```http
GET /api/admin/reports/advertiser?from=...&to=...&advertiser_id=...&campaign_id=...
```

## Export

```http
POST /api/admin/reports/export
```

リクエスト例:

```json
{
  "report_type": "monthly_summary",
  "format": "csv",
  "from": "2026-06-01",
  "to": "2026-06-30",
  "site_id": "uuid"
}
```

## CSV出力仕様

### 月次サマリーCSV

```csv
日付,店舗,稼働率,総再生回数,再生完了数,QRクリック数,広告再生数,エラー件数
```

### 広告主CSV

```csv
日付,広告主,キャンペーン,素材,店舗,掲載枠,再生開始数,再生完了数,完了率,QRクリック数
```

### 端末稼働CSV

```csv
日付,店舗,端末名,稼働率,オフライン回数,エラー件数,最終通信,アプリバージョン
```

## PDFレポート構成

Phase 2で実装。

### 顧客向け月次PDF

構成:

1. 表紙
2. 月次サマリー
3. 稼働状況
4. コンテンツ再生状況
5. QR反応
6. 広告掲載状況
7. 改善コメント
8. 次月アクション

### 広告主向けPDF

構成:

1. 表紙
2. キャンペーン概要
3. 掲載期間/掲載場所
4. 日別再生回数
5. 掲載枠別再生回数
6. QRクリック数
7. Proof of Playサマリー

## AIコメント生成

AI EdgeまたはMedia上位で提供。

### 入力データ

- 期間
- 再生回数
- QRクリック数
- 前月比
- 素材別ランキング
- 時間帯別傾向
- エラー/停止情報

### 出力例

```text
今月はキャンペーンAのQR反応率が他素材より高く、特に18時〜21時の時間帯でクリックが集中しました。次月は夕方帯にキャンペーンA系の訴求を増やし、右画面QR固定テンプレートで再配信することを推奨します。
```

### 注意

- AIコメントは事実データに基づく。
- 推測しすぎない。
- 広告効果や売上増加を断定しない。
- 「可能性」「傾向」「推奨」という表現にする。

## 集計SQL例

### 日別再生数

```sql
SELECT
  date_trunc('day', started_at AT TIME ZONE 'Asia/Tokyo') AS day,
  COUNT(*) AS play_count,
  COUNT(*) FILTER (WHERE completed = true) AS completed_count
FROM play_events
WHERE started_at >= $1 AND started_at < $2
GROUP BY day
ORDER BY day;
```

### 広告主別再生数

```sql
SELECT
  a.name AS advertiser_name,
  c.name AS campaign_name,
  e.placement_key,
  COUNT(*) AS started_count,
  COUNT(*) FILTER (WHERE e.completed = true) AS completed_count
FROM ad_play_events e
JOIN advertisers a ON e.advertiser_id = a.id
JOIN ad_campaigns c ON e.campaign_id = c.id
WHERE e.started_at >= $1 AND e.started_at < $2
GROUP BY a.name, c.name, e.placement_key
ORDER BY started_count DESC;
```

### QRクリック数

```sql
SELECT
  date_trunc('day', clicked_at AT TIME ZONE 'Asia/Tokyo') AS day,
  COUNT(*) AS click_count
FROM qr_events
WHERE clicked_at >= $1 AND clicked_at < $2
GROUP BY day
ORDER BY day;
```

## 権限

| ロール | 権限 |
| --- | --- |
| operator | 全レポート閲覧、CSV/PDF生成、AIコメント生成 |
| customer_admin | 自社tenant/契約施設のレポート閲覧、CSV取得 |
| advertiser_viewer | 自分の広告キャンペーンのみ閲覧 |
| viewer | 月次サマリー閲覧のみ |

## 実装順序

1. レポート用集計API summary
2. device-uptime API
3. content-performance API
4. QR report API
5. advertiser report API
6. CSV export
7. レポートUI: サマリー
8. レポートUI: 稼働
9. レポートUI: コンテンツ
10. レポートUI: QR
11. レポートUI: 広告
12. report_snapshots
13. PDF export
14. AIコメント生成
15. 自動メール送付

## QAチェックリスト

### 集計

- 期間指定が正しく効く
- JST日付で集計される
- 店舗指定が効く
- 広告主指定が効く
- QRクリック数が正しく集計される
- オフライン同期後のplaylogが二重計上されない

### CSV

- UTF-8 BOM付きで出力できる
- Excelで文字化けしない
- 期間/店舗/広告主の条件が反映される
- 件数が画面表示と一致する

### 権限

- advertiser_viewerは他社キャンペーンを見られない
- viewerはCSV出力できない設定にできる
- customer_adminは自社tenant外を見られない

### PDF Phase 2

- 表紙に期間と店舗名が出る
- グラフと表が崩れない
- 広告主向けには他広告主情報が出ない

## 完了条件

Phase 1完了条件:

- サマリーレポートを表示できる
- 端末稼働率を表示できる
- 素材別再生数を表示できる
- QRクリック数を表示できる
- 広告主別レポートを表示できる
- CSV出力できる
- tenant/advertiser権限で閲覧範囲を制御できる

Phase 2完了条件:

- 月次PDFを出力できる
- 広告主向けPDFを出力できる
- report_snapshotsで月次レポートを固定保存できる
- AIコメントを生成できる

## 他に残っている重要設計

レポート以外で今後必要になる設計:

1. 契約/請求/レンタル資産管理
2. 申込から設置までのオーダーフロー
3. コンテンツ承認フロー
4. 顧客/広告主/代理店の権限管理
5. SLA/保守メニュー
6. 端末交換/撤去/回収フロー
7. セキュリティ・監査ログ
8. バックアップ/障害復旧
9. テンプレート制作ガイド
10. 営業デモシナリオ

## Codex向けプロンプト

```text
Implement Misell Reporting Dashboard Phase 1.

Read docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md and docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md first.

Goal:
Build reporting APIs and UI for summary, device uptime, content performance, QR report, advertiser report, and CSV export.

Constraints:
- Use JST for daily aggregation.
- Do not double count offline synced play events.
- Enforce tenant/advertiser access control.
- PDF and AI comments are Phase 2, not Phase 1.
- CSV should be Excel-friendly UTF-8 BOM.

Implementation order:
1. Summary API
2. Device uptime API
3. Content performance API
4. QR report API
5. Advertiser report API
6. CSV export
7. Basic dashboard UI
8. Access control tests
9. QA checklist
```

## 更新日

2026-06-15
