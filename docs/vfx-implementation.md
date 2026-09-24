# 実装結果

## 変更概要

基準 `feat/sample-world-catalog`（`d2fd5c6`）から `feat/renderer-flight-vfx` を作成。
Engine → PhysicsRenderState → ThreeRenderer → Part Visual の流れを維持し、描画専用VFXを追加した。

## 追加したVFX

- Wing Vapor：Starter Plane左右の最外側主翼から、薄い青白色の粒子軌跡を生成。
- Ground Contact Smoke：既存WheelRenderStateの接地情報と機体速度から薄い煙を生成。
- Thruster Ground Wash Smoke：表示地形へのThree.js Raycastで排気の到達位置だけを取得。
- Thruster Flame：既存nozzle / flame / flame coreを維持し、白い芯・青白い炎・青い尾の三層に拡張。推力比例の長さと±7%の揺らぎを追加。

## 変更ファイル一覧

| ファイル                                                 | 変更内容                                                 |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `packages/renderer-three/src/effects/effect-config.ts`   | 閾値・発生量・寿命・品質別上限、純粋な発生条件関数       |
| `packages/renderer-three/src/effects/particle-system.ts` | 固定長粒子プール、Point Sprite、リセット・原点移動・解放 |
| `packages/renderer-three/src/effects/visual-effects.ts`  | エミッター、描画地形判定、ワールド座標の放出制御         |
| `packages/renderer-three/src/index.ts`                   | load/render/prewarm/shiftOrigin/dispose接続、fastStats   |
| `packages/renderer-three/src/part-visuals.ts`            | 既存Thruster炎を三層化                                   |
| `packages/engine-core/src/index.ts`                      | DROP時に演出を無効化する描画オプション                   |
| `packages/engine-core/src/agent-observation.ts`          | 既存観測APIへVFXカウンターを公開                         |
| `packages/machine-system/src/index.ts`                   | 最外側主翼2枚にmetadataを設定                            |
| `demos/worlds/airfield.json`                             | 上記metadataを配布サンプルにも反映                       |
| `tests/unit/visual-effects.test.ts`                      | 発生条件、寿命、上限、原点移動、決定性、地形Raycast      |
| `tests/unit/part-visuals.test.ts`                        | 三層構成、推力・時間変化、Ghost非表示                    |
| `tests/integration/visual-effects.test.ts`               | 実Rapier状態からの煙・飛行軌跡、入力状態の不変性         |
| `tests/e2e/visual-effects.spec.ts`                       | 実PLAY、離陸、旋回、地上煙停止、STOP、再読込             |
| `scripts/vfx-browser-probe.ts`                           | 実WebGLで境界条件・原点移動・resource disposeを検証      |
| `docs/evidence/vfx/`                                     | 描画プローブのJSON・画像、性能比較                       |
| `docs/screenshots/vfx-*.png`                             | 実PLAYの地上走行・離陸旋回画像                           |

## VFXの発生条件

| 演出                 | 条件                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Wing Vapor           | `Panel` かつ `metadata.visualEffects.wingVapor` が有効。18m/s以下は0、18〜35m/sで増加、35m/s以上は最大200粒子/秒/エミッター |
| Ground Contact Smoke | `WheelRenderState.inContact === true`。5m/s以下は0、30m/sで最大16粒子/秒                                                    |
| Thruster Ground Wash | 推力絶対値が0.15より大きく、排気方向3.5m以内に表示地形がある。最大24粒子/秒                                                 |
| Thruster Flame       | PLAYの推力絶対値が0.01より大きい。Ghost、EDIT、DROPでは非表示                                                               |

既存の逆推力表示規則に合わせ、推力の強さには絶対値を使用する。
主翼metadataは `{ visualEffects: { wingVapor: { enabled: true, side: -1 | 1 } } }`。
`wingVapor: true` も受理し、ローカル+X側を使う。ローカルの翼端・後端位置にパーツの姿勢とスケールを適用する。

## Particle System設計

- 粒子用Object3Dは2個のTHREE.Pointsのみ。外部画像・新規ライブラリなし。
- TypedArrayの固定長リングプール。上限時は古いスロットを再使用。
- 標準上限はVapor 256、Smoke 192。qualityは512/384、performanceは128/96。
- `VisualEffects(quality)` を拡張ポイントとし、現時点のRendererはbalancedを使用。
- Vapor寿命0.65秒、地面煙1.1秒。地面煙には描画専用の拡散・上昇・拡大を適用。
- 円形の透明度を `gl_PointCoord` で生成。煙はNormal Blending、炎はAdditive Blending。
- 粒子は機体Groupの子に置かず、Scene直下の独立Groupに保持。
- エミッター移動の区間内に放出位置を分散させ、低フレームレートでも軌跡が分断しにくくする。
- 煙のばらつきはseed付き疑似乱数。clear時にseedも初期化。

## Origin Rebase対応

`ThreeRenderer.shiftOrigin(delta)` から全Active粒子、エミッターの前フレーム位置、地面hitキャッシュへ同じdeltaを適用。
粒子数・寿命を維持し、次フレームの放出位置補間も継続する。
実WebGLプローブでは256mの原点移動を実施し、粒子数不変とFloat32精度内の位置一致を検証した。

## Performance対策

- 粒子の追加ドローコールは最大2。透明粒子はShadowを生成しない。
- 粒子更新のVector3、Geometry、Material生成なし。計算用Vector3を再利用。
- 排気Raycastは稼働中Thrusterのみ、1エミッター約12Hz、全体で最大4回/フレーム。
- 対象は地形メッシュのみ。木・建物・水面・Physics Worldは照射しない。
- hitを短期キャッシュし、遠ざかった場合と推力OFF時に放出を止める。
- PLAY前prewarmで粒子ShaderとBuffer、三層炎を描画準備し、その後粒子をclear。
- `fastStats` の4カウンターはScene traverseを行わず取得。
- Post Processing、EffectComposer、Bloomは導入しない。既存GPU timer・直接描画を維持。

## Physicsを変更していないことの確認

`packages/physics-rapier/`、`packages/aerodynamics/`、`packages/water-system/`、`packages/project-schema/` と依存関係ファイルに差分なし。
Force / Impulse / Collider / Gravity / 空力係数の追加・変更なし。Schema Versionは7のまま。
統合テストでもVFX更新前後のPhysicsRenderStateと物理速度が一致することを確認した。

## テスト結果

- typecheck：成功。
- lint：成功、循環依存なし。
- unit / integration：`pnpm test` 全47ファイル・346テスト成功。
- e2e：新規VFX E2EがChromiumで成功。既存の全E2Eスイートは未実行。
- build：Studio / Player / Serverすべて成功。既存のbundleサイズ・依存ライブラリ注釈に関する警告あり。
- 実WebGLプローブ：成功。Shader/console/pageエラーなし。prewarm、排気地面煙、地面から離れた後の停止、EDIT、reload、disposeを確認。

再現コマンド：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/visual-effects.spec.ts
# 別ターミナルでViteを起動してから実行
pnpm exec vite apps/studio --host 127.0.0.1 --port 5182 --strictPort
OBSERVE_BASE_URL=http://127.0.0.1:5182 pnpm exec tsx scripts/vfx-browser-probe.ts
```

## 実際にPLAYして確認した結果

Chromium / SwiftShaderでアプリを操作し、低速では軌跡なし、加速後に左右翼の軌跡、接地走行時の煙、離陸後の煙停止、旋回中の湾曲した軌跡を確認。
STOPしてDROPを経由しEDITへ戻ったとき、再読込時とも粒子0を検証。

- [実PLAYの地上走行](screenshots/vfx-ground-contact.png)
- [実PLAYの離陸・旋回](screenshots/vfx-flight-turn.png)
- [翼端軌跡・白青炎の描画プローブ](evidence/vfx/wing-vapor.png)
- [排気地面煙の描画プローブ](evidence/vfx/ground-wash.png)
- [Origin Rebase後の描画](evidence/vfx/origin-rebase.png)
- [描画プローブの検証値](evidence/vfx/renderer-probe.json)

排気地面煙の画像は、ノズルを下へ向けた描画専用の姿勢で再現したもの。通常のStarter Planeは水平排気なので、水平な滑走路では地面へ当たらない。

## Performance比較

変更前 `d2fd5c6` と変更後で `starter-plane-straight` を同一環境・逐次実行。両方のシナリオが成功。

| 指標            |    変更前 |    変更後 |
| --------------- | --------: | --------: |
| drawCalls最大   |    142.00 |    146.00 |
| triangles最大   | 122528.00 | 124576.00 |
| render p95 (ms) |      4.80 |      5.00 |
| GPU p95 (ms)    |     49.94 |     44.59 |
| frame p95 (ms)  |     66.70 |     50.10 |
| frame p99 (ms)  |    199.90 |    116.70 |
| spikes >20ms    |    149.00 |    149.00 |
| spikes >33ms    |    133.00 |    130.00 |
| spikes >50ms    |     32.00 |     21.00 |
| 計測フレーム数  |    170.00 |    173.00 |

[測定JSON](evidence/vfx/performance.json)。単発比較であり、Streamingされた地形数と取得フレーム数は実行ごとに変動するため、全体のドローコール差はVFXだけの差ではない。今回の実測では目立つフレーム時間の悪化は見られなかったが、性能改善を証明する測定ではない。SwiftShader環境のため、実GPUの60fps品質は未確認。

## 残課題

- 計測環境はSwiftShaderによるソフトウェア描画。実GPUでの60fps品質評価は別途必要。
- 既存 `starter-plane-takeoff` 観測シナリオの `stable-takeoff-detected` 判定は変更前・変更後とも失敗。今回のE2Eではpitch入力を離陸まで維持して、実際の離陸と地面煙停止を確認済み。既存観測シナリオの入力・判定調整は今回変更していない。
- Runtime Profileとの自動接続は未実施。品質別上限の拡張ポイントを用意。
