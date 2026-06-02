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
- prompts/codex_build_mvp.md

## 開発の最初のゴール

Ubuntu上で、3画面を横に連結した5760x1080のChromiumキオスクを起動し、左・中央・右の個別表示と、3面ぶち抜き表示を切り替えられるローカルWebプレイヤーを作る。

素材はLAN経由で入れ替え、playlist.jsonで表示順、秒数、時間帯を管理する。

## 開発チームへの最初の指示

1. docs/00_PROJECT_OVERVIEW.md を読む
2. docs/03_MVP_SPEC.md を読む
3. docs/04_TECH_ARCHITECTURE_LINUX.md を読む
4. prompts/codex_build_mvp.md をCodexに渡す
5. docs/16_ISSUE_BACKLOG.md をGitHub Issuesへ分解する
6. docs/17_BUYOUT_EXECUTION_SCORECARD.md を見て、期間別KPIを毎月更新する
7. docs/18_VIDEO_PRODUCTION_GUIDE.md と docs/19_SPLIT_SCREEN_PATTERN_LIBRARY.md を制作チームの標準仕様にする
8. docs/30_FIRST_30_DAYS_EXECUTION_PLAN.md をもとに初動30日を実行する
9. docs/35_OPERATIONS_SOP.md と docs/36_QA_TEST_CHECKLIST.md を導入前チェックに使う
10. docs/29_MA_DATA_ROOM_CHECKLIST.md を最初の1件目から更新する
