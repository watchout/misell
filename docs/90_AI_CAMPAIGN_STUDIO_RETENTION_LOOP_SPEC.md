# 90. AI Campaign Studio 継続率向上ループ仕様

## 目的

Misellを単なる3連サイネージCMSではなく、毎月の販促運用をAIとStudioで前に進める3連サイネージ運用OSにする。

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

## ステータス

この仕様は実装前ドラフトである。

以下のゲートを通過するまで、価格、課金、個人情報、広告表現、外部共有、AI出力の自動公開を「決定済」として扱わない。

| ゲート | 対象 | 状態 |
| --- | --- | --- |
| route:ceo-approval | plan / pricing / quota / credit ledger / 月額内外の境界 | 未承認ドラフト |
| needs:legal-privacy | customer context / partner data / retention / deletion / APPI対応 | 要確認 |
| needs:legal-ad-review | AI生成販促、広告主/コラボ表現、景表法・広告審査 | 要確認 |
| needs:cto-security | AI generation job、context snapshot、外部プレビューURL、権限境界 | 要確認 |

## 採番メモ

当初は `docs/79_AI_CAMPAIGN_STUDIO_RETENTION_LOOP_SPEC.md` として作成したが、既存または並行PRのdoc番号と衝突する可能性があるため、本仕様では `90` を仮採番として使う。

正式な採番台帳は別Issueで一元化する。

## 基本方針

### Misell Studioの勝ち方

NoviSign同等以上を目指すが、汎用CMSとして機能数で勝つのではない。

Misellは、3連サイネージの販促制作・配信・改善において、NoviSignより速く、迷わず、継続運用できることを勝ち筋にする。

やるべきこと:

- 3連プレビューを中心に置く
- 完全自由配置より、3連テンプレートとScene編集を優先する
- AI提案をStudioの入口にする
- AI生成結果を完成動画ではなく編集可能なCampaignProjectとして保持する
- 公開後のplaylog/QR/reportを翌月提案に反映する
- 既存のmanifest、render、credit、reporting仕様を拡張し、並行システムを作らない

やらないこと:

- 最初から汎用サイネージCMSを丸ごと再現する
- 大量ウィジェットを優先する
- 高度な動画編集タイムラインを先に作る
- AIが勝手に公開する
- ログや根拠なしにAIが成果を盛る
- AI専用manifest、AI専用credit台帳、AI専用publish経路を別に作る

## 正準語彙

この仕様では、既存のMisell正準ドメイン語彙に揃える。

| 用語 | 意味 | 備考 |
| --- | --- | --- |
| Tenant | 顧客企業/契約単位 | 既存ID体系に従う |
| Store | 店舗/施設 | Siteと呼ばない。既存の `store_id` を使う |
| ScreenGroup | 3連画面グループ | DisplayWallとは呼ばない |
| Device | 端末 | 端末監視/heartbeat/playlogと接続 |
| Asset | 画像/動画/HTML等の素材 | 既存Asset管理を拡張 |
| ContentManifest | 端末に配信される公開単位 | rollback/atomic applyの正本 |
| PlaylistItem | 再生単位 | 通常/広告/QR付きコンテンツを含む |
| Schedule | 配信条件 | 曜日/時間帯/期間/優先度 |
| Playlog | 再生実績 | event_idで冪等に扱う |
| QrLog | QR反応 | campaign/content/offerと接続 |
| CampaignProposal | AIが毎月出す提案 | 制作前の案 |
| CampaignBrief | 生成エンジンへ渡す正規化入力 | proposal/custom/collaborationを統合 |
| CampaignProject | 制作・編集の作業単位 | content_manifestとは別 |
| Media Campaign | 広告主・掲載期間・広告主レポート単位 | docs/69のCampaign概念 |
| Scene | CampaignProject内の編集可能なカット | 完成動画ではなく構造データ |
| RenderedAsset | Sceneから生成されたHTML/MP4等 | 配信対象Assetへ変換される |

### CampaignProject と Media Campaign の関係

`CampaignProject` は制作・編集の作業単位である。

`Media Campaign` は広告主、掲載期間、広告主レポート、Proof of Playのための掲載単位である。

通常販促では、`CampaignProject` から `ContentManifest` を生成し、Media Campaignへの紐づけは任意とする。

広告主、コラボ先、スポンサー、施設外企業が関わる場合は、`CampaignProject` を `Media Campaign` または partner/collaboration scopeへ明示的に紐づける。

推奨ID:

```text
campaign_proposal_id
campaign_brief_id
campaign_project_id
media_campaign_id
content_id
asset_id
qr_link_id
```

### Measurement Readiness 補正

2026-06の広告/ROI設計更新により、Misell Studioは「制作する場所」だけでなく「測定可能な制作物を作る場所」として扱う。

Studio本実装では、CampaignProject/Sceneを以下に接続できる構造へ寄せる。

| 概念 | 目的 |
| --- | --- |
| content_layer | 常時表示、定期差し替え、文脈連動を分ける |
| item_type | 通常コンテンツ、広告、スポンサーを分ける |
| measurement_goal | 何を検証するScene/Projectかを保存する |
| expected_action | QR scan、coupon issue、order、inquiryなど期待行動を保存する |
| qr_link_id | QR反応とScene/Projectを接続する |
| campaign_id | report/read modelと接続する |
| media_campaign_id | 広告主/代理店レポート単位と接続する |
| creative_id | 素材/creative別の効果測定に使う |
| ad_slot_id | 施設/画面/枠/時間帯の広告在庫と接続する |
| duration_class | 3秒理解、視覚中心、文字中心、詳細確認などの秒数設計に使う |
| next_review_at | 鮮度維持とstale warningに使う |
| variation_group | A/Bや改善履歴を束ねる |
| improvement_reason | なぜSceneを差し替えたかを残す |

この補正は、既存のCampaign Generator foundationを壊すものではない。後続セルで列やcontractを足す場合も additive に行い、既存Project/Sceneは未指定値を許容する。

#### Studio validation 追加方針

Scene validationは、デザインの完成度だけでなく測定可能性も見る。

後続で追加するvalidation:

- CTAがあること
- item_typeが `ad` / `sponsor` の場合、campaign/creative/ad slot/QRの接続状態を確認すること
- duration_secondsが用途に対して極端でないこと
- guaranteed outcome、ROAS保証、増分断定、直接PIIを拒否すること
- QRやofferがある場合、scopeがtenant/store/screen_groupと一致すること
- published content_manifestを直接変えないこと

MVPでは、AIやLLMが効果判断を行わない。validationは決定済みのschema、allowlist、regex、scope checkで行う。

#### Freshness / 運用データへの接続

Studioは、作成時だけでなく運用中の更新理由も持つ。

後続で扱う状態:

- last_content_update_at
- next_review_at
- stale_reason
- freshness_status
- active_days
- unchanged_days
- previous_scene_id
- variation_group

これにより、「設置して放置」ではなく、月次で改善されるサイネージ運用OSとして扱える。

## 並行システム禁止

AI Campaignは既存仕様を置き換えない。以下の正本を拡張する。

| 領域 | 正本 | 禁止 |
| --- | --- | --- |
| 配信 | ContentManifest / PlaylistItem / Schedule | AI専用manifestを作らない |
| レンダリング | 既存または予定のcut_plan/render pipeline | AI専用render経路を孤立させない |
| 課金/生成枠 | 既存billing/credit ledgerを拡張 | AI専用credit台帳を別管理しない |
| 広告 | docs/69のCampaign/Creative/Placement/Proof of Play | 広告だけ別配信APIにしない |
| レポート | docs/71のplaylog/QR/reporting | AIレポート専用の別集計を作らない |
| 権限 | docs/76のRBAC/publish_mode | AI公開だけ別権限にしない |

公開時は必ず `content_manifest` へ変換し、端末側は通常のcontent sync/atomic apply/rollbackの経路で扱う。

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
- CEO/法務/CTO security review gates

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
Misell AI AgentがStore/ScreenGroupごとの文脈を取得
  ↓
今月の販促案を5〜10件生成
  ↓
顧客管理画面に「今月のおすすめ」として表示
  ↓
顧客が案を採用/保留/却下
  ↓
採用案からCampaignBriefを作成
  ↓
生成ボタンを押す
  ↓
CampaignProject draftが作成される
  ↓
StudioでScene編集・3連プレビュー
  ↓
publish_modeに従って公開または承認申請
```

### 自由入力フロー

```text
顧客が「自分で企画を入力」
  ↓
custom_briefを作成
  ↓
顧客コンテキストを補完
  ↓
CampaignBriefへ正規化
  ↓
以降は月次提案と同じ
```

### コラボ企画フロー

```text
顧客がコラボ/広告主企画を入力
  ↓
collaboration_briefを作成
  ↓
partner_profile / brand_usage_notes / external_reviewerを追加
  ↓
CampaignBriefへ正規化
  ↓
Campaign Generatorへ渡す
  ↓
Studioで編集
  ↓
外部確認用プレビューURL
  ↓
Ad Approval Publishへ送る
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
- 検証したい仮説
- 見るべき指標
- 必要素材
- 採用/保留/却下の記録

禁止表現:

- 売上が上がると断定しない
- QR読み取り数を保証しない
- 広告収益を保証しない
- AIが根拠なく成果数値を作らない

例:

```text
NG: QR読み取り数を増やせます。
OK: QR導線の反応を検証する案です。見るべき指標はQR読み取り数と時間帯別反応です。
```

## クレジットまたは生成枠の対象

生成処理はコストが発生するため、月間生成枠またはクレジット制にする。

ただし、plan / pricing / quota / credit cost はCEO承認まで未承認ドラフトである。

顧客表示案:

```text
今月の生成枠: 3本
使用済み: 1本
残り: 2本
追加生成: 有料
```

正式価格は `docs/61_CUSTOMER_PRICING_TABLE.md` またはCEO承認済み価格表を正本とする。

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

プラン案は検討用であり、決定ではない。

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
既存cut_plan/render pipeline向けの構造に変換
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
| products_services | 売りたい商品、価格、説明、季節商品 |
| campaign_history | 実施内容、配信期間、素材、結果 |
| performance_logs | 放映回数、QRクリック、時間帯別反応 |
| selected_preferences | 選ばれやすい案、採用された文言、好まれる構成 |
| rejected_patterns | 却下された案、NG表現、避けたい方向性 |
| asset_library | 過去画像、動画、ロゴ、写真、使用中素材 |
| operation_rules | 表示できない内容、広告審査、法務NG、営業時間 |
| seasonal_calendar | 年間販促カレンダー、施設イベント、地域イベント |
| language_rules | 多言語表記、翻訳確認ルール |

### 監査項目

Customer Contextの各項目には、可能な限り以下を保持する。

```text
source_type
source_id
updated_by
updated_at
confidence
expires_at
consent_basis
retention_policy
deletion_policy
```

例:

```json
{
  "key": "breakfast_time",
  "value": "6:30-10:00",
  "source_type": "operator_input",
  "source_id": "ctx_001",
  "updated_by": "customer_admin",
  "updated_at": "2026-06-20T09:00:00+09:00",
  "confidence": "confirmed",
  "expires_at": null,
  "consent_basis": "contract_operation",
  "retention_policy": "active_contract_plus_12_months",
  "deletion_policy": "tenant_delete_request_or_contract_end_policy"
}
```

### Privacy / APPI注意

- 顧客データをAI学習に勝手に使わない
- 外部AI APIへ渡す項目は最小化する
- 個人名、担当者連絡先、広告主担当者などは必要時のみ渡す
- 保持期間、削除要求、契約終了後の扱いを法務確認する
- partner/collaboration dataは外部共有範囲を明示する

### Context Builder

生成時に全データをAIへ渡さない。Context Builderが必要な情報だけ抽出する。

```text
生成リクエスト
  ↓
対象tenant/store/screen_group/季節/目的を判定
  ↓
関連する過去CampaignProjectを取得
  ↓
反応の良かった素材を取得
  ↓
NG表現を取得
  ↓
ブランドトーンを取得
  ↓
商品/サービス情報を取得
  ↓
最小化したcontext_snapshotを作る
  ↓
AI生成プロンプトに渡す
```

## AI生成監査ログ

`AiGenerationJob` には最低限以下を持たせる。

```text
ai_generation_job_id
tenant_id
store_id
screen_group_id
requested_by
input_brief_snapshot
context_snapshot_id
prompt_template_version
model_provider
model_name
output_schema_version
generated_output
validation_result
credit_cost
status
created_at
```

重要:

- 同じ生成結果を完全再現できなくても、どの入力・どのcontext・どのprompt templateで生成されたか追えるようにする
- AI出力はschema validationを通す
- validationに失敗した出力は公開候補にしない
- AIが数値を作らず、レポートはログに基づく文章化に限定する

## データモデル案

最低限、以下を分ける。

```text
Tenant
Store
ScreenGroup
Device
Asset
BrandProfile
FacilityProfile
CampaignProposal
CampaignBrief
CampaignProject
Scene
SceneSlot
RenderedAsset
ContentManifest
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
| ContentManifest | 端末配信・rollbackの正本 |
| PlaylistItem | 再生リスト内の表示単位 |
| Schedule | いつ流すか |
| MonthlyReport | 結果と次回提案 |

## CampaignProject / Scene の考え方

AIが完成MP4だけを返すと、修正が難しい。

生成結果は、必ず編集可能な構造データとして保存する。

```json
{
  "campaign_project_id": "CPJ-2026-07-001",
  "title": "夏のサウナ回遊キャンペーン",
  "objective": "館内回遊とQR案内を検証する",
  "hypothesis": "夕方以降にサウナ導線を出すと館内マップQRの反応が増えるかを確認する",
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
  "schedule_draft": {
    "start_date": "2026-07-01",
    "end_date": "2026-07-31",
    "time_slots": ["17:00-24:00"]
  }
}
```

この構造を正本にして、HTMLプレビュー、MP4レンダリング、ContentManifest生成、playlist登録、schedule登録、再編集、部分再生成を行う。

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
- 測定目的
- 期待行動
- content layer
- item type
- campaign / creative / ad slot / QR link
- 次回見直し日
- 改善理由

### 部分再生成

全体再生成だけにしない。

必要な操作:

- Sceneだけ再生成
- コピーだけ再生成
- QR周りだけ再生成
- 右画面だけ再生成
- 別写真を使って再生成
- 3案だけ追加生成

## Publish flow

AI Campaignの公開は、既存の `publish_mode` に従う。

| publish_mode | AI Campaignでの扱い |
| --- | --- |
| self_publish | customer_admin / customer_editor がプレビュー後に公開可能 |
| operator_approval | 顧客は公開申請まで。Misell operator承認後に公開 |
| ad_approval_only | 通常販促は自己公開可能。広告/コラボ/施設外企業素材はAd Approval Publishへ送る |

AIは勝手に公開しない。必ず人間確認と3連プレビューを挟む。

### Active content immutability

公開前のCampaignProject/Sceneは編集可能。

公開後にScene、素材、秒数、layout、schedule実体を変更する場合、既存のactive `content_manifest` を直接更新しない。

必ず以下の流れにする。

```text
CampaignProject revision or clone
  ↓
new content_id
  ↓
draft
  ↓
validate
  ↓
activate
```

このルールはplaylog、QR成果、広告成果、rollbackの整合性を守るために必須である。

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
公開/承認申請
```

## Render / Publish handoff

Phase 1ではHTMLプレビュー/HTML配信を優先する。
MP4書き出しは後続Phaseでもよい。

公開時には以下へ接続する。

- content_manifest
- playlist_item
- schedule
- qr_link
- playlog
- reporting
- campaign_id / media_campaign_id
- creative_id
- ad_slot_id
- measurement_goal

通常販促:

```text
CampaignProject
  ↓
RenderedAsset
  ↓
ContentManifest item type = content
  ↓
playlist/schedule
```

広告/コラボ:

```text
CampaignProject
  ↓
RenderedAsset
  ↓
Media Campaign / partner scope
  ↓
ContentManifest item type = ad or campaign-linked content
  ↓
playlist/schedule
```

## Reporting / Learning Loop

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

翌月提案に戻す最低指標:

```text
campaign_project_id
content_id
item_type
content_layer
measurement_goal
expected_action
media_campaign_id
creative_id
ad_slot_id
play_count
completed_play_count
qr_scan_count
qr_scan_rate_per_completed_play
top_time_slots
underperforming_time_slots
published_days
operator_notes
customer_selected_status
customer_rejection_reason
```

次回生成に反映する情報:

- 採用された案
- 却下された案
- 却下理由
- 編集された文言
- 差し替えられた素材
- 実際に公開されたCampaignProject
- QR反応
- 放映ログ
- 時間帯別反応
- Proof of Playの失敗/欠損
- creative/ad_slot別の反応
- freshness/stale状態
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

コラボ/広告主企画は `ad_approval_only` または `Ad Approval Publish` の対象にする。

Phase 1で多段承認を作らない場合でも、以下は必須とする。

- 承認前の公開禁止
- preview tokenの期限
- preview tokenのscope制限
- ロゴ/素材利用条件のCampaignProject保存
- external_reviewerへの表示範囲制御

## フェーズ分けと検証可能な受入基準

### Phase 1: AI Monthly Proposal / Customer Context

目的: 毎月ログインする理由を作る。

対応Issue: #145

実装範囲:

- 月次販促案5〜10件
- customer context
- Context Builder
- 採用/保留/却下
- 顧客管理画面への表示

受入基準:

- [ ] `tenant_id`, `store_id`, `screen_group_id` ごとにproposalを生成できる
- [ ] proposalには「狙い」「検証仮説」「見るべき指標」が含まれ、成果保証表現がない
- [ ] proposalの状態を `draft/proposed/selected/held/rejected/expired` で保存できる
- [ ] `selected` proposalからCampaignBriefを作れる
- [ ] rejected reasonを保存できる
- [ ] Context Builderが不要な個人情報を除外できる
- [ ] AI生成jobにinput/context/prompt/schemaのsnapshotが残る

### Phase 2: Campaign Generator

目的: 選んだ案を編集可能なキャンペーンへ変換する。

対応Issue: #146

実装範囲:

- CampaignBrief
- CampaignProject
- Scene model
- QR/CTA案
- schedule draft
- HTML preview draft

受入基準:

- [ ] Proposal、自由入力、collaboration briefを同じCampaignBrief schemaへ正規化できる
- [ ] CampaignProjectとMedia Campaignが別IDで管理される
- [ ] CampaignProject/Sceneに測定目的、期待行動、QR/広告枠接続を後続拡張できる
- [ ] AI出力がScene schema validationを通る
- [ ] validation失敗時は公開候補にならない
- [ ] 既存render/cut_planへ渡せる構造に変換できる
- [ ] AI専用manifestを作らない

### Phase 3: Scene Editor / Render / Publish

目的: 顧客が生成物を調整し、公開できる状態にする。

対応Issue: #147

実装範囲:

- Scene編集
- 3連プレビュー
- 部分再生成
- HTML配信
- playlist/schedule変換
- publish/rollback設計

受入基準:

- [ ] Scene単位で文言、素材、QR、秒数を変更できる
- [ ] 3連プレビューでleft/center/right/wideを確認できる
- [ ] 部分再生成がAiGenerationJobとして記録される
- [ ] publish_modeに従って公開/承認申請が分岐する
- [ ] 公開時にContentManifestへ変換される
- [ ] active contentを直接更新せず、clone/draft/validate/activateで変更できる
- [ ] playlog/qr/reportingへcontent_id/campaign_project_idを渡せる
- [ ] 広告/スポンサーSceneはcampaign_id、creative_id、ad_slot_id、qr_link_idをplaylist/playlog/reportingへ接続できる
- [ ] Sceneの表示秒数、CTA、成果保証表現、直接PII、測定導線をpublish前validationで確認できる
- [ ] stale contentや次回見直し日を管理画面で判断できる

### Phase 4: Quota / Credit / Collaboration

目的: 生成コスト管理とコラボ企画対応を行う。

対応Issue: #148, #149

実装範囲:

- 月間生成枠
- credit ledger
- 追加生成
- collaboration campaign
- 外部確認プレビュー

受入基準:

- [ ] plan/quota/credit_costはCEO承認済み設定だけが本番利用される
- [ ] 顧客には月間生成枠として表示される
- [ ] 内部ではcredit ledgerへ操作別に記録される
- [ ] 生成枠超過時は追加生成申請または見積導線へ進む
- [ ] 外部プレビューURLは期限とscopeを持つ
- [ ] コラボ/広告主企画は承認前に公開できない
- [ ] partner/advertiser scope外のユーザーが閲覧できない

## 既存仕様との接続

- `docs/42_AI_ADDON_SPEC.md`: AI Copy / AI Report / AI Schedulerを本仕様の体験へ統合する
- `docs/67_MISELL_STUDIO_NOVISIGN_BENCHMARK_SPEC.md`: NoviSign型CMSの中核機能を3連特化Studioへ落とす
- `docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md`: Campaign/Ad/QR/logの整合を保つ
- `docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md`: playlog/QR/monthly reportをLearning Loopへ戻す
- `docs/76_RBAC_AND_SELF_SERVICE_OPERATION_SPEC.md`: 顧客/partner/広告主のscopeとpublish_modeを接続する

## 実装時の注意

- AI提案は月額内の継続価値にする
- 実生成は生成枠/クレジットで管理するが、価格はCEO承認まで未確定
- AI生成結果は編集可能な構造データとして保持する
- AIが数値を作らない。レポートはログに基づく文章化に限定する
- 顧客データを勝手にAI学習へ使わない
- AIが勝手に公開しない。必ず人間確認とプレビューを挟む
- 汎用CMS化より3連販促の迷わなさを優先する
- 既存manifest/render/credit/reportingを拡張し、並行システムを作らない

## 結論

Misell Studioは「動画を置くCMS」ではなく、「毎月の販促キャンペーンをAIと一緒に回す3連サイネージ運用OS」にする。

導入理由はサイネージ設置ではなく、毎月の販促更新と改善が止まらないこと。
継続理由はAI提案、編集可能な生成物、公開ログ、月次レポート、次回改善のループで作る。
