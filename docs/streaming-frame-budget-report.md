# Streaming Frame Budget 改修報告

ブランチ: `fix/streaming-frame-budget`  
ベース: `fix/runtime-stability-rebase-shadow-colliders`

## 1. 原因

動画証拠（Rebase=0・Hinge≈0 でもカクつき、境界で SyncGen +13）とコードが一致した。

主因は Origin Rebase / Hinge ではなく、Chunk 境界通過時に **13 Chunk を同一 Frame で同期生成・描画・Collider 化する処理**である。

二重構造:

1. `WorldRuntime.acquire` が新規キーすべてに対し即 `getChunk()`（地形データ同期生成）
2. `ChunkStreamer.update` が不足キーすべてに対し即 `create()`（BufferGeometry / normals / InstancedMesh / Rapier Collider）

`generationLatencyMs` は **1 Chunk の `buildChunk` だけ**を測っており、13 個の総時間や Three.js / Rapier の commit を含まない。報告書の「最大約 2.6ms なので Worker 不要」判断は撤回する。

## 2. 変更

| 項目          | 内容                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| 計測          | `frameTimeMs` / `physicsStepMs` / `renderMs` / commit ms / Queue / Spike20・33、`Engine.recentSpikes` |
| ChunkStreamer | pending 待ち行列 + `maxCreatesPerUpdate=2` + `budgetMs=3` + `urgentRadius`                            |
| WorldRuntime  | `acquire` は refcount のみ。`enqueuePrefetch` / `pumpGeneration` / `ensureChunks`                     |
| Prefetch      | 進行線コリドー + 方向ヒステリシス。`Math.round(nx*ahead)` の 3×3 ジャンプを廃止                       |
| Physics       | 緊急半径1は同期保証。Streamer 更新は Frame あたり1回（`flushStreaming`）                              |
| Renderer      | tree/rock/building Template を load 寿命で共有                                                        |

Worker スレッド本実装は次PR。`pumpGeneration` がその入口になる。

## 3. 検証

自動テスト（`tests/unit/streaming-frame-budget.test.ts`）:

- 境界移動で 1 update の create ≤ 2
- Z=50→80 / Z=305→335 で 13 create/frame が起きない
- ヒステリシスで微小ノイズが prefetch 集合を揺らさない
- Physics urgent 3×3 は必ず loaded
- acquire は同期一括生成せず queue に積む

## 4. 残課題

- Web Worker への地形データ生成オフロード
- 実ブラウザ長距離飛行での Spike リング証拠（HUD の Spike20/33 と `engine.recentSpikes`）
- Spike が残る場合の空力・角速度・Joint 振動調査
