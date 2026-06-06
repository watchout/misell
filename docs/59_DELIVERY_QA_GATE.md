# Delivery QA Gate

Misellの納品判定は、AIの自己評価ではなく、再実行できる検証と証跡で決める。

## 原則

- MCPは探索、実ブラウザ操作、DevTools確認、CI/Issue確認のインターフェースとして使う。
- 最終判定は通常のPlaywright TestとGitHub Actionsで再実行できる形に固定する。
- 画面を見ずにUI確認済みと言わない。
- Console error、page error、想定外のNetwork 4xx/5xxを無視しない。
- 期待された401/400はallowlistし、理由をログに残す。
- 物理3画面検証は別ゲートとし、モニター未接続時に代替PASS扱いしない。

## 必須ツール

- Playwright MCP: UI探索、フォーム操作、導線確認
- Chrome DevTools MCP: Console、Network、Performance、スクリーンショット確認
- GitHub pluginまたはGitHub MCP: Issue、PR、Actions失敗確認
- Context7 MCP: 最新ライブラリ仕様確認
- MCP Inspector: 自作MCPや検証MCPのschema/error/concurrency確認

Codexローカル設定例:

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest
codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest
codex mcp add context7 -- npx -y @upstash/context7-mcp@latest
```

MCP Inspectorは必要時に起動する。

```bash
npx @modelcontextprotocol/inspector
npx @modelcontextprotocol/inspector node build/index.js
```

## 納品前フロー

1. 仕様監査
   - README、docs、API、UI要件、運用要件を読み、不整合を列挙する。
   - 権限、状態遷移、例外処理、未定義仕様を確認する。
2. 静的検証
   - `npm --prefix apps/player run check`
   - `npm --prefix apps/player run validate:playlist`
   - `npm --prefix apps/cloud run check`
   - `bash -n apps/player/scripts/*.sh apps/cloud/scripts/*.sh`
3. 実ブラウザ検証
   - Playwright MCPまたはPlaywright Testで主要導線を操作する。
   - Chrome DevTools MCPまたはPlaywrightのconsole/network hookでエラーを確認する。
4. E2E固定化
   - 探索で確認した操作を `tests/e2e` のPlaywright Testへ落とす。
   - screenshot、trace、HTML report、actions/network/console/API状態を保存する。
5. CI検証
   - GitHub Actionsで静的検証とE2Eを実行する。
   - Actions失敗時はログとartifactから原因を特定して修正する。
6. 納品判定
   - 実ブラウザで動いた。
   - CIで再実行できた。
   - 証跡が残った。
   - 仕様との不整合が潰れている。

## 現在のE2E

`npm run test:e2e` は、以下を一時データで検証する。

- `apps/player` `/player?preview=1` three-zone/wide切替
- `apps/player` `/admin` 認証、素材アップロード、不正/サイズ超過アップロード拒否、playlist利用中素材の削除警告、playlist編集、保存、プレビュー
- `apps/cloud` `/admin` 認証、dashboard、device status/notes、update予約/解除、不正update ref拒否、token rotate/revoke、release/content manifest作成、manifest status更新、content manifest不正payload拒否、device detail
- mobile viewportでのplayer/admin/cloud主要画面表示

出力先:

- `test-results/e2e/misell-ui/`
- `test-results/playwright/`
- `playwright-report/`

これらはCI artifactとして保存する。

## 未完了の深掘り

- GitHub Actions上でこのE2E jobがPASSすること
- Chrome DevTools MCPでの明示的なConsole/Network/Performance確認
- 長時間再生
- 実機kiosk
- 物理3画面表示
