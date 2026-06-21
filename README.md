# 連結サイネージ「ミセル -misell-」

**つないで魅せる。売場をメディアに。**

ミセルは、複数画面を連結したサイネージを起点に、店舗・施設の空きスペースを販促・案内・広告収益・AI分析のメディアへ変える事業です。

このリポジトリは、MVP開発チーム、営業チーム、マーケティングチームへの引き継ぎ用ドキュメントです。

## 現在の前提

- MVP用端末：NiPoGi Ryzen 4300U / 16GB / 256GB を購入済み
- OS方針：Ubuntu / Linux ベース
- 初期MVP：3連サイネージ表示、LAN素材更新、タイマー配信、ローカル継続再生
- テスト導入候補：安心お宿、バリアン、パセラ、ビジョンセンター
- 事業目標：2027年6月までに10億円バイアウトを狙える事業体を作る

## 実装済みMVP

### Local Player

- 実装ディレクトリ: `apps/player`
- Ubuntu kiosk端末向け
- Chromium kioskで 5760 x 1080 の3画面横連結表示
- `three-zone`: 左・中央・右の3ゾーン表示
- `wide`: 3面ぶち抜き表示
- LAN管理画面 `/admin`
- playlist schema validation
- device identity
- playlog/admin/error log
- Ubuntu setup / kiosk / systemd / security / burn-in scripts

```bash
cd apps/player
npm install
npm start
```

起動後:

- Player: http://localhost:3000/player
- Preview: http://localhost:3000/player?preview=1
- Admin: http://localhost:3000/admin

既定のBasic認証:

- User: `admin`
- Password: `change-me`

店舗LANへ接続する前に、必ず `ADMIN_PASSWORD` または `MISELL_ADMIN_PASSWORD` を変更する。

### Cloud Monitoring MVP

- 実装ディレクトリ: `apps/cloud`
- 端末登録
- device token認証
- heartbeat/playlog/error ingest
- 死活・劣化・重大状態の集計
- アラート管理
- 日本語管理UI
- macOS LaunchAgentセットアップスクリプト

```bash
cd apps/cloud
npm install
npm start
```

起動後:

- Admin: http://localhost:3200/admin
- Health: http://localhost:3200/api/health

共有環境や公開環境では、必ず `ADMIN_PASSWORD` と `DEVICE_TOKEN_PEPPER` を変更する。

検証:

```bash
cd apps/player
npm run check
npm run validate:playlist
npm audit --audit-level=moderate

cd ../cloud
npm run check
npm audit --audit-level=moderate
```

## ドキュメント

- docs/00_PROJECT_OVERVIEW.md
- docs/01_STRATEGY_BUYOUT_2027.md
- docs/02_PRODUCT_BRAND.md
- docs/03_MVP_SPEC.md
- docs/04_TECH_ARCHITECTURE_LINUX.md
- docs/05_HARDWARE_PLAN.md
- docs/06_BUSINESS_MODEL_PRICING.md
- docs/07_MARKETING_SALES_PLAYBOOK.md
- docs/08_CREATIVE_PROMOTION_GUIDE.md
- docs/09_TEST_INTRODUCTION_PLAN.md
- docs/10_ROADMAP_BACKLOG.md
- docs/11_RISK_LEGAL_PRIVACY.md
- docs/12_POP_TAG_ESL_STRATEGY.md
- docs/13_DATA_KPI_REPORTING.md
- docs/14_AI_EXTENSION_PLAN.md
- docs/15_MARKET_COMPETITOR_REFERENCES.md
- docs/16_ISSUE_BACKLOG.md
- docs/17_BUYOUT_EXECUTION_SCORECARD.md
- docs/18_VIDEO_PRODUCTION_GUIDE.md
- docs/19_SPLIT_SCREEN_PATTERN_LIBRARY.md
- docs/20_DEEP_RESEARCH_TOPICS.md
- docs/21_INDUSTRY_DEMO_SCENARIOS.md
- docs/22_ONE_PAGE_SALES_SHEET.md
- docs/23_MEDIA_KIT_TEMPLATE.md
- docs/24_AI_PROMPT_LIBRARY.md
- docs/25_TEST_SITE_PLAYBOOKS.md
- docs/26_BUYER_PITCH_PLAYBOOK.md
- docs/27_CONTRACT_AND_ONBOARDING_CHECKLIST.md
- docs/28_LP_STRUCTURE_AND_COPY.md
- docs/29_MA_DATA_ROOM_CHECKLIST.md
- docs/30_FIRST_30_DAYS_EXECUTION_PLAN.md
- docs/31_UNIT_ECONOMICS_MODEL.md
- docs/32_PARTNER_AGENCY_STRATEGY.md
- docs/33_PROPOSAL_DECK_OUTLINE.md
- docs/34_CUSTOMER_DISCOVERY_QUESTIONS.md
- docs/35_OPERATIONS_SOP.md
- docs/36_QA_TEST_CHECKLIST.md
- docs/37_MOAT_AND_DEFENSIBILITY.md
- docs/38_WEEKLY_EXECUTIVE_REVIEW.md
- docs/39_CASE_STUDY_TEMPLATE.md
- docs/40_FINANCING_AND_SUBSIDY_PLAN.md
- docs/41_REMOTE_CMS_SPEC.md
- docs/42_AI_ADDON_SPEC.md
- docs/43_DEVICE_FLEET_MANAGEMENT_SPEC.md
- docs/44_NETWORK_SECURITY_SPEC.md
- docs/45_BUYER_TARGET_RESEARCH_AND_PRODUCT_FIT.md
- docs/46_SECURITY_IMPLEMENTATION_BACKLOG.md
- docs/47_ARCHITECTURE_BOUNDARIES_AND_MVP_GATES.md
- docs/48_ISSUE_LABELING_AND_PROGRESS_RULES.md
- docs/49_EXTERNAL_REVIEW_RECONCILIATION.md
- docs/50_IMPLEMENTATION_READY_MVP_SPEC.md
- docs/51_PR_IMPLEMENTATION_PLAN.md
- docs/52_MVP_GATE_EVIDENCE_TEMPLATE.md
- docs/53_DEVICE_ROLLOUT_SETUP_AND_OPERATIONS.md
- docs/54_PRODUCTIZATION_SALES_READINESS_CHECKLIST.md
- docs/55_ORDER_TO_INSTALL_RUNBOOK.md
- docs/56_SELF_SERVE_LP_AND_ONBOARDING_PORTAL_SPEC.md
- docs/57_FLEET_MONITORING_RELEASE_OPERATIONS.md
- docs/58_CLOUD_MONITORING_MVP_SPEC.md
- docs/59_DELIVERY_QA_GATE.md
- docs/60_TEST_INTRO_PROPOSAL_DECK.md
- docs/61_CUSTOMER_PRICING_TABLE.md
- docs/62_MISELL_MEDIA_KIT.md
- docs/63_TEST_INTRO_AGREEMENT_TEMPLATE.md
- docs/64_INDUSTRY_DEMO_ASSET_PACK.md
- docs/65_QR_GENERATION_GUIDE.md
- docs/66_EQUIPMENT_AND_PRICE_REFERENCE.md
- docs/67_MASTER_CONTROL_AND_CONTENT_DELIVERY_DESIGN.md
- docs/67_MISELL_STUDIO_NOVISIGN_BENCHMARK_SPEC.md
- docs/68_MARKET_PRICING_RESEARCH_AND_PLAN_CONCEPT.md
- docs/69_MEDIA_AD_DELIVERY_IMPLEMENTATION_SPEC.md
- docs/70_MULTI_SCREEN_ORIENTATION_CONTENT_MODEL.md
- docs/71_REPORTING_DASHBOARD_IMPLEMENTATION_SPEC.md
- docs/72_CONTRACT_BILLING_AND_RENTAL_ASSET_SPEC.md
- docs/73_ORDER_TO_INSTALL_WORKFLOW_SPEC.md
- docs/74_BILLING_PAYMENT_PORTAL_SPEC.md
- docs/75_PARTNER_RESELLER_CHANNEL_STRATEGY_SPEC.md
- docs/76_RBAC_AND_SELF_SERVICE_OPERATION_SPEC.md
- docs/77_POC_PARTNER_PRICING_AND_BUYOUT_STRATEGY.md
- docs/78_FINAL_30DAY_IMPACT_OFFER_AND_PROPOSAL_STRATEGY.md
- docs/80_MISELL_STUDIO_PHASE1_SPEC_REVIEW_REQUEST.md
- docs/81_MISELL_STUDIO_PHASE1_ARC_REVIEW_REQUEST.md
- docs/82_MISELL_STUDIO_PHASE1_PR1_IMPLEMENTATION_HANDOFF.md
- docs/83_CLOUD_LOCAL_BACKUP_AND_ROLLBACK_SPEC.md
- docs/84_DEVICE_REMOTE_OPERATIONS_AND_RECOVERY_SPEC.md
- prompts/codex_build_mvp.md
- prompts/codex_implement_local_player_v1.md

## 開発の最初のゴール

Ubuntu上で、3画面を横に連結した5760x1080のChromiumキオスクを起動し、左・中央・右の個別表示と、3面ぶち抜き表示を切り替えられるローカルWebプレイヤーを作る。

素材はLAN経由で入れ替え、playlist.jsonで表示順、秒数、時間帯を管理する。

## 事業化時のゴール

MVPはLAN内管理から開始するが、事業化時にはクラウド管理画面から広告素材、動画、配信スケジュール、端末状態、放映ログ、QRログ、月次レポートを遠隔管理できる状態にする。
