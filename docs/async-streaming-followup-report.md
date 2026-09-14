# Async Streaming 追従修正報告

ブランチ: `perf/async-world-streaming-frame-budget`  
ベース実装: [async-streaming-report.md](async-streaming-report.md)（`e5946f4` 以降）  
作業日: 2026-09-14

## 1. 目的

非同期 Streaming 導入後に残っていた、Physics Terrain 生成経路・Render Prefetch・Frame Budget 消費・Origin Rebase 時の LOD・編集ワークスペース表示の不整合を直す。

## 2. 変更要約

| 領域 | 変更 |
|---|---|
| Physics Terrain | `meshFor()` の `number[]` 経由をやめ、`PreparedChunk` の local 頂点を Simulation 座標へ TypedArray 直焼きして Standalone Trimesh を生成 |
| Physics 方針 | `ColliderDesc.setTranslation` / Fixed Body 親付けは、Rapier `DynamicRayCastVehicleController` と組み合わせると接地が壊れるため採用しない |
| ChunkStreamer | `create` が `undefined`（未準備）のとき予算を消費せず `pending` を残し、Ready 済みを優先 |
| Render Prefetch | Play 中は `visibleChunksWithPrefetch` を使い、可視外は `P3_RENDER_PREFETCH` で要求 |
| LOD / Rebase | `WorldAssetBatch.shiftOrigin` を追加し、Renderer の Origin Rebase で LOD 中心も同じ delta でずらす |
| Edit Workspace | 新規 Chunk は最初から非表示。`editWorkspace` 切替時だけ `applyEditWorkspaceVisuals` を呼ぶ |

## 3. Physics Terrain 焼き込み

```
peekPreparedChunk(key)
  → preparedChunkLocalOrigin(prepared, worldOrigin)
  → Float32Array に XZ を origin 加算（Y はそのまま）
  → ColliderDesc.trimesh(vertices, indices)
```

- Hot Path 外では `getChunk` で準備を促す
- Rebase 後も Raycast 高さが `sampleHeight` と一致することを統合テストで確認

Chunk-local geometry + Collider translation 化自体は未着手のまま（車両コントローラ互換のため Simulation 座標 trimesh を維持）。

## 4. Streaming 予算の正しさ

`tryCreate` の戻りを `"created" | "skip" | "budget"` に分けた。

- `skip`: 既ロード、または create 未準備 → 予算カウンタを増やさない
- `budget`: maxCreates / budgetMs 超過 → 以降の非 urgent を打ち切り
- urgent / `commitUrgent` も未準備なら `pending` を残して次 Frame へ

## 5. Renderer

- Play: 可視半径は `P2_VISIBLE_RENDER`、Prefetch 先は `P3_RENDER_PREFETCH`
- Edit: `group.visible = !editWorkspace` でストリーミング後も地面を出さない
- Rebase: Chunk Group に加え `lodBatches` も `shiftOrigin(delta)`

## 6. テスト

| ファイル | 内容 |
|---|---|
| `tests/integration/procedural-world.test.ts` | Prepared 直焼き・Rebase 後の地面 Raycast |
| `tests/unit/streaming-frame-budget.test.ts` | 未準備 create が予算を食わない |
| `tests/unit/world-asset-batch-lod.test.ts` | Rebase 前後で LOD 距離が不変 / 未 shift だと距離が膨らむ |

検証: `pnpm test` → **217 PASS**

## 7. 変更ファイル

- `packages/physics-rapier/src/index.ts`
- `packages/renderer-three/src/index.ts`
- `packages/renderer-three/src/instances.ts`
- `packages/world-system/src/streaming.ts`
- `tests/integration/procedural-world.test.ts`
- `tests/unit/streaming-frame-budget.test.ts`
- `tests/unit/world-asset-batch-lod.test.ts`（新規）

## 8. 残課題

- Terrain Collider の真の chunk-local + translation（車両接地と両立できる設計が必要）
- Browser 実 Worker での Render Prefetch 効果の p95/p99 計測
- headless probe は WebGL を含まない点は従来どおり
