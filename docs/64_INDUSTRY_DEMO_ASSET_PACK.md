# 64. 業種別デモ素材パック

## 目的

安心お宿、バリアン、パセラ、ビジョンセンター向けの初回商談で、Misellの3連サイネージを「その施設で使うならこう見える」と示すためのデモ素材URLを定義する。

この素材パックは、実在ロゴや実写素材を使わない商談用モックである。正式提案や公開表示では、施設側の許諾済み写真、ロゴ、価格、リンクへ差し替える。

## 表示方法

```bash
cd apps/player
npm start
```

- 3面プレビュー: `http://localhost:3000/player?preview=1`
- 管理画面: `http://localhost:3000/admin`
- playlist: `apps/player/data/playlist.json`
- playlist version: `local-demo-20260608-002`

## 安心お宿向けデモ

Issue #18 のチェックリストに対応する。

| 目的 | playlist item | Left | Center | Right |
| --- | --- | --- | --- | --- |
| 館内案内 | `anshin-guide` | フロア案内 | 今日のおすすめ導線 | 館内案内QR |
| サウナ/休憩訴求 | `anshin-sauna` | 滞在ルーティン | 湯上がり訴求 | 休憩QR |
| 近隣広告枠例 | `anshin-localads` | 地域広告説明 | 周辺おすすめ | クーポンQR |
| QRサンプル | `anshin-qr` | QR用途整理 | QR計測訴求 | 館内メニューQR |

ワイド導入カット:

- `anshin-wide`
- `/demo/industry.html?industry=anshin-oyado&scene=wide&zone=wide`

QRサンプル:

- `https://misell.example/anshin/guide`
- `https://misell.example/anshin/sauna`
- `https://misell.example/anshin/local`
- `https://misell.example/anshin/qr`

商談での話し方:

- 館内問い合わせ削減、滞在単価アップ、近隣広告枠を同じ導線で見せる
- 大浴場/朝食/休憩など、時間帯別playlistで内容を切り替えられることを伝える
- QR別の読み取り数を月次レポートにできることをKPIとして置く

## バリアン向けデモ

Issue #19 のチェックリストに対応する。

| 目的 | playlist item | Left | Center | Right |
| --- | --- | --- | --- | --- |
| ルームサービス訴求 | `balian-roomservice` | 人気セット | 料理ヒーロー | 注文QR |
| 記念日プラン訴求 | `balian-anniversary` | 記念日特典 | 演出訴求 | 予約QR |
| アメニティ案内 | `balian-amenity` | 無料/有料整理 | アメニティ訴求 | 詳細QR |
| 予約導線QR | `balian-reservation` | 次回予約特典 | 再来店導線 | 空室確認QR |

ワイド導入カット:

- `balian-wide`
- `/demo/industry.html?industry=balian&scene=wide&zone=wide`

QRサンプル:

- `https://misell.example/balian/roomservice`
- `https://misell.example/balian/anniversary`
- `https://misell.example/balian/amenity`
- `https://misell.example/balian/reserve`

商談での話し方:

- ルームサービス注文、記念日オプション、次回予約を滞在中の導線として見せる
- 実写素材がなくても非日常感の構成を先に確認できることを伝える
- 注文QR、予約QR、オプション相談QRを分けて成果を測る

## パセラ向けデモ

Issue #20 のチェックリストに対応する。

| 目的 | playlist item | Left | Center | Right |
| --- | --- | --- | --- | --- |
| フード/ドリンク訴求 | `pasela-food` | 本日の推しメニュー | 商品ヒーロー | 注文QR |
| コラボ告知 | `pasela-collab` | 限定特典 | コラボルーム | 予約QR |
| イベント案内 | `pasela-event` | タイムテーブル | イベント訴求 | 参加予約QR |
| 回遊導線QR | `pasela-tour` | 系列施設マップ | 回遊メディア訴求 | 回遊先QR |

ワイド導入カット:

- `pasela-wide`
- `/demo/industry.html?industry=pasela&scene=wide&zone=wide`

QRサンプル:

- `https://misell.example/pasela/order`
- `https://misell.example/pasela/collab`
- `https://misell.example/pasela/event`
- `https://misell.example/pasela/tour`

商談での話し方:

- 飲食注文、コラボ予約、イベント参加、系列施設送客を1つの導線として見せる
- 施設側が用意する写真やロゴがなくても、表示構成と収益導線を先に合意できることを伝える
- QR読み取り数、注文/予約遷移、広告主候補数をテスト導入KPIに置く

## ビジョンセンター向けデモ

Issue #21 のチェックリストに対応する。

| 目的 | playlist item | Left | Center | Right |
| --- | --- | --- | --- | --- |
| 会場案内 | `vision-guide` | 会場と時刻 | 現在開催中イベント | 会場MAP QR |
| 配信パック訴求 | `vision-streaming` | 配信の不安 | 配信パック価値 | 相談QR |
| スポンサー枠例 | `vision-sponsor` | 協賛枠説明 | 広告枠サンプル | 資料請求QR |
| 受付案内 | `vision-reception` | 受付フロー | 受付場所案内 | チェックインQR |

ワイド導入カット:

- `vision-wide`
- `/demo/industry.html?industry=vision-center&scene=wide&zone=wide`

QRサンプル:

- `https://misell.example/vision/map`
- `https://misell.example/vision/streaming`
- `https://misell.example/vision/sponsor`
- `https://misell.example/vision/reception`

商談での話し方:

- 受付問い合わせ削減、配信パック問い合わせ、スポンサー枠販売を同じ表示面で説明する
- イベント名、会場名、スポンサー名を差し替えれば即日デモに転用できることを見せる
- QR別に読み取りを分けることで、会場内メディアとしての成果報告につなげる

## 素材URLルール

業種別素材は1つのHTMLテンプレートで管理し、query stringで表示内容を切り替える。

```text
/demo/industry.html?industry=<industry>&scene=<scene>&zone=<zone>
```

| パラメータ | 値 |
| --- | --- |
| `industry` | `anshin-oyado`, `balian`, `pasela`, `vision-center` |
| `scene` | `wide`, `guide`, `sauna`, `localads`, `qr`, `roomservice`, `anniversary`, `amenity`, `reservation`, `food`, `collab`, `event`, `tour`, `streaming`, `sponsor`, `reception` |
| `zone` | `wide`, `left`, `center`, `right` |

## 撮影チェック

商談前に以下を確認する。

- `/player?preview=1` で `anshin-wide` から順に表示される
- 安心お宿の4テーマがすべて出る
- バリアンの4テーマがすべて出る
- パセラの4テーマがすべて出る
- ビジョンセンターの4テーマがすべて出る
- QRサンプルが右画面またはワイド画面に出る
- 管理画面のplaylist editorで業種別demo URLを選択できる
- 実在ロゴ、実在写真、未許諾キャンペーン名が入っていない

## 差し替え時の注意

- 写真やロゴは許諾済み素材だけを使う
- QRはテスト導入先ごとに異なるURLへ差し替える
- 価格や特典は施設側確認後に確定する
- スポンサー枠は広告審査と掲出期間を明記する
- 撮影後は `docs/52_MVP_GATE_EVIDENCE_TEMPLATE.md` のGate 5へ証跡を残す
