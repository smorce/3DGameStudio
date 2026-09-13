# Procedural Infinite World 最終レポート

## A. Before

現行Worldはschema v5の1枚Heightmap（既定128m/33、Plane用1024m/129）をProjectへ全保存し、`terrainChunks()` で事前分割していた。RendererとPhysicsが同じ関数を二重に呼び、Water描画は `terrain.size * 2` の有限Planeだった。固定Terrain端があり、Planeは旧512〜1024mで地面が終わった。Origin Rebaseは未実装。Starterは `starterWorldPatch` / `starterPlaneWorldPatch` / Boat inline water で分岐していた。

## B. Architecture

```
project-schema v6
      → world-generator (Pure)
      → WorldRuntime (Cache / RefCount / Edit Overlay / Origin / Ticket)
      → renderer-three / physics-rapier
      → engine-core (Owner)
```

Car / Plane / Boat は同一World Runtimeへ Environment Preset を渡す。Machine名でWorldを判定しない。

## C. Coordinate System

- Persistent: globalメートル、または Chunk座標 + local
- Simulation: `global - worldOrigin`
- Chunk変換は `floor`。負座標 `(-1,0) / (-1,-1) / (0,-1)` をUnit Test済み
- RebaseはProcedural Worldのみ、Chunk境界単位、Physics Step後
- Telemetry `position` はlogical global。`simulationPosition` / `worldOrigin` / `chunkCoordinate` を併記

## D. Procedural Generator

- Seed + `generatorVersion` (現行1) + preset + chunkX/Z
- HashベースValue Noise。巨大Floatを直接Noiseへ投げない
- Chunk Size **32m** / Resolution **33**（1m格子）
- 選定理由: 32×33の平均生成 **0.51ms**、最大 4.3ms。車の接地に足り、Main Thread同期で足りる
- 64×65は平均0.80msだが遠方同時Chunk数が増え、車の格子も粗い
- Worker: 不要（`not-required`）。Adapterは `packages/world-generator/src/worker.ts` に分離済み
- Border頂点は同一Global Grid Sample。隣接辺は完全一致（Test済み）

## E. Presets

| Preset | 用途 | Spawn | 特徴 |
|---|---|---|---|
| grassland | Starter Car | 平坦な安全圏半径14m | 緩丘、遠方の山、Tree/Rock/Building |
| airfield | Starter Plane | 滑走路 z=-40..360, \|x\|<=20 | 滑走路のみ平坦。外側は平原と山 |
| archipelago | Starter Boat | 水深<=-5m、半径24m | 島・海底・Endless Water |

Preset差は生成Data。Physics/Rendererに `if (preset)` 分岐を置かない。

## F. Streaming

- Render半径: Procedural 6 / Finite 2
- Physics半径: Procedural 3 / Finite 2、Unload +1
- Prefetch: 水平速度 8m/s以上で進行方向へ最大4Chunk
- Cache default **256**、設定可能。100km相当(3125 Chunk)の走査でも上限32でBounded
- Consumer別Ref Count。片側UnloadでDataを捨てない

## G. Physics

- Rapier `@dimforge/rapier3d-compat` 0.19 の型定義に Heightfield は見当たらない
- Regular Gridは **Trimesh** を継続。頂点は共有Chunk Data
- Finiteは既存 `terrainChunks` 経路を維持（回帰保護）
- ProceduralはWorldRuntime.meshForから同一HeightをCollider化
- Chunk境界は共有頂点のため隙間なし

## H. Water

- Sea LevelはWorld Runtime / `world.water` から供給。Archipelagoはどこでも浮力継続
- Visualは Camera追従の 800m Plane。巨大化しない
- Coastline: Terrain > sea → 陸、未満 → 海

## I. Persistence

保存対象: seed / generatorVersion / preset / parameters / 変更Chunkの heightDelta・color / Tombstone / ユーザーEntity

- Brushは Base + Delta。Chunk跨ぎ対応
- Generated Entity ID: `gen:{version}:{preset}:{cx}:{cz}:{index}`
- Undo/Redoは既存CommandBus（Project snapshot）を維持

## J. Migration

v5→v6で finite source へ包む。旧デモ3種とv0〜v5をTest。Height/Color/Waterを変形しない。

## K. Floating Origin

- 条件: Procedural、Focus ChunkがOriginから3Chunk以上
- Rebase後はBodyを平行移動し、Streamerを再構築
- Telemetry globalは連続。512mが0mに戻って見えない
- 100km相当は Teleport（Chunk座標 3125）で確認

## L. Performance

| 指標 | 値 |
|---|---|
| 生成 32×33 平均 | 0.51 ms |
| 生成 32×33 最大 | 4.30 ms |
| Cache上限 | 256（試験時32でもBounded） |
| Physics Load（1024 finite） | Terrain Collider 25（半径2） |
| Worker | 未使用（生成が十分速い） |

## M. Car Test

Grassland上で180 step走行。地形は継続。`terrainAvailable=true`。Cache < 256。数kmはChunk遷移テストで代替。

## N. Plane Test

Airfieldで z=600 から飛行。旧512m境界を越え `terrainAvailable=true`。既存Starter Plane回帰（finite 1024）も成功。

## O. Boat Test

Archipelagoで前進後 z=2000 へ移動しても Water enabled、海面サンプリング継続。既存Boat浮上・旋回回帰も成功。

## P. Editor Test

Chunk境界 x=32 の raise をSave/Reloadし、高さが一致。finiteのUndo/Redoも維持。

## Q. Regressions

- Unit 127、Integration 51 成功
- Typecheck / Lint / Cycles 成功
- 既存Car/Plane/Boat/Course/Save/Placement回帰を維持
- 旧v5 Projectは finite として完全Load

## R. Remaining Limitations

- 複数LODの実行時切替は未導入（Dataに `lodLevel` を予約）。今回は生成が軽く、隙間リスクを避けた
- Finite Worldは従来どおり端を持つ（互換のため変換しない）
- RebaseはProceduralのみ。Finiteの1024mは精度上不要
- Visual EvidenceのBrowser撮影はE2E `tests/e2e/procedural-world.spec.ts` に用意。実行環境でPlaywrightが必要
- 実時間の100km走行はしていない。Chunk座標遷移とRebaseで代替

## Infinite の定義

これは数学的無限ではなく、固定Heightmap端を通常Gameplayに持たず、Chunk座標から必要な地形を決定論的に生成し続け、Origin Rebaseで実用的な長距離移動ができる **Practically Unbounded Procedural World** である。
