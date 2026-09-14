# Async World Streaming / Frame Budget 改修報告

ブランチ: `perf/async-world-streaming-frame-budget`  
ベース: `fix/streaming-frame-budget` (`2109535`)

## 1. Beforeのボトルネック

Frame Budget付き `ChunkStreamer`（maxCreates=2）は既にあったが、各 create の中身は Main Thread 同期のままだった。

- `getChunk` miss → `generateChunk`
- `BufferGeometry` + `computeVertexNormals`
- `new THREE.Color(hex)` flatMap
- Rapier trimesh 生成

境界通過で複数 Chunk が揃うと、1 create が重く、Frame Spike が残った。

## 2. Architecture変更

```
Worker Pool → Priority Queue → PreparedChunk (Transferable)
  → Render/Physics Ready Queue → Frame-Budgeted Commit
```

Fixed Step 1/60・補間・Engine Rebase Transaction は維持。

## 3. 実装要点

| 項目 | 内容 |
|---|---|
| Worker | `worker-entry.ts` + `ChunkWorkerPool`（1〜4、設定可）。Node/test は sync fallback |
| PreparedChunk | heights/positions/normals/colors/indices/entities。chunk-local geometry |
| Transferable | heights/positions/normals/colors/indices の buffer |
| Priority | P0 Physics Critical … P4 Editor、昇格・dedupe |
| Commit | Render 2ms/2chunk、Physics Critical は Fixed Step 境界 |
| Prefetch | t=0.5/1/1.5/2.0s + Retention 0.75s |
| sampleHeight | cache miss は軽量サンプル（Full Chunk 禁止） |
| LOD | `Set<WorldAssetBatch>` + `frameIndex % 4` |
| Physics safety | `ensurePhysicsReady` Barrier（Play/Respawn） |

## 4. レビュー指摘への追従修正

| 優先度 | 問題 | 対応 |
|---|---|---|
| Blocker | `world.entities` が Chunk Group で二重オフセット | Instance を Chunk-local 化、LOD center は simulation 座標を維持 |
| Blocker | Terrain Edit が PreparedChunk に未反映 | Worker/`prepareChunk` へ `terrainEdit` を渡し、法線・色も編集後から生成 |
| High | Physics Critical が Cache のみで Collider 未作成 | `commitCriticalColliders()` を Fixed Step 前に実行 |
| High | 毎Frame `renderer.stats` → `root.traverse` | Spike 計測は `fastStats`、フル stats は Studio 250ms 間隔のみ |
| High | `lodBatches` が破棄後も残る | `userData.release` で Set から削除、`disposed` ガード |
| High | Worker `onerror` で Job が永久 in-flight | `jobByWorker` で回収・再queue・Worker 再生成 |
| Medium | Ready Queue が Physics/Render 未分離 | Request 用途 (`wantsPhysics` / `wantsRender`) で振り分け |
| Medium | Evidence が実装と未整合 | Probe を再実行。Pool の `syncFallback`・Probe 中 max Ready/Commit を記録 |

## 5. Evidence（headless probe）

| 指標 | After / Flight | Turn |
|---|---|---|
| forceSyncWorkers | true（Node 制約。Browser 実 Worker は別経路） | 同左 |
| Pool syncFallback（Warmup後） | 213（同期 prepare 回数。Node では正常） | 136 |
| Frame p95（headless / WebGL除外） | ~2.3–2.4 ms | ~2.5 ms |
| over33.3 / over50 | 0 / 0 | 0 / 0 |
| 飛行距離 | ~789 m | ~426 m |
| air-stop | 0 | 0 |

**注意:** headless Probe は Dedicated Worker を使えないため `workerCount=0` / `forceSyncWorkers=true`。Browser 上の実 Worker 性能は E2E / 手動飛行で確認する。`syncFallback` は WorldRuntime ではなく **Worker Pool** のカウンタ。

## 6. テスト

- `pnpm typecheck` PASS
- `pnpm test` 213 PASS（Ready Queue 分離・terrainEdit・既存 Streaming 含む）
- 追従修正後: `pnpm test` 217 PASS（詳細は [async-streaming-followup-report.md](async-streaming-followup-report.md)）

## 7. 残 Known Issues

- Physics Terrain Collider の真の chunk-local + translation 化は未完了。当面は PreparedChunk を Simulation 座標へ TypedArray 直焼きした Standalone Trimesh（車両コントローラ互換）
- headless probe の frame time は WebGL を含まない
- Browser 実 Worker の p95/p99 は CI 絶対 Fail 条件にしていない
- 空力簡易モデル、Rapier deprecated 警告は従来どおり
