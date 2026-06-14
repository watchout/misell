# 70. 画面数・縦横・個別制作に対応するコンテンツ設計思想

## 目的

このドキュメントは、Misell Studioのコンテンツ制作機能を、初期は3連横型に絞りつつ、将来的に以下へ拡張できるようにするための設計思想を定義する。

- 1画面ごとの制作
- 3面wide制作
- 縦型サイネージ
- 横型サイネージ
- 4面以上の連結サイネージ
- 2x2、1x4、4x1、縦3連などの構成
- 施設別/店舗別/画面別のテンプレート展開

重要: 初期実装で全部作らない。最初は3連横型に絞る。ただし、データモデルとUI概念だけは、将来の面数増加・縦型対応で作り直しにならないようにする。

## 結論

Misell Studioは、内部的には「3連専用CMS」ではなく、**Display Wall上のScreenとZoneに対してContentを割り当てるCMS**として設計する。

ただし、UI上は最初から複雑にしない。

初期UI:

- 3連横型
- 左 / 中央 / 右
- 3面wide
- テンプレート選択型

内部設計:

- Display Wallは任意の行数/列数を持てる
- Screenは向き、解像度、位置を持つ
- Layoutは複数Zoneを持つ
- Zoneは単一Screenにも複数Screen横断にも対応する
- Assetは縦型/横型/ワイドなどの推奨比率を持つ

## 基本概念

```text
Tenant
└── Site
    └── Display Wall
        ├── Screen
        ├── Screen
        └── Screen

Template
└── Layout
    ├── Zone
    ├── Zone
    └── Zone

Asset
Playlist
Schedule
Publish
Device
```

## Display Wall

Display Wallは、連結された表示面全体を表す。

例:

- 3連横型: 3 columns x 1 row
- 3連縦型: 1 column x 3 rows
- 2x2: 2 columns x 2 rows
- 4連横型: 4 columns x 1 row
- 単画面: 1 column x 1 row

Display Wallが持つべき情報:

| 項目 | 内容 |
| --- | --- |
| name | 表示面名。例: フロント3連、入口サイネージ |
| orientation | horizontal / vertical / grid / custom |
| columns | 横方向の画面数 |
| rows | 縦方向の画面数 |
| total_width | 全体キャンバス幅 |
| total_height | 全体キャンバス高さ |
| default_layout_id | 既定レイアウト |
| site_id | 設置場所 |

初期実装では、Display Wallは `columns=3, rows=1, orientation=horizontal` 固定でよい。

ただし、DBと型定義には columns / rows / orientation を入れておく。

## Screen

Screenは物理モニター1枚を表す。

Screenが持つべき情報:

| 項目 | 内容 |
| --- | --- |
| display_wall_id | 所属するDisplay Wall |
| screen_key | left / center / right / screen_1 など |
| name | UI表示名。例: 左画面 |
| index | 並び順 |
| row | グリッド上の行 |
| column | グリッド上の列 |
| x | 全体キャンバス上のX座標 |
| y | 全体キャンバス上のY座標 |
| width | 画面幅 |
| height | 画面高さ |
| orientation | landscape / portrait |
| rotation | 0 / 90 / 180 / 270 |
| physical_model | モニター型番 |

初期の3連横型:

```text
Display Wall: 5760 x 1080

left:
  x=0
  y=0
  width=1920
  height=1080
  orientation=landscape

center:
  x=1920
  y=0
  width=1920
  height=1080
  orientation=landscape

right:
  x=3840
  y=0
  width=1920
  height=1080
  orientation=landscape
```

縦型3連の将来例:

```text
Display Wall: 1080 x 5760

top:
  x=0
  y=0
  width=1080
  height=1920
  orientation=portrait

middle:
  x=0
  y=1920
  width=1080
  height=1920
  orientation=portrait

bottom:
  x=0
  y=3840
  width=1080
  height=1920
  orientation=portrait
```

## Zone

Zoneは、レイアウト内の表示枠である。

Zoneは単一Screenにも、複数Screenをまたぐ領域にもできる。

例:

- left_zone: 左画面全体
- center_zone: 中央画面全体
- right_zone: 右画面全体
- wide_zone: 3画面ぶち抜き
- qr_zone: 右下QR枠
- ticker_zone: 下部テロップ

Zoneが持つべき情報:

| 項目 | 内容 |
| --- | --- |
| layout_id | 所属レイアウト |
| zone_key | left / center / right / wide / qr など |
| name | UI表示名 |
| x | Display Wallキャンバス上のX座標 |
| y | Display Wallキャンバス上のY座標 |
| width | Zone幅 |
| height | Zone高さ |
| target_screens | 対象Screen配列 |
| content_fit | cover / contain / fill |
| allowed_asset_types | image / video / web / qr など |
| safe_area | 余白/文字切れ対策 |

重要:

- ZoneはScreenに固定しない。
- ZoneはDisplay Wall全体キャンバス上の矩形として扱う。
- これにより、3面wideや2x2横断に対応できる。

## Layout

Layoutは、Display Wall上のZone配置を定義する。

初期レイアウト:

### three-zone

```text
left   center   right
```

Zone:

- left: 0,0,1920,1080
- center: 1920,0,1920,1080
- right: 3840,0,1920,1080

### wide

```text
wide across all 3 screens
```

Zone:

- wide: 0,0,5760,1080

### center-main

```text
left ad | center main | right QR/info
```

Zone:

- left_ad
- center_main
- right_info

将来レイアウト:

- 1x1 single
- 1x3 vertical
- 4x1 horizontal
- 2x2 grid
- 1x4 menu board
- 3x1 + lower ticker
- custom grid

## Asset

Assetは画像、動画、Webコンテンツ、QR、テンプレート素材を表す。

Assetには、縦横や推奨用途をメタ情報として持たせる。

Assetが持つべき情報:

| 項目 | 内容 |
| --- | --- |
| type | image / video / web / qr / html |
| width | 元素材幅 |
| height | 元素材高さ |
| aspect_ratio | 比率 |
| orientation | landscape / portrait / square / ultra_wide |
| duration_ms | 動画/表示秒数 |
| recommended_zone | left / center / right / wide など |
| validation_status | ok / warning / error |

Asset分類:

| 種類 | 例 | 用途 |
| --- | --- | --- |
| landscape | 1920x1080 | 1画面横型 |
| portrait | 1080x1920 | 縦型サイネージ |
| ultra_wide | 5760x1080 | 3面wide |
| square | 1080x1080 | SNS素材転用 |
| banner | 横長帯 | テロップ/下部広告 |

## コンテンツ制作機能の考え方

### 初期実装

最初は、以下の制作方法に絞る。

1. 既存素材をアップロード
2. 3連テンプレートを選ぶ
3. 左/中央/右/wideの枠に素材を割り当てる
4. 文字やQRの簡易差し込み
5. プレビュー
6. 公開

初期では、Canvaのような自由なデザインエディタは作らない。

### 1画面ごとの制作

1画面ごとの制作は、初期から思想として入れる。

UI:

- 左画面を編集
- 中央画面を編集
- 右画面を編集
- 3面wideを編集

できること:

- 背景画像/動画を入れる
- テキストを入れる
- QRを入れる
- ロゴを入れる
- テンプレートを選ぶ

Phase 1では完全自由配置ではなく、定型テンプレート内の差し替えにする。

### 3面wide制作

3面wideは、Misellの差別化ポイント。

対応する制作方式:

- 5760x1080動画をそのまま使う
- 1920x1080素材を3枚並べる
- 1枚の横長画像を3面にまたがって表示する
- 中央メイン + 左右補助のテンプレートを使う

注意:

- 3面wideは1台端末・1キャンバスだから同期しやすい。
- 3台プレイヤー方式ではズレが出やすい。
- Misellではwideを標準機能にする。

### 縦型対応

初期実装では縦型UIを作らなくてもよい。

ただし、以下は最初からデータとして持つ。

- Screen.orientation
- Screen.rotation
- DisplayWall.orientation
- Asset.orientation
- Template.supported_orientations
- Layout.canvas_width / canvas_height

将来の縦型ユースケース:

- 店頭入口の縦型1枚
- エレベーターホール
- ホテルフロント
- 商業施設の縦型案内
- 縦3連の演出

## Template

Templateは、Layoutと初期Zone設定、推奨Asset比率を持つ。

Templateが持つべき情報:

| 項目 | 内容 |
| --- | --- |
| name | テンプレート名 |
| display_wall_type | 3x1 / 1x3 / 2x2 / 1x1 など |
| supported_orientations | landscape / portrait / grid |
| zones | Zone定義 |
| recommended_assets | 推奨素材仕様 |
| industry_tags | 飲食 / ホテル / 小売 / イベント |
| difficulty | easy / standard / advanced |

初期テンプレートは3x1 landscapeだけでよい。

ただし、Templateには `display_wall_type` と `supported_orientations` を入れる。

## UI設計思想

### 初期UIでは複雑に見せない

ユーザーには最初、以下だけ見せる。

```text
表示タイプを選ぶ
- 3画面別々
- 3面ワイド
- 中央メイン
- 右QR付き
```

将来、設定画面で高度なDisplay Wallを有効化する。

```text
高度な表示構成
- 単画面
- 縦型
- 4画面
- 2x2
- カスタム
```

### 編集UI

初期編集UI:

```text
[左画面] [中央画面] [右画面]

各枠をクリック
↓
素材を選ぶ
↓
テキスト/QRを設定
↓
プレビュー
```

wide編集UI:

```text
[  3面wideプレビュー  ]

横長素材を入れる
または
左/中央/右を個別に指定する
```

縦型将来UI:

```text
[縦型プレビュー]

上/中央/下
または
1枚縦型
```

## データモデル推奨

既存のPlaylist/Asset/Deviceに、以下概念を追加できるようにする。

### display_walls

```sql
CREATE TABLE display_walls (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id UUID NOT NULL,
  name TEXT NOT NULL,
  orientation TEXT NOT NULL DEFAULT 'horizontal',
  columns INTEGER NOT NULL DEFAULT 3,
  rows INTEGER NOT NULL DEFAULT 1,
  total_width INTEGER NOT NULL DEFAULT 5760,
  total_height INTEGER NOT NULL DEFAULT 1080,
  default_layout_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### screens

```sql
CREATE TABLE screens (
  id UUID PRIMARY KEY,
  display_wall_id UUID NOT NULL REFERENCES display_walls(id),
  screen_key TEXT NOT NULL,
  name TEXT NOT NULL,
  screen_index INTEGER NOT NULL,
  row_index INTEGER NOT NULL DEFAULT 0,
  column_index INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  orientation TEXT NOT NULL DEFAULT 'landscape',
  rotation INTEGER NOT NULL DEFAULT 0,
  physical_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### layouts

```sql
CREATE TABLE layouts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  display_wall_id UUID NOT NULL REFERENCES display_walls(id),
  name TEXT NOT NULL,
  layout_type TEXT NOT NULL,
  canvas_width INTEGER NOT NULL,
  canvas_height INTEGER NOT NULL,
  is_template BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### layout_zones

```sql
CREATE TABLE layout_zones (
  id UUID PRIMARY KEY,
  layout_id UUID NOT NULL REFERENCES layouts(id),
  zone_key TEXT NOT NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  target_screens JSONB NOT NULL,
  content_fit TEXT NOT NULL DEFAULT 'cover',
  allowed_asset_types JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### asset metadata追加

既存Assetに追加したい項目:

```sql
ALTER TABLE assets ADD COLUMN width INTEGER;
ALTER TABLE assets ADD COLUMN height INTEGER;
ALTER TABLE assets ADD COLUMN aspect_ratio TEXT;
ALTER TABLE assets ADD COLUMN orientation TEXT;
ALTER TABLE assets ADD COLUMN duration_ms INTEGER;
ALTER TABLE assets ADD COLUMN validation_status TEXT DEFAULT 'ok';
```

## バリデーション

素材アップロード時にチェックする。

### 横1画面

推奨: 1920x1080 / 16:9

### 縦1画面

推奨: 1080x1920 / 9:16

### 3面wide

推奨: 5760x1080 / 16:3

### 2x2

推奨: 3840x2160 / 16:9全体、または各画面1920x1080

警告例:

- この素材は縦型です。横画面に入れると左右に余白が出ます。
- この素材は3面wideには解像度が不足しています。
- QRが小さすぎます。推奨サイズは画面幅の10%以上です。
- 文字が小さすぎる可能性があります。

## 実装優先順位

### Phase 1

作る:

- 3x1 horizontal Display Wall固定
- Screen: left/center/right
- Layout: three-zone / wide
- ZoneへのAsset割り当て
- 3連プレビュー
- Assetのwidth/height/orientation保存
- 素材比率警告

作らない:

- 縦型UI
- 2x2 UI
- 完全自由配置
- 任意画面数のUI

### Phase 2

- 縦型1画面テンプレート
- 3面wide制作補助
- 1画面ごとの簡易テキスト/QR編集
- Templateにsupported_orientations追加
- 4面横型の内部対応

### Phase 3

- 2x2 / 1x4 / 4x1表示
- 高度なDisplay Wall設定
- Zone比率編集
- テロップ/QR/時計/天気ウィジェット

### Phase 4

- カスタムキャンバス
- 複数端末同期が必要な構成
- 外部広告ネットワーク対応
- AIによるレイアウト最適化

## Codex向け指示

```text
Misell Studio should initially support only 3x1 horizontal signage in the UI, but the data model must be future-proof for orientation and screen count.

Do not build a full free-form design editor in Phase 1.

Implement DisplayWall, Screen, Layout, and LayoutZone concepts so that:
- current MVP supports left/center/right and wide
- future versions can support portrait signage
- future versions can support more than 3 screens
- zones can span one or more screens
- assets store width, height, aspect ratio, orientation, and validation status

Phase 1 UI should show only simple choices:
- 3 screens separately
- 3-screen wide
- center main
- right QR/info

Internal model must not hardcode exactly three screens everywhere. Use display_wall.columns, rows, screens, and layout_zones.
```

## 更新日

2026-06-15
