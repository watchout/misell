# Docs index / 採番台帳

## 目的

Misellの仕様ドキュメント番号がPR間で衝突しないよう、採番の正本をここに集約する。

README.mdのドキュメント一覧は読み手向けの目次、このファイルは採番・衝突防止用の台帳として扱う。

## 運用ルール

- 新規仕様docを追加する前に、この台帳へ番号を追加する。
- 同じ番号を再利用しない。
- 並行PRで番号衝突が起きた場合は、後発PR側が番号を変更する。
- ファイル名の番号と本文タイトルの番号を一致させる。
- 採番だけで仕様の優先度を表現しない。優先度はIssue/label/milestoneで管理する。

## 予約済み・既存番号

現時点ではREADME.mdの一覧を参照する。

## 直近追加

| 番号 | ファイル | 備考 |
| ---: | --- | --- |
| 90 | `docs/90_AI_CAMPAIGN_STUDIO_RETENTION_LOOP_SPEC.md` | doc 79衝突回避のため90へ移動 |
| 91 | `docs/91_CANONICAL_DOMAIN_VOCABULARY_ADR.md` | canonical domain vocabulary ADR |
| 92 | `docs/92_DETERMINISTIC_CONTROL_AND_DATA_POLICY_ADR.md` | deterministic control / soft delete / DRY / config policy ADR |

## TODO

- [ ] 既存docsを棚卸ししてこの台帳へ転記する
- [ ] 重複番号を検出するCIまたはlintを追加する
- [ ] README.mdの一覧とこの台帳の差分チェックを追加する
