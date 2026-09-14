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
| Physics 方針 | chunk-local Trimesh + translation / Fixed Body / HeightField は試行済みだが、`DynamicRayCastVehicleController` を含む現行車両 Physics で接地回帰が観測されたため撤回。根本原因は未特定。Simulation 座標 bake の Standalone Trimesh を当面の正式方式とする |
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
- Vehicle Controller + Origin Rebase の接地回帰は `tests/integration/terrain-vehicle-rebase.test.ts` で監視

chunk-local Trimesh + translation は一度実装・検証したが、`DynamicRayCastVehicleController` を含む現在の車両 Physics で接地回帰が発生したため採用を撤回した。Fixed Body 方式および HeightField も検討・試行したが正式採用には至らなかった。現在は PreparedChunk を Simulation 座標へ直接 bake した Standalone Trimesh を採用している。local + translation 方式で発生した接地不整合の根本原因は未特定である（Broadphase / Query Pipeline / Vehicle Controller キャッシュ / Rebase 順序 / 親子関係などの仮説は未検証）。

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
| `tests/integration/terrain-vehicle-rebase.test.ts` | Raycast Vehicle + `commitWorldOriginShift` の接地・加速回帰 |
| `tests/integration/terrain-collider-modes.experimental.test.ts` | A/B/C 最小比較（本番回帰の最小再現は未達） |
| `tests/unit/streaming-frame-budget.test.ts` | 未準備 create が予算を食わない |
| `tests/unit/world-asset-batch-lod.test.ts` | Rebase 前後で LOD 距離が不変 / 未 shift だと距離が膨らむ |

検証結果は本タスク完了時の Quality Gate を参照。

### Vehicle 回帰テストの閾値根拠（実測）

grassland + `carTemplate`、focus ≈ chunk (4,0) 中心で測定:

| 指標 | 実測 | Assert |
|---|---|---|
| settle 後 `heightAboveTerrainM` | ≈ 0.24–0.26 m | `-0.5 < h < 2.5`（沈下/浮遊の回帰帯） |
| settle / throttle 後 grounded | 4/4 | `>= 2`（完全喪失を検出） |
| throttle 90 step 水平速度 | ≈ 0.2 → ≈ 8 m/s | 増分 `> 1.5` かつ絶対 `> 2` |
| Rebase 直後 Global 連続 | ≈ 0 | discontinuity `< 1e-3` |
| Rebase 後も同系 | grounded 維持・再加速 ≈ 7.6 → 14.9 | 同様の帯域 |

固定値は「通すため」ではなく、観測された正常帯と過去の沈下・無加速回帰の間に余裕を置いたもの。

## 7. 変更ファイル

- `packages/physics-rapier/src/index.ts`
- `packages/renderer-three/src/index.ts`
- `packages/renderer-three/src/instances.ts`
- `packages/world-system/src/streaming.ts`
- `tests/integration/procedural-world.test.ts`
- `tests/integration/terrain-vehicle-rebase.test.ts`（Vehicle + Rebase 回帰）
- `tests/integration/terrain-collider-modes.experimental.test.ts`（最小比較・原因未特定）
- `tests/unit/streaming-frame-budget.test.ts`
- `tests/unit/world-asset-batch-lod.test.ts`（新規）

## 8. 残課題

- local Trimesh + translation / Fixed Body を将来再検討する場合は、本番スタックでの接地回帰の根本原因特定が先（最小構成だけでは未再現）
- Browser 実 Worker での Render Prefetch 効果の p95/p99 計測
- headless probe は WebGL を含まない点は従来どおり
