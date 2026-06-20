# 79. AI Campaign Studio 継続率向上ループ仕様

## 目的

Misellを単なる3連サイネージCMSではなく、毎月の販促運用をAIとStudioで前に進める運用OSにする。

顧客の深いペインは「動画を作れない」だけではない。実際には、以下が継続利用を阻害する。

- 毎月何を訴求すればよいか分からない
- 更新担当者がいない、または更新が後回しになる
- 導入後にコンテンツが放置される
- CMSへログインする理由がない
- 成果や改善理由を社内説明できない
- 広告主やコラボ先へ提示できる制作・承認・レポートの型がない

この仕様では、AIが月次販促案を提案し、顧客が選択し、Misell Studioで編集可能なキャンペーンと動画/HTMLを生成し、公開後のログを次回提案へ戻すループを定義する。

```text
AI月次販促提案
  ↓
顧客が選択
  ↓
Campaign Generator
  ↓
Scene Editor / 3連プレビュー
  ↓
Render / Publish
  ↓
playlog / QR log / report
  ↓
顧客コンテキスト更新
  ↓
翌月のAI提案改善
```

## 基本方針

### Misell Studioの勝ち方

NoviSign同等以上を目指すが、汎用CMSとして機能数で勝つのではない。

Misellは、3連サイネージの販促制作・配信・改善において、NoviSignより速く、迷わず、継続運用できることを勝ち筋にする。

やるべきこと:

- 3連プレビューを中心に置く
- 完全自由配置より、3連テンプレートとScene編集を優先する
- AI提案をStudioの入口にする
- AI生成結果を完成動画ではなく編集可能なCampaignProjectとして保持する
- 公開後のplaylog/QR/log/reportを翌月提案に反映する

やらないこと:

- 最初から汎用サイネージCMSを丸ごと再現する
- 大量ウィジェットを優先する
- 高度な動画編集タイムラインを先に作る
- AIが勝手に公開する
- ログや根拠なしにAIが成果を盛る

## プロダクト仮説

Misellの中核価値は以下。

> 毎月、顧客が考えなくても販促案が届き、選ぶだけで3連サイネージ用キャンペーン・動画/HTML・QR・スケジュールまで作れる。

導入角度:

- 「サイネージを置きませんか」ではなく「毎月の販促更新をAIと運用で止めません」
- 「動画制作できます」ではなく「今月やるべき販促案が自動で出ます」
- 「CMSです」ではなく「選ぶだけで3連キャンペーンができます」

継続率向上の理由:

- 顧客が毎月ログインする理由ができる
- 更新停止を防げる
- 成果がレポートに残る
- 翌月提案が顧客ごとに改善される
- 顧客が選んだ/却下した文脈がMisell内に資産化される

## 対象スコープ

### この仕様に含める

- AI Monthly Campaign Proposal
- Customer Context / Context Builder
- Campaign Brief
- Campaign Generator
- CampaignProject / Scene model
- Scene Editor
- Partial Regeneration
- Render / Publish handoff
- AI generation quota / credit ledger
- Collaboration Campaign input
- Learning loop

### この仕様から外す

- AIカメラ
- 匿名人数カウント
- 補助金
- 顔識別/属性推定
- 高度な広告配信最適化
- SSO/API/本部向け高度権限

AIカメラは別フェーズで扱う。ここでは、販促提案・生成・編集・公開・レポートのループに集中する。

## ユーザーフロー

### 月次AI提案フロー

```text
毎月1日など指定日
  ↓
Misell AI Agentが顧客ごとの文脈を取得
  ↓
今月の販促案を5〜10件生成
  ↓
顧客管理画面に「今月のおすすめ」として表示
  ↓
顧客が案を選択
  ↓
生成ボタンを押す
  ↓
CampaignProjectが作成される
  ↓
StudioでScene編集・3連プレビュー
  ↓
公開
```

### 自由入力フロー

```text
顧客が「自分で企画を入力」
  ↓
custom_briefを作成
  ↓
顧客コンテキストを補完
  ↓
Campaign Generatorへ渡す
  ↓
以降は月次提案と同じ
```

### コラボ企画フロー

```text
顧客がコラボ/広告主企画を入力
  ↓
collaboration_briefを作成
  ↓
partner_profile / brand_usage_notesを追加
  ↓
Campaign Generatorへ渡す
  ↓
Studioで編集
  ↓
外部確認用プレビューURL
  ↓
承認後に公開
```

## 月額内に含めるもの

月額内に含めるべきものは「提案」である。

理由:

- 継続率を上げるコア体験である
- 顧客に「今月もMisellが動いている」と感じてもらえる
- 生成前の案は比較的低コストで量産できる
- 顧客が選ぶことで好みと文脈が蓄積される

月額内に含める候補:

- 月次販促案5〜10件
- 各案のタイトル
- 狙い
- 想定ターゲット
- 3連構成ラフ
- QR導線案
- 推奨配信時間
- 期待する効果
- 必要素材
- 採用/保留/却下の記録

## クレジットまたは生成枠の対象

生成処理はコストが発生するため、月間生成枠またはクレジット制にする。

顧客には細かいcreditではなく、次のように表示する。

```text
今月の生成枠: 3本
使用済み: 1本
残り: 2本
追加生成: 1本 10,000円
```

内部的にはcredit ledgerで管理する。

クレジット対象:

- キャンペーン初回生成
- 画像生成
- 動画生成
- HTML/MP4書き出し
- Scene単位再生成
- コピーだけ再生成
- QR/CTA周り再生成
- 多言語版生成
- LP生成
- POPタグ生成
- 広告主向け別バージョン生成

プラン案:

| プラン | 月次AI提案 | 月間生成枠 | 追加生成 |
| --- | ---: | ---: | --- |
| Lite | 5案 | 1本/月 | 有料 |
| Standard | 10案 | 3本/月 | 有料 |
| Media | 10案 + 広告案 | 5本/月 | 有料 |
| AI Edge | 20案 | 10本/月 | 有料 |

## Campaign Generator

月次提案、自由入力、コラボ企画は、入力元が違うだけで同じ生成処理に渡す。

```text
CampaignProposal selected
CustomBrief submitted
CollaborationBrief submitted
  ↓
CampaignBriefへ正規化
  ↓
Context Builder
  ↓
Campaign Generator
```

### 生成パイプライン

```text
brief
  ↓
顧客コンテキスト取得
  ↓
キャンペーン設計
  ↓
3連構成
  ↓
コピー生成
  ↓
カット割生成
  ↓
素材選定/生成
  ↓
QR/CTA生成
  ↓
スケジュール案生成
  ↓
CampaignProject / Sceneとして保存
  ↓
プレビュー
```

## 顧客コンテキスト

AI生成精度を上げるには、チャット履歴を丸ごと渡すのではなく、構造化された顧客コンテキストを持つ。

### 保存すべき情報

| コンテキスト | 内容 |
| --- | --- |
| facility_profile | 業態、店舗名、所在地、営業時間、設置場所、客層 |
| brand_profile | トーン、NG表現、ロゴ、色、フォント、表記ルール |
| products_services | 売りたい商品、価格、説明、利益率、季節商品 |
| campaign_history | 実施内容、配信期間、素材、結果 |
| performance_logs | 放映回数、QRクリック、時間帯別反応 |
| selected_preferences | 選ばれやすい案、採用された文言、好まれる構成 |
| rejected_patterns | 却下された案、NG表現、避けたい方向性 |
| asset_library | 過去画像、動画、ロゴ、写真、使用中素材 |
| operation_rules | 表示できない内容、広告審査、法務NG、営業時間 |
| seasonal_calendar | 年間販促カレンダー、施設イベント、地域イベント |
| language_rules | 多言語表記、翻訳確認ルール |

### Context Builder

生成時に全データをAIへ渡さない。Context Builderが必要な情報だけ抽出する。

```text
生成リクエスト
  ↓
対象顧客・業態・季節・目的を判定
  ↓
関連する過去キャンペーンを取得
  ↓
反応の良かった素材を取得
  ↓
NG表現を取得
  ↓
ブランドトーンを取得
  ↓
商品/サービス情報を取得
  ↓
AI生成プロンプトに渡す
```

## データモデル案

最低限、以下を分ける。

```text
Customer
Site
ScreenGroup
BrandProfile
FacilityProfile
Asset
CampaignProposal
CampaignBrief
CampaignProject
Scene
SceneSlot
RenderedAsset
PlaylistItem
Schedule
PublishJob
Playlog
QrLog
MonthlyReport
AiGenerationJob
AiCreditLedger
```

### CampaignProposal と CampaignProject の分離

| 概念 | 意味 |
| --- | --- |
| CampaignProposal | AIが毎月出す「案」 |
| CampaignBrief | 生成エンジンへ渡す正規化入力 |
| CampaignProject | 顧客が選んで実際に制作する「案件」 |
| Scene | 編集可能なカット割 |
| RenderedAsset | 実際に配信されるHTML/MP4 |
| PlaylistItem | 再生リスト内の表示単位 |
| Schedule | いつ流すか |
| MonthlyReport | 結果と次回提案 |

## CampaignProject / Scene の考え方

AIが完成MP4だけを返すと、修正が難しい。

生成結果は、必ず編集可能な構造データとして保存する。

```json
{
  "campaign_id": "CMP-2026-07-001",
  "title": "夏のサウナ回遊キャンペーン",
  "objective": "館内回遊とQR案内を増やす",
  "scenes": [
    {
      "scene": 1,
      "duration": 4,
      "layout": "wide_intro",
      "copy": "夏の疲れを、サウナでリセット。",
      "assets": ["asset_bg_001"],
      "transition": "fade"
    },
    {
      "scene": 2,
      "duration": 6,
      "layout": "three_zone",
      "left": {
        "copy": "大浴場のご案内",
        "asset": "asset_map_001"
      },
      "center": {
        "copy": "おすすめサウナ導線",
        "asset": "asset_video_001"
      },
      "right": {
        "copy": "館内マップはこちら",
        "qr_id": "QR-001"
      }
    }
  ],
  "schedule": {
    "start_date": "2026-07-01",
    "end_date": "2026-07-31",
    "time_slots": ["17:00-24:00"]
  }
}
```

この構造を正本にして、HTMLプレビュー、MP4レンダリング、playlist登録、schedule登録、再編集、部分再生成を行う。

## Scene Editor

最初からPremiereやCanvaのような自由タイムラインを作らない。

まずはScene編集型にする。

```text
Scene 1: 導入 3秒
Scene 2: メイン訴求 6秒
Scene 3: 詳細 4秒
Scene 4: QR/CTA 5秒
```

### 編集項目

- 秒数
- レイアウト
- 背景素材
- 左画面文言
- 中央画面文言
- 右画面文言
- wide文言
- QR
- CTA
- テロップ
- 遷移
- ロゴ位置

### 部分再生成

全体再生成だけにしない。

必要な操作:

- Sceneだけ再生成
- コピーだけ再生成
- QR周りだけ再生成
- 右画面だけ再生成
- 別写真を使って再生成
- 3案だけ追加生成

## Studio UI

AIは別メニューに隔離しない。Studioの入口と編集補助に組み込む。

```text
キャンペーン一覧
  └── 今月のAI提案
      ├── 案1: 夏のサウナ回遊
      ├── 案2: 朝食利用アップ
      ├── 案3: 近隣飲食広告
      ...
```

案をクリックすると以下を表示する。

```text
この案で作成
コピーだけ変更
別パターンを作る
この案を却下
```

生成後はStudio画面へ移る。

```text
Scene一覧
3連プレビュー
素材差し替え
QR設定
スケジュール
公開
```

## Render / Publish

Phase 1ではHTMLプレビュー/HTML配信を優先する。
MP4書き出しは後続Phaseでもよい。

公開時には以下へ接続する。

- content_manifest
- playlist_item
- schedule
- qr_link
- playlog
- reporting

## Learning Loop

継続率を上げる本質は、毎月の運用ループである。

```text
導入
  ↓
AIが毎月10案出す
  ↓
顧客が選ぶ
  ↓
AIが生成する
  ↓
Studioで編集する
  ↓
公開する
  ↓
QR/放映ログが貯まる
  ↓
月次レポートが出る
  ↓
翌月の提案が改善される
```

次回生成に反映する情報:

- 採用された案
- 却下された案
- 却下理由
- 編集された文言
- 差し替えられた素材
- 実際に公開されたcampaign
- QR反応
- 放映ログ
- 時間帯別反応
- 月次レポートコメント

## Collaboration Campaign

コラボ企画や広告主企画は生成エンジン自体は共通にする。

ただし、追加で以下が必要になる。

- partner_profile
- collaboration_brief
- ロゴ利用ルール
- NG表現
- 相手企業確認者
- 承認ステータス
- 確認用プレビューURL
- 差し戻し履歴
- 掲載終了後レポート

このため、通常のAI Campaignとは別Issueで実装する。

## フェーズ分け

### Phase 1: AI Monthly Proposal / Customer Context

目的: 毎月ログインする理由を作る。

- 月次販促案5〜10件
- customer context
- Context Builder
- 採用/保留/却下
- 顧客管理画面への表示

対応Issue: #145

### Phase 2: Campaign Generator

目的: 選んだ案を編集可能なキャンペーンへ変換する。

- CampaignBrief
- CampaignProject
- Scene model
- QR/CTA案
- schedule draft
- HTML preview draft

対応Issue: #146

### Phase 3: Scene Editor / Render / Publish

目的: 顧客が生成物を調整し、公開できる状態にする。

- Scene編集
- 3連プレビュー
- 部分再生成
- HTML配信
- playlist/schedule変換
- publish/rollback設計

対応Issue: #147

### Phase 4: Quota / Credit / Collaboration

目的: 生成コスト管理とコラボ企画対応を行う。

- 月間生成枠
- credit ledger
- 追加生成
- collaboration campaign
- 外部確認プレビュー

対応Issue: #148, #149

## 既存仕様との接続

- `docs/42_AI_ADDON_SPEC.md`: AI Copy / AI Report / AI Schedulerを本仕様の体験へ統合する
- `docs/67_MISELL_STUDIO_NOVISIGN_BENCHMARK_SPEC.md`: NoviSign型CMSの中核機能を3連特化Studioへ落とす
- `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md`: Campaign/Ad/QR/logの整合を保つ
- `docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md`: playlog/QR/monthly reportをLearning Loopへ戻す
- `docs/76_RBAC_AND_SELF_SERVICE_OPERATION_SPEC.md`: 顧客/partner/広告主のscopeを接続する

## 実装時の注意

- AI提案は月額内の継続価値にする
- 実生成は生成枠/クレジットで管理する
- AI生成結果は編集可能な構造データとして保持する
- AIが数値を作らない。レポートはログに基づく文章化に限定する
- 顧客データを勝手にAI学習へ使わない
- AIが勝手に公開しない。必ず人間確認とプレビューを挟む
- 汎用CMS化より3連販促の迷わなさを優先する

## 結論

Misell Studioは「動画を置くCMS」ではなく、「毎月の販促キャンペーンをAIと一緒に回す3連サイネージ運用OS」にする。

導入理由はサイネージ設置ではなく、毎月の販促更新と改善が止まらないこと。
継続理由はAI提案、編集可能な生成物、公開ログ、月次レポート、次回改善のループで作る。
