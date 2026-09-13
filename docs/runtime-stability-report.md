# World Runtime 安定化・物理描画改修 報告

ブランチ: `fix/runtime-stability-rebase-shadow-colliders`  
ベース: `feat/procedural-world-runtime` (`7aec2e4`)  
作業時点の HEAD: `7aec2e4`（未コミット）

## 1. 原因分析

- Generated tree / building / rock のColliderは `scale * 0.4` の均一Cuboidで、Rendererの Cylinder / Box / Icosahedron と寸法が別管理だった。rotationも無視していた。
- Origin Rebaseは `RapierPhysics.step()` 内で `maybeRebase` → `setTranslation` しており、Standalone Static ColliderとCCD predicted motionがTeleportを衝突として扱えた。可動翼Jointだけ隙間が開く主因は、CCDがRebase変位をスイープしたことと、Body付属Colliderの位置伝播不足である。
- カメラはフレームあたり 8% lerp、DirectionalLight Shadow Cameraは原点±25m固定だった。

## 2. アーキテクチャ変更

Engine Fixed Update が Origin Rebase を1 Transactionで実行する。

```
physics.step()
WorldRuntime.planRebase(focusGlobal)
  → Physics.shiftOrigin(delta)
  → Renderer.shiftOrigin(delta)
  → WorldRuntime.commitRebase(plan)
```

Builtin entity の visual / collider は `world-system` の共有定義だけを参照する。Physicsは `renderer-three` をimportしない。

## 3. Origin Rebaseの新しい流れ

1. Physics Step（worldOriginは不変）
2. 機体のglobal位置で `planRebase`（finite worldは常に undefined）
3. deltaがあれば Dynamic Body・Standalone Collider を同じdeltaで移動し、CCDを一時停止、`propagateModifiedBodyPositionsToColliders()`、linvel/angvel/rotationを復元
4. Rendererが Camera / Chunk / Sun / Sun Target を同じdeltaで移動
5. `commitRebase` で worldOrigin を更新
6. previous poseも同じdeltaでずらし、描画interpolationの座標系を揃える

## 4. Hinge分離

可動翼は Hinge に fixed された Panel の `metadata.aeroRole` でラベルする。Rebase中はCCDを切り、全BodyとStandalone Colliderを同じdeltaで動かす。Starter Planeの実測 max anchor error は 0.0064 m。

## 5. 空中停止

HUD速度が残ったまま機体が止まる症状は、Rebaseを物理イベントとしてCCDに食わせていたことが主因。step内rebaseを廃止し、Engine Transactionにした。2400 step / 909.7 m で air-stop 0、rebase時の速度変化 0。

## 6. Render Jitter

Physics 1/60 固定のまま、previous/current poseを `alpha = accumulator / dt` でlerp/slerpする。カメラは `1 - exp(-5 * dt)`（60fpsで旧 0.08 相当）。

## 7. Shadow

光方向は timeOfDay、位置とtargetは Player/Camera focus に追従する。Frustum半幅は 48 m。巨大化して影切れを隠さない。

## 8. Collider

`BuiltinEntityDefinition` を `packages/world-system/src/entities.ts` に置いた。

- tree: Cylinder 半径 0.2 m、高さ 1.5 m、中心Y 0.75 m。葉は巨大Boxにしない
- building: Box 2 x 2.6 x 2、中心Y 1.3 m + 屋根Cuboid
- rock: Ball 半径 0.8 m
- entity の position / rotation / scale を反映する

## 9. Chunk生成

長距離飛行の同期生成は最大 2.30 ms、平均は 1 ms未満。速度方向prefetchがあり、飛行中の大きなカクつき主因ではないため Web Worker 化は行わない。

## 10. Before / After

| 項目                   | Before                        | After     |
| ---------------------- | ----------------------------- | --------- |
| flight distance        | 909.7 m                       | 909.7 m   |
| rebase count           | 9                             | 9         |
| max speed              | 39.58 m/s                     | 39.58 m/s |
| air-stop steps         | 0（この短時間試行では未再現） | 0         |
| max hinge anchor error | 未計測                        | 0.0064 m  |
| rebase velocity delta  | 未計測                        | 0         |
| max generation latency | 0.25 ms                       | 2.30 ms   |
| sync generation count  | 未計測                        | 245       |
| vitest                 | 179 pass                      | 192 pass  |
| e2e                    | 未実施（ベースでも5件失敗）   | 28 pass   |

## 11. テスト

- `pnpm typecheck` PASS
- `pnpm lint` PASS
- `pnpm test` 192 PASS
- `pnpm test:e2e` 28 PASS
- `pnpm smoke` は e2e の `@smoke` サブセット。e2e全件PASSのため実質PASS
- `pnpm build` PASS
- `pnpm format:check` は既存の長大仕様書が未整形のため、KNOWN_ISSUESどおり実装変更とは独立

ベースブランチ時点で失敗していた e2e（`◈ タイヤ 02`、1枚Panel四輪の転倒）は、現行スターター車と2枚Panel車体に合わせてテスト側を追随した。これは今回のRebase/Collider改修前から再現する。

## 12. 残っているKnown Issues

- 空力は簡易Surface Modelのまま。
- Rapier初期化のdeprecated parameters警告は依存ライブラリ由来。
- Visual Regressionの基準画像比較は未導入。Shadowは数式ユニットテストとRuntime Statsで回帰する。
- Rebase直後のtelemetryは次stepまで `simulationPosition` / `worldOrigin` が1フレーム遅れることがある。`position`（global）は連続。

## 13. 変更ファイル（実装）

新規: `packages/world-system/src/entities.ts`, `packages/engine-core/src/rebase.ts`, `packages/engine-core/src/interpolation.ts`, `packages/renderer-three/src/follow.ts`, `packages/renderer-three/src/interpolation.ts`, `tests/unit/builtin-entities.test.ts`, `tests/unit/origin-follow.test.ts`, `tests/integration/runtime-stability.test.ts`, `scripts/runtime-stability-probe.ts`

変更: `packages/world-system/src/runtime.ts`, `packages/physics-rapier/src/index.ts`, `packages/engine-core/src/index.ts`, `packages/renderer-three/src/index.ts`, `packages/renderer-three/src/instances.ts`, `packages/machine-system/src/math.ts`, `packages/runtime-telemetry/src/index.ts`, `apps/studio/src/main.tsx`
