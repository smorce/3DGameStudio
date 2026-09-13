# World Runtime 安定化・物理描画改修 報告

ブランチ: `fix/runtime-stability-rebase-shadow-colliders`  
ベース: `feat/procedural-world-runtime` (`7aec2e4`)  
作業時点の HEAD: `2688ab2`（レビュー指摘の追加修正を含む）

## 1. 原因分析

- Generated tree / building / rock のColliderは `scale * 0.4` の均一Cuboidで、Rendererの Cylinder / Box / Icosahedron と寸法が別管理だった。rotationも無視していた。`project.world.entities` の配置済みBuiltinも同じ共有定義を通っていなかった。
- Origin Rebaseは `RapierPhysics.step()` 内で `maybeRebase` → `setTranslation` しており、Standalone Static ColliderとCCD predicted motionがTeleportを衝突として扱えた。可動翼Jointだけ隙間が開く主因は、CCDがRebase変位をスイープしたことと、Body付属Colliderの位置伝播不足である（コード上plausible。短時間ProbeではBeforeでもair-stop未再現のため、ユーザー操作での因果断定は留保）。
- カメラはフレームあたり 8% lerp、DirectionalLight Shadow Cameraは原点±25m固定だった。

## 2. アーキテクチャ変更

Engine Fixed Update が Origin Rebase を1 Transactionで実行する。

```
physics.step()
WorldRuntime.planRebase(focusGlobal)
  → Physics.shiftOrigin(delta)
  → Renderer.shiftOrigin(delta)
  → WorldRuntime.commitRebase(plan)
  → Physics.syncOriginTelemetry()
```

Builtin entity の visual / collider は `world-system` の共有定義だけを参照する。Physicsは `renderer-three` をimportしない。Procedural生成と `world.entities` 配置の両方で同じ定義を使う。

## 3. Origin Rebaseの新しい流れ

1. Physics Step（worldOriginは不変）
2. 機体のglobal位置で `planRebase`（finite worldは常に undefined）
3. deltaがあれば Dynamic Body・Standalone Collider を同じdeltaで移動し、CCDを一時停止、`propagateModifiedBodyPositionsToColliders()`、linvel/angvel/rotationを復元
4. Rendererが Camera / Chunk / Sun / Sun Target を同じdeltaで移動
5. `commitRebase` で worldOrigin を更新
6. `syncOriginTelemetry()` で最新Telemetryの simulation / origin を現在座標系へ揃える
7. previous poseも同じdeltaでずらし、描画interpolationの座標系を揃える

## 4. Hinge分離

可動翼は Hinge に fixed された Panel の `metadata.aeroRole` でラベルする。Rebase中はCCDを切り、全BodyとStandalone Colliderを同じdeltaで動かす。Starter Planeの実測 max anchor error は 0.0064 m。

## 5. 空中停止

HUD速度が残ったまま機体が止まる症状は、Rebaseを物理イベントとしてCCDに食わせていたことがコード上の主因候補。step内rebaseを廃止し、Engine Transactionにした。2400 step / 909.7 m で air-stop 0、rebase時の速度変化 0。Before Probeでも同条件ではair-stop 0のため、ユーザー遭遇の再現は別途ブラウザ操作が必要。

## 6. Render Jitter

Physics 1/60 固定のまま、previous/current poseを `alpha = accumulator / dt` でlerp/slerpする。カメラは `1 - exp(-5 * dt)`（60fpsで旧 0.08 相当）。

## 7. Shadow

光方向は timeOfDay、位置とtargetは Player/Camera focus に追従する。Frustum半幅は 48 m。巨大化して影切れを隠さない。Playwrightで Rebase前 / Rebase直後 / 200m到達 の画面を `docs/evidence/runtime-stability-shadow/` に保存し、Simulation座標上でShadow targetが機体付近にいることを検証した。

## 8. Collider

`BuiltinEntityDefinition` を `packages/world-system/src/entities.ts` に置いた。

- tree: Cylinder 半径 0.2 m、高さ 1.5 m、中心Y 0.75 m。葉は巨大Boxにしない
- building: Box 2 x 2.6 x 2、中心Y 1.3 m + 屋根Cuboid
- rock: Ball 半径 0.8 m
- Procedural生成と `project.world.entities` の tree/building/rock の両方に適用。`asset` だけ従来経路

## 9. Chunk生成

長距離飛行の同期生成は最大約 2.6 ms、平均は 1 ms未満。速度方向prefetchがあり、飛行中の大きなカクつき主因ではないため Web Worker 化は行わない。

## 10. Before / After

| 項目                        | Before                      | After         |
| --------------------------- | --------------------------- | ------------- |
| flight distance             | 909.7 m                     | 909.7 m       |
| rebase count                | 9                           | 9             |
| max speed                   | 39.58 m/s                   | 39.58 m/s     |
| air-stop steps              | 0（短時間試行では未再現）   | 0             |
| max hinge anchor error      | 未計測                      | 0.0064 m      |
| rebase velocity delta       | 未計測                      | 0             |
| rebase global discontinuity | 未計測                      | ≈ 0（1e-6 m） |
| max generation latency      | 0.25 ms                     | 2.65 ms       |
| sync generation count       | 未計測                      | 245           |
| vitest                      | 179 pass                    | 194 pass      |
| e2e                         | 未実施（ベースでも5件失敗） | 29 pass       |
| format:check                | 未達                        | PASS          |

## 11. テスト

- `pnpm typecheck` PASS
- `pnpm lint` PASS
- `pnpm format:check` PASS
- `pnpm test` 194 PASS
- `pnpm test:e2e` 29 PASS（Shadow長距離飛行を含む）
- `pnpm smoke` PASS（e2e `@smoke` サブセット）
- `pnpm build` PASS

レビュー指摘への追加テスト:

- `world.entities` の rock/tree が共有Builtin Colliderを使うこと
- Origin Rebase直前直後の Global 座標が動かないこと（直接検査）
- Rebase境界フレームを除外せず連続性を測ること
- Playwright Shadow Follow（Simulation座標）と3枚の画面Evidence

## 12. 残っているKnown Issues

- 空力は簡易Surface Modelのまま。
- Rapier初期化のdeprecated parameters警告は依存ライブラリ由来。
- Visual Regressionの基準画像比較は未導入。Shadowは数式ユニットテスト、Runtime Stats、Playwright画面Evidenceで回帰する。
- 空中停止のBefore→After因果は、短時間ProbeではBeforeでも未再現。コード上のCCD仮説は残すが断定はしない。

## 13. 変更ファイル（実装）

新規: `packages/world-system/src/entities.ts`, `packages/engine-core/src/rebase.ts`, `packages/engine-core/src/interpolation.ts`, `packages/renderer-three/src/follow.ts`, `packages/renderer-three/src/interpolation.ts`, `tests/unit/builtin-entities.test.ts`, `tests/unit/origin-follow.test.ts`, `tests/integration/runtime-stability.test.ts`, `tests/e2e/runtime-stability.spec.ts`, `scripts/runtime-stability-probe.ts`

変更: `packages/world-system/src/runtime.ts`, `packages/physics-rapier/src/index.ts`, `packages/engine-core/src/index.ts`, `packages/renderer-three/src/index.ts`, `packages/renderer-three/src/instances.ts`, `packages/machine-system/src/math.ts`, `packages/runtime-telemetry/src/index.ts`, `apps/studio/src/main.tsx`, `.prettierignore`, `KNOWN_ISSUES.md`, `docs/procedural-world-architecture.md`
