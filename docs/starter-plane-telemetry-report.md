# Starter Plane 前進離陸・Runtime Telemetry調査レポート

600 Physics Step（10秒）、Throttle ±1、Steering 0を同じ条件で実行した。判定は最大高度ではなく、`findStableForwardTakeoff()`の90 Step Windowを使った。Window全体で、接地APIが有効、全輪非接地、高度1.5m以上、World速度20m/s以上、`forwardSpeedMps > 0`、`abs(pitchRad) <= 0.8`を要求し、離陸高度から0.5mを超える降下も除外した。

Evidence:

- [修正前前進](evidence/forward-before.jsonl)
- [修正前後退](evidence/backward-before.jsonl)
- [修正後前進](evidence/forward-after.jsonl)
- [修正後退](evidence/backward-after.jsonl)
- [主翼角Sweep](evidence/wing-angle-sweep.json)
- [修正前方向比較](evidence/starter-plane-direction-comparison-before.json)
- [修正後方向比較](evidence/starter-plane-direction-comparison.json)

## 1. 原因

原因は`planeTemplate()`の主翼X回転が-8°で、機体forward +ZおよびPanel local +Y法線に対して逆向きだったことです。`computePanelAerodynamicForce()`の符号規約は内部的に一貫していました。

Unit Testでは、法線`[0, cos(a), sin(a)]`と速度`+Z`の組み合わせで`a > 0`なら迎角、Lift Y、Lift係数が正になり、速度を`-Z`へ反転すると3つの符号が反転しました。修正前の実Telemetryでも、-8°前進のStep 2〜6は`forwardSpeedMps > 0`に対して`liftVerticalN`が-0.85、-3.40、-7.63、-13.54、-21.13N、迎角は約-0.45rad、Lift係数は約-0.84でした。

機体全体では重力による下向き速度、姿勢変化、胴体・尾翼Panelも合算されるため、全Stepの符号が単純に反転するわけではありません。方向を`forwardSpeedMps < -5`で抽出すると、修正前-8°の後退は582 Sample中569 Sampleが正のLift、平均`liftVerticalN`は+3384.83Nでした。後退では十分な速度と正の揚力を得られる一方、前進方向の安定飛行として扱われるべきではない状態が存在したことをTelemetryで確認しました。

## 2. 座標系

- Machine forward: World `+Z`。機首Panelは+Z側にあり、正Throttleの推力も+Z。
- Panel normal: Panel local `+Y`を機体姿勢でWorldへ回転した方向。
- Positive wing incidence: local X軸の正回転。local `+Z`を`+Y`へ近づける機首上げで、前進+Z時に正の迎角を作る。
- Positive pitch: local +Zの機首が上を向く機首上げ。
- 空力の相対速度: `velocity - windVelocity`。迎角は相対速度の向きとPanel法線の関係で計算する。

この定義を[空力ドキュメント](aerodynamics.md)と`planeTemplate()`のコメントへ明記しました。

## 3. 前進・後退比較

修正前-8°の初期比較は、機体が落下し始めるため前進・後退とも初期数StepのLift Yが負になります。これはPanel角の符号だけでなく、下向きの相対空気速度も含む実機体値です。純粋なPanelの方向反転はUnit Testで分離して確認し、実機体では方向別の集計も保存しました。

| 条件                                 |    Sample例 | forwardSpeedMps | liftVerticalN | average angle of attack | average lift coefficient |
| ------------------------------------ | ----------: | --------------: | ------------: | ----------------------: | -----------------------: |
| 修正前 -8° 前進 Step 2               |           2 |          +0.563 |        -0.850 |                  -0.449 |                   -0.841 |
| 修正前 -8° 後退 Step 2               |           2 |          -0.563 |        -0.953 |                  -0.543 |                   -0.943 |
| 修正前 -8° 前進、`forwardSpeed > 5`  | 582 samples |               — | +1864.91 平均 |                       — |                        — |
| 修正前 -8° 後退、`forwardSpeed < -5` | 582 samples |               — | +3384.83 平均 |             +0.628 平均 |              +0.874 平均 |
| 修正後 +6° 前進、`forwardSpeed > 5`  | 465 samples |               — | +1168.48 平均 |                       — |                        — |
| 修正後 +6° 後退、`forwardSpeed < -5` | 582 samples |               — |  -731.98 平均 |             -0.688 平均 |              -0.572 平均 |

修正前の後退は正の揚力を持続しやすい一方、修正後は後退の平均Liftが負へ変わり、前進方向の安定離陸判定は成立しません。

## 4. 実施した修正

- [packages/machine-system/src/index.ts](../packages/machine-system/src/index.ts): Starter Planeの主翼角を-8°から+6°へ変更しました。質量、重力、Thruster出力1600N/基、固定Physics Stepは変更していません。
- [packages/runtime-telemetry/src/index.ts](../packages/runtime-telemetry/src/index.ts): Panel迎角・Lift係数・Drag係数の平均、World推力ベクトル、前進持続離陸判定を追加しました。
- [packages/physics-rapier/src/index.ts](../packages/physics-rapier/src/index.ts): 既存の実Panel計算と実Thruster力から上記Telemetryを集計しました。
- [scripts/starter-plane-telemetry.ts](../scripts/starter-plane-telemetry.ts): Throttle指定、前後比較、600 Step角度Sweep、離陸指標のJSON/JSONL出力を追加しました。
- [packages/aerodynamics/src/index.ts](../packages/aerodynamics/src/index.ts): 変更していません。符号はUnit Testで固定しました。
- 既存の離陸条件から`liftToWeightRatio > 1`だけに依存する判定を廃止し、前進方向・接地API・90 Stepの高度維持・平均Vertical Speedを組み合わせました。

## 5. 主翼角Sweep結果

全条件はThrottle +1、Steering 0、600 Stepです。

| Wing angle | Stable takeoff | Liftoff Step | Liftoff speed | Max speed | Max height | Final height | Max pitch abs | Pitch range | Max Lift/Weight |
| ---------: | :------------: | -----------: | ------------: | --------: | ---------: | -----------: | ------------: | ----------: | --------------: |
|        +4° |       No       |            — |             — |     38.35 |       1.00 |       -64.36 |         0.883 |       0.883 |           0.870 |
|        +6° |      Yes       |          364 |         20.06 |     39.82 |       6.05 |        -3.99 |         0.961 |       1.577 |           8.139 |
|        +8° |       No       |            — |             — |     37.85 |       1.00 |       -46.08 |         0.930 |       0.930 |           1.095 |
|       +10° |       No       |            — |             — |     37.00 |       1.00 |       -39.77 |         0.939 |       0.939 |           1.292 |
|       +12° |       No       |            — |             — |     35.75 |       1.26 |       -31.82 |         0.984 |       0.984 |           1.570 |

## 6. 採用値

+6°を採用しました。5候補のうち、前進速度17.63m/sを保った状態でStep 364から90 Step（1.483秒）のStable Flight Windowを唯一満たしました。Window終了高度は6.00m、Window内最低高度は1.83m、Window内の最大Pitch絶対値は0.8rad未満でした。+4°、+8°、+10°、+12°は最高速度が出ても90 Stepの前進・高度維持・Pitch条件を満たさず、最大高度だけを理由に採用していません。

600 Step全体では+6°も最終高度-3.99m、最大Pitch絶対値0.961radとなるため、長時間巡航まで解決したとは判断していません。

## 7. 修正前後比較

修正前は現行不具合値-8°、修正後は採用値+6°です。

| 指標                    | 修正前 -8° 前進 |          修正後 +6° 前進 |
| ----------------------- | --------------: | -----------------------: |
| 離陸開始時間            |          5.950s |                   6.067s |
| 離陸開始速度            |        21.71m/s |                 20.06m/s |
| 前進距離                |         186.73m |                  198.55m |
| 最大速度                |        39.41m/s |                 39.82m/s |
| 最大高度                |          55.34m |                    6.05m |
| 最終高度                |          55.34m |                   -3.99m |
| 離陸後最低高度          |           7.21m |   -3.99m（600 Step全体） |
| Stable Window内最低高度 |           7.21m |                    1.83m |
| Pitch最大絶対値         |        0.836rad | 0.961rad（600 Step全体） |
| Pitch振動幅             |        1.481rad |                 1.577rad |
| 最大Lift/Weight         |           8.127 |                    8.139 |
| 平均Vertical Speed      |       +11.51m/s | -1.81m/s（離陸候補以降） |
| Stable Flight継続時間   |          1.483s |                   1.483s |

修正後の値は「前進方向に進みながら短時間の持続飛行を確認する」条件を満たしますが、長時間のPitch制御と高度維持は残課題です。

## 8. Regression結果

- 前進Throttle +1: Stable Takeoff Step 364、90 Step Window成立。
- 後退Throttle -1: `forwardSpeedMps`は最大でも負、最大World速度41.97m/sでもStable Takeoffは不成立。
- 正ThrottleのWorld推力: `thrusterForceWorldN[2] > 0`。
- 負ThrottleのWorld推力: `thrusterForceWorldN[2] < 0`。
- Hop/降下: 瞬間的な高度上昇後に落下する+18°ケースはStable Takeoff不成立。
- 弱Thruster、翼面積減少、主翼角0°: 標準機よりStable Flight性能が低下。
- 車、ボート、既存Physics/Runtime Telemetry: 既存テストを維持して実行。

品質ゲートは`typecheck`、`lint`、Unit、Integration、全Test、Build、E2E、SmokeがPASSしました。リポジトリ全体の`format:check`だけは、今回変更していない既存の`2026_0909_1650_報告内容.md`と`指示4.md`〜`指示9.md`が未整形のためFAILしました。今回変更したソース、Telemetry文書、最終レポート、生成JSONは対象指定のPrettier検査でPASSしています。

## 9. 残る問題

- Starter PlaneはPitch制御およびElevatorを実装していないため、600 Step後半に高度低下と姿勢変動が残ります。
- 空力はPanel近似で、Ground effect、Downwash、Wake、Stall、風、Compressibilityを扱いません。
- `groundClearance`はまだ共通Telemetry項目ではなく、高度とWheel接地状態を併用しています。
- HUDはWorld Space速度であり、Windを考慮したAirspeedではありません。
- Panel単位の詳細値は常時保存せず、今回のRuntime TelemetryではMachine単位の迎角・係数平均を保存しています。
