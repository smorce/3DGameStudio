# Procedural Infinite World 設計

本ドキュメントは、有限Heightmapベースの現行Worldを、Seed + Chunk座標から決定論的に生成する共通World Runtimeへ移行するための設計である。

## 現在構造

現行ProjectはschemaVersion 5である。`world.terrain` が1枚のHeightmap（既定 128m / 解像度33、Plane用は 1024m / 129）を全頂点保存する。`terrainChunks(project)` が全セルを事前にChunkへ分割し、RendererとPhysicsがそれぞれ同じ関数を呼んでメッシュ／Trimeshを二重構築する。

`ChunkStreamer` は周辺Chunkの寿命だけを管理する。入力は有限メッシュの索引であり、座標から地形を生成しない。Waterの物理は `water.height` の無限平面だが、描画は `PlaneGeometry(terrain.size * 2)` の有限板である。Undo/RedoはProject全体の `structuredClone` である。Starterは `starterWorldPatch` / `starterPlaneWorldPatch` / Boatのinline water patchで分岐している。

Origin RebaseはEngine Fixed UpdateのTransactionとして実装する。シミュレーション座標は `global - worldOrigin` であり、Telemetryの `position` はlogical globalである。

## 問題点

- 固定Terrain端があり、Planeは旧512m〜1024m境界で地面が終わる。
- 「Infinite」を巨大Heightmapで偽装できない（schema上限4096、メモリ、Undoコスト）。
- RendererとPhysicsが別々に地形を作り、将来のProcedural化で不一致が起きる。
- Water描画に端がある。
- 遠距離で浮動小数点精度が劣化する。
- Machine名とWorld構成がStudio起動シーケンスで密結合している。
- 生成結果を全Chunk保存するとProjectが肥大する。

## 新構造

```
project-schema (v6)
      |
world-generator (Pure / 決定論的)
      |
WorldRuntime (Cache / RefCount / Edit Overlay / Origin / Ticket)
      |
 +----+-----+
 |          |
renderer   physics
      \    /
     engine-core
```

完成形は Car / Plane / Boat 別World Engineではなく、同一World Runtimeへ Environment Preset（grassland / airfield / archipelago）を与える。

旧Projectは `source.kind = "finite"` として1枚Heightmapを完全保存する。新規Starterだけ `source.kind = "procedural"` を使う。

## Schema

schemaVersion を 6 へ上げる。v5→v6 Migrationは旧 `world.terrain` を壊さず `source: { kind: "finite" }` と空の `edits` を補う。

```
world.source:
  | { kind: "finite" }
  | {
      kind: "procedural",
      seed,
      generatorVersion,
      preset,
      chunkSize,
      chunkResolution,
      parameters
    }

world.edits:
  terrainChunks: { [chunkKey]: { heightDeltas, colors } }
  generatedEntityTombstones: string[]

world.terrain   // finiteの実体。proceduralでは互換用の局所スナップショット
world.entities  // ユーザー配置のみ
world.water / lighting / environment / spawnPoints / chunkSize
```

`generatorVersion` を必ず保存する。アルゴリズム変更時は旧versionを再現するか、明示Migrationを行う。TypedArrayはRuntimeのみ。JSONへはnumber / recordを書く。

## Runtime

`WorldRuntime` はEngineが所有し、Renderer / Physics / EditorはConsumerである。責務はChunk座標、World Origin、生成、LRU Cache、参照カウント、Edit Overlay、Water、Preset、Generation Ticketである。

Consumerはロード半径だけを持ち、生成キャッシュは共有する。一方のUnloadでデータを捨てない。Cache上限は設定値（default 256）。Project再読込・Preset変更・破棄中の古い生成結果はTicket不一致で捨てる。

finite sourceは既存 `terrainChunks` を同一インターフェースへ載せる。procedural sourceだけ座標生成する。

## Coordinate System

論理座標は persistent global（Chunk座標 + local、または同等のglobalメートル）。シミュレーション座標は `global - worldOrigin`。

Chunk変換は `floor` を使い、負座標 `(-1,0) / (-1,-1) / (0,-1)` を正しく扱う。

Origin RebaseはEngineのFixed Updateが1回のTransactionとして実行する。`RapierPhysics.step()` はworldOriginを変更しない。

```
Engine Fixed Update
  physics.step()
  WorldRuntime.planRebase(focusGlobal)
    deltaなし → 継続
    deltaあり
      Physics.shiftOrigin(delta)
      Renderer.shiftOrigin(delta)
      WorldRuntime.commitRebase(plan)
```

`planRebase` は判定だけを行いoriginを変えない。`commitRebase` とPhysics/Rendererのシフトを同じdeltaで揃える。Dynamic RigidBody、Standalone Static Collider（Terrain / Entity / Course）、Render Chunk、Camera、Sun / Sun Targetを同じ平行移動で動かす。Rebase中はCCDを一時的に切り、`propagateModifiedBodyPositionsToColliders()` でBody付属Colliderを同期する。通常飛行中のCCDは維持する。

Telemetryの `position` はlogical globalを返す。`simulationPosition` / `worldOrigin` / `chunkCoordinate` を併記する。512m地点が突然0mに見えてはならない。Origin Rebase直後は `syncOriginTelemetry()` で最新サンプルのsimulation/originを現在座標系へ揃える。

## Builtin Entity Definition

tree / building / rock の見た目寸法とCollider寸法は `world-system` の `BuiltinEntityDefinition` が単一の正とする。RendererとPhysicsはここだけを参照する。Physicsがrenderer-threeをimportしてはならない。Procedural生成物と `project.world.entities` の配置済みtree/building/rockの両方で同じ定義を使う。`asset` kindだけ従来のAsset Collider経路へ進む。

- tree: 幹をCylinder Collider（半径0.2m、高さ1.5m、中心Y 0.75m）。葉を巨大Boxにしない
- building: 本体 Box 2 x 2.6 x 2（中心Y 1.3m）。屋根は別Collider
- rock: Ball（半径0.8m）

entity.transform の position / rotation / scale を両方へ適用する。

## Render Interpolation / Camera / Shadow

Physicsは 1/60 秒固定。描画は previous/current pose を `alpha = accumulator / fixedDt` でlerp/slerpする。Rebase時はprevious/currentの両方を同じdeltaで変換する。

Camera Followは `1 - exp(-lambda * dt)` で時間基準にする。Shadow CameraはPlayer周辺（約48m）だけを覆い、光の方向はtimeOfDayから決める。

## Chunk Generation

境界通過で半径6（13×13）の辺が一度に必要になると、同期一括生成は Frame Spike の主因になる。`ChunkStreamer` は予算付き待ち行列、`WorldRuntime` は `enqueuePrefetch` / `pumpGeneration` で Cache を先埋めする。Physics 緊急半径だけ `ensureChunks` で同期保証する。`generationLatencyMs` 単体では判定せず、`frameTimeMs` / commit ms / Spike を併用する。Worker スレッド化は次段（`pumpGeneration` が入口）。

## Chunk Lifecycle

1. Consumerが必要なChunk Keyを列挙（円形半径 + 速度方向prefetch）
2. RuntimeがCacheを探し、なければGenerator（+ Edit Overlay）で作る
3. 参照カウントを増やす
4. ConsumerがUnloadしたら参照だけ減らす
5. 参照0かつLRU超過でCacheから落とす
6. 永続EditsとTombstoneはProjectに残る

Border頂点は同一Global Grid座標から高さを取る。Adjacent Chunkの共有辺は完全一致する。

## Persistence

保存するのは Seed / generatorVersion / preset / parameters / 変更ChunkのDelta / Tombstone / ユーザーEntity である。未編集の生成Chunkは保存しない。

Terrain Brushは Base Height + Edit Delta。Unload/Reload後は Generator → Overlay の順で復元する。Generated Entityは決定論的IDを持ち、削除はTombstoneで残す。Undo/Redoは既存CommandBusを維持する。Editはsparse deltaなのでProject Cloneの肥大を抑える。

## Migration

- v0〜v5: 既存のMachine互換Migration
- v5→v6: Worldをfinite sourceへ包む。Height / Color / Water / Entities / Courses を失わない
- 旧Worldを勝手にProceduralへ変換しない
- 将来の明示的 Convert を妨げない（今回UIは作らない）

## Testing Strategy

座標変換、負Chunk、決定論、生成順序非依存、共有辺一致、Preset安全領域、Tombstone、Edit永続、v5→v6、Legacy保存、共有Chunk Data、Rebase連続性、Telemetry連続性、Cache上限、既存Car/Plane/Boat/Editor/Course/Save回帰を自動テストする。性能は生成時間・Loaded/Cache数・Collider数・長距離Memoryを数値で残す。
