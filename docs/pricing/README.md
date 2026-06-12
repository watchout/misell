# Misell Pricing Data

## Canonical Source

Misellの顧客提示用価格データは `docs/data/pricing/misell_pricing.public.yaml` を正本とする。

このディレクトリの文書や提案資料は、価格表を手で複製せず、正本データを参照する。見積、LP、提案書、申込書へ転記する前に `source_status: needs_human_approval` を確認し、人間承認がない価格は正式価格として扱わない。

## Public Data

public dataset に置ける情報は、顧客へ提示できる以下の範囲に限る。

- プランID、プラン名、顧客向けの位置づけ
- 顧客提示用の初期費用、月額費用、契約期間
- 含まれる範囲、含まれない範囲
- AI機能の位置づけ
- 計測で保証しない範囲
- source status

## Internal Data Boundary

実採算、仕入れ、施工、パートナー条件、チャネル別条件などの内部データは、このpublic repositoryに置かない。必要な場合はprivate repository、local database、または承認済みのignored local storeに分離する。

Rasenへ渡せるのはschema、template、adapterなどの抽象だけであり、Misellの商品固有価格や内部条件は渡さない。

## Required Audit

pricing実装PRでは、少なくとも以下を通す。

```bash
npm run pricing:audit
```

`npm run test:ci` にも同じauditを含めている。auditはpublic YAMLのschema validation、内部データファイル混入チェック、主要な営業資料の古い手書き価格チェック、sales claimチェックを行う。
