# アーキテクチャ

保存データは `packages/project-schema` のZodスキーマに従うJSONです。Three.jsのScene/Object3DやRapierのHandleは保存しません。UIとAIはCommandBusへコマンドを渡し、適用後の全モデルを検証します。

EngineはReactを参照せず、`new Engine(canvas)`、`await engine.load(project)`、`await engine.play()`、`engine.stop()`、`engine.dispose()`で使います。Machine Compileは固定接続グループをまとめ、可動関節を残します。ThreeRendererとRapierPhysicsが実行オブジェクトの生成・解放を担当します。

依存方向はUI→Command／Engine、Command→schema／各編集ロジック、Engine→描画／物理、各編集ロジック→schemaです。serverだけがNodeのファイルシステム・外部HTTP・GLB変換を参照します。各workspaceのpackage.jsonに依存を宣言しています。`pnpm cycles`で循環を検査します。

外部素材取得はserverの許可ホスト・容量制限を通し、Asset Pipelineが原本・実行GLB・サムネイル・寸法を保存します。Plugin SDKもexecuteだけを渡す境界です。

## 環境描画パイプライン（正本）

プロシージャル環境は、開発時に素材を用意し、実行時は保存済み成果物だけを読む構成です。RuntimeはAsset Factory・外部生成・ネットワーク取得に依存しません。

```text
World Design + Seed
        ↓
プロシージャル生成規則
        ↓
樹木・住宅・材質の生成
        ↓
Asset Factory
        ↓
Asset Pipeline
        ↓
Asset Catalog
        ↓
保存済みGLB・距離別モデル
        ↓
World Runtime
        ↓
Chunk Streaming
        ↓
Three.js Renderer
        ↓
シェーダー・風・影
        ↓
ブラウザで探索できる3D世界
```

| 段階 | 役割 |
| ---- | ---- |
| World Design + Seed | 島・道路・Biome・配置規則と決定的Seed |
| プロシージャル生成規則 | 草・樹木・住宅・材質などの形状／配置規則 |
| 樹木・住宅・材質の生成 | 規則とSeedからモデル／テクスチャを作る |
| Asset Factory | 開発時のみ。不足素材の充足と登録 |
| Asset Pipeline | 原本保持、Runtime GLB、LOD、Collider |
| Asset Catalog | Slot解決・metadata・fingerprint（正本はProject.assets） |
| 保存済みGLB・距離別モデル | 実行時が読む成果物 |
| World Runtime | Chunk生成・配置・Origin Rebase |
| Chunk Streaming | 半径内の読込／破棄と予算付きCommit |
| Three.js Renderer | Instancing・LOD切替 |
| シェーダー・風・影 | 地表・草葉の揺れ・距離別影 |
| ブラウザの3D世界 | Studio／Playerでの探索 |

詳細は[World生成](world-generation.md)、[Asset Factory](asset-factory.md)、[Asset Pipeline](asset-pipeline.md)、[World System](world-system.md)、[プロシージャル環境描画](environment-quality/procedural-rendering.md)を参照してください。
