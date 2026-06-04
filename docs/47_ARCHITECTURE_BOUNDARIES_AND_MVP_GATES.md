# 47. Architecture Boundaries & MVP Gates

## 目的

Misellの開発では、local player / Remote CMS / field ops を混ぜすぎないことが重要である。

Misellはサイネージ商品であり、まずは `misell-player` が単体で確実に動作する必要がある。その上で、Remote CMS、端末管理、広告運用、AI分析を外側から連動させる。

## 1. 責務境界

### local player

`misell-player` は端末上で確実に表示し続けるための最小・堅牢なプレイヤーである。

責務：

- 3画面表示
- three-zone / wide 表示
- playlist読み込み
- playlist validation
- ローカル素材再生
- ローカルキャッシュ再生
- duration / start / end 制御
- 表示ログ保存
- device identity付きログ出力
- LAN管理画面MVP
- kiosk起動
- 自動復旧

local playerに入れすぎないもの：

- 複雑な広告販売管理
- 多店舗管理
- 複雑なユーザー権限
- 請求/決済
- AI分析本体
- 広告主向け高度レポート
- 営業/媒体資料生成

### Remote CMS

Remote CMSは、複数店舗・複数端末を遠隔で管理するための外側の管理基盤である。

責務：

- 店舗管理
- 端末管理
- 素材管理
- playlist作成/配信
- 広告キャンペーン管理
- 放映ログ集計
- QRログ集計
- 月次レポート
- ユーザー権限
- device pull同期
- heartbeat受信
- pending command管理

### field ops

field opsは、現場導入・運用・障害対応を標準化するための業務プロセスである。

責務：

- 現調
- 設置施工
- キッティング
- QA
- 端末交換
- 現地障害対応
- 事例写真/動画取得
- 顧客説明
- 保守記録

## 2. MVPで必ず証拠化すること

MVPは「コードが動く」だけでは合格ではない。

現地でサイネージとして使える証拠を残す。

### 合格項目

1. 3画面認識
2. Chromium kiosk起動
3. 再起動後の自動復旧
4. playlist切替
5. three-zone表示
6. wide表示
7. LAN管理画面から素材入れ替え
8. basic auth
9. upload制限
10. path traversal防止
11. 6時間連続再生
12. CPU/RAM/温度/ログ記録

### 証拠として残すもの

- xrandr出力結果
- 3画面表示写真
- kiosk表示動画
- 再起動復旧動画
- playlist切替動画
- 6時間burn-inログ
- CPU/RAM/温度ログ
- エラーログ
- admin認証画面スクリーンショット
- upload拒否テスト結果

## 3. MVP Gate

### Gate 1: Local Dev Pass

ローカルPCで以下が動くこと。

- npm start
- /player表示
- /admin表示
- preview mode
- playlist validation
- three-zone / wide

### Gate 2: Device Display Pass

実端末で以下が動くこと。

- Ubuntu起動
- 3画面認識
- 5760 x 1080 kiosk
- 再起動復旧

### Gate 3: Security Minimum Pass

テスト導入前に以下が入っていること。

- /admin basic auth
- upload拡張子/MIME/サイズ制限
- path traversal防止
- HTML upload禁止
- SSH hardening方針
- ufw最低設定

### Gate 4: Burn-in Pass

- 6時間連続再生
- ログ保存
- CPU/RAM/温度確認
- 明確な停止/エラーなし

### Gate 5: Demo Ready Pass

- 業種別デモ素材がある
- playlistで切替可能
- QRサンプルがある
- 提案資料に使える動画が撮れている

## 4. playlist schema方針

Remote CMSへの移行を見据えて、local playerのplaylist.jsonは最初からschemaを持つ。

最低必須field：

- playlist_version
- items
- item_id
- layout
- duration
- enabled

layoutごとの必須field：

### three-zone

- left
- center
- right

### wide

- wide

任意field：

- start
- end
- days_of_week
- campaign_id
- asset_id
- priority

validation：

- durationは1〜300秒
- layoutはthree-zoneまたはwide
- three-zoneではleft/center/rightが必須
- wideではwideが必須
- asset pathが存在する
- start/endはHH:mm形式
- enabled=falseは再生対象外

## 5. device identity先行導入

Remote CMS未導入でも、local playerのログには以下を含める。

- device_id
- store_id
- screen_group_id
- playlist_version
- playlist_item_id
- campaign_id
- asset_id

これにより、後続のクラウド同期・端末監視・レポートへ自然に移行できる。

## 6. Remote CMSは後続Phase

MVPではRemote CMSを作り込まない。

後続で入れる順番：

1. device pull方式
2. local cache
3. heartbeat
4. playlog backfill
5. pending command polling
6. campaign management
7. reporting
8. role-based access

## 7. 開発時の判断ルール

迷ったら以下で判断する。

- 表示継続に必要ならlocal playerへ入れる
- 複数店舗管理に必要ならRemote CMSへ逃がす
- 現場作業に関わるならfield opsへ切り出す
- 広告営業/レポート高度化は後続Phaseへ回す
- MVPでは、動作証拠と安定性を最優先する

## 8. 最重要原則

misell-playerは、単体で強くする。

Remote CMSやAIがなくても、端末1台で安定して3連サイネージとして機能することが、Misell事業の土台である。
