# ADR-0005: 取得先の分離

日付: 2026-09-09。状態: 採用。

## 判断

Poly Haven・ambientCG・Local・Kenneyのinterfaceを共通化する。固有User-Agentとキャッシュ、リクエスト期限、エラー隔離を持ち、1つの障害をStudio全体へ伝播させない。

## 結果

初期実装とテストに反映した。詳細と制約は関連システム文書およびKNOWN_ISSUES.mdに記録する。
