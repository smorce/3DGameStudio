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

## 4. Evidence（headless probe）

| 指標 | Before | After |
|---|---|---|
| Worker | なし（スタブ） | Pool + prepareChunk（Browser実Worker、Nodeはsync） |
| syncFallback（Warmup後） | syncと未分離 | **0** |
| Frame p95（headless） | 未計測 | ~2.3ms（WebGL除外） |
| over33.3 / over50 | Spike計測のみ | **0 / 0**（probe） |
| 飛行距離 | ~910m | ~789m |
| air-stop | 0 | 0 |
| max hinge error | 0.0064m | 0.0064m |

Browser 実測の absolute frame time は Evidence 補助。CI の絶対 Fail 条件にはしていない。

## 5. テスト

- `pnpm typecheck / lint / format:check` PASS
- `pnpm test` 211 PASS
- `pnpm test:e2e` 29 PASS / `pnpm smoke` PASS
- `pnpm telemetry:plane` PASS / `pnpm build` PASS（worker-entry chunk 出力確認）

新規: `tests/unit/async-streaming.test.ts`（Profiler / Prepared / Transfer / Budget / Priority / dedupe / sampleHeight / Retention / stale）

## 6. 残Known Issues

- Physics Terrain Collider の chunk-local + translation 化は未完了（simulation 座標 trimesh を維持）
- headless probe の frame time は WebGL を含まない
- 空力簡易モデル、Rapier deprecated 警告は従来どおり
