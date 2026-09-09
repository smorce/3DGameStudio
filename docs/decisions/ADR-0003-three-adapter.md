# ADR-0003: Three.js描画アダプター

日付: 2026-09-09。状態: 採用。

## 判断

Reactの外でThreeRendererを所有する。WebGL2を初期バックエンドとし、RendererAdapter境界を用意する。チャンク破棄時にGeometry・Material・Textureを解放する。

## 結果

初期実装とテストに反映した。詳細と制約は関連システム文書およびKNOWN_ISSUES.mdに記録する。
