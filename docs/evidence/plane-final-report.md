# Starter Plane 最終レポート

## A. 実装範囲

- `Suspension` PartをSchema、Machine System、Rapier Physics、Renderer、Palette、Inspector、Placement、Dummy AIへ追加した。
- Suspensionは`collider: "none"`で、質量だけを複合剛体へ加える。設定はSuspension側をAuthorityとする。
- 旧Panel→Wheelの直接接続は壊さず、Wheel側の設定をFallbackとして維持した。
- 計画ファイル自体は変更していない。

## B. Landing Gear構成

- Starter Planeは4輪から三輪へ変更した。
- Nose Gearは中央1輪、Main Gearは左右2輪で、Main Gearを重心より後方へ配置した。
- Plane専用Wheelサイズは`[0.30, 0.38, 0.38]`。Global Wheel Defaultは変更していない。
- 各Gearは`Panel → Suspension (fixed) → Wheel (revolute)`の接続で、Templateは27 Part、Wheel 3、Suspension 3となった。

## C. Suspension Visualと同期

- VisualはUpper Mount、Outer Cylinder、Inner Sliding Rod、Lower Mountで構成した。
- EDITでは`restLength`、PLAYではRapierの実測Wheel Suspension LengthからLower MountとRodを更新する。
- World Y固定の差分ではなく、Suspension上端PoseとWheel中心Poseの2点を機体姿勢へ逆変換して表示する。
- Ghost Previewも同じVisual Factoryを使う。

## D. Telemetryと空力

- 既存の`totalLiftN`、`liftVerticalN`、`totalDragN`の意味は変更していない。
- `rawLiftVerticalN`、`rawDragN`、`appliedAerodynamicForceWorldN`、`appliedAerodynamicVerticalN`、`appliedAerodynamicToWeightRatio`を追加した。
- `aerodynamicByRole`で`main-wing`、`horizontal-tail`、`fuselage`、`vertical-tail`を集計する。
- Role集計には適用済みLift、Drag、合力、迎角、係数、Pitch Moment、Panel数を含めた。

## E. Sweep結果

### restLength

`0.45 / 0.55 / 0.65 / 0.75m`を同一条件で600 Physics Step試験した。既存のStable Forward Takeoff条件を満たしたのは`0.65m`だけだったため採用した。

| restLength | Stable Takeoff | Peak Pitch Rate | Peak Vertical Accel |
|---:|:---:|---:|---:|
| 0.45 | No | 2.171 rad/s | 76.711 m/s² |
| 0.55 | No | 0.420 rad/s | 38.029 m/s² |
| 0.65 | Yes | 1.467 rad/s | 36.914 m/s² |
| 0.75 | No | 1.034 rad/s | 43.965 m/s² |

### Horizontal Tail

Main Wing 8°固定で`0 / 2 / 4 / 6 / 8°`を比較した。Stable Forward Takeoff条件を満たし、既存の正の迎角を維持する`8°`を採用した。追加のWing 6/7/8° × Tail 0/2/4° Sweepでは、8°/8°以外にStable条件を満たす候補はなかった。

## F. Smooth Liftoff評価

最終設定はMain Wing 8°、Horizontal Tail 8°、restLength 0.65m、relaxation 4、Throttle 1である。

- Stable Takeoff: `true`
- Liftoff: Step 207 / 3.450s
- Liftoff speed: 33.769m/s（forward 33.187m/s）
- Stable window: 180 Physics Step / 2.983s
- Forward distance: 172.142m
- Max pitch absolute: 0.328rad
- Pitch vibration range: 0.523rad
- Liftoff window peak applied aero/weight: 6.292
- Liftoff window peak vertical acceleration: 36.914m/s²
- Liftoff window peak vertical jerk: 2005.150m/s³
- Liftoff +1.0s pitch: 0.083rad

変更前4輪BaselineはStable Takeoff Step 168、Liftoff speed 37.756m/s、Max Lift/Weight 7.045、Pitch vibration range 0.395radだった。BaselineとAfterでRaw/Appliedの定義が異なるため、Applied値はAfter側で明示して比較した。

## G. Studio実画面確認

- `Starter Planeを表示して保存する` E2E: PASS
- `Starter PlaneをW+Aで左旋回させる` E2E: PASS
- 画面上でStarter PlaneのPart数は27、Paletteに「サスペンション」が表示されることを確認した。
- Screenshot: `docs/screenshots/starter-plane.png`
- Before reference: `docs/evidence/plane-gear-baseline.json`および変更前の保存済みScreenshot履歴

## H. Regression / Verification

- Unit / Integration: 127 tests PASS
- Integration: Planeの三輪化後に既存の4輪Wheel件数期待値を3へ更新し、Plane離陸、空力、Boat、Motor、Streaming、AI Suspension Planを確認した。
- Typecheck: PASS
- Lint diagnostics / ESLint / cycles: PASS
- Build: Studio、Player、Server PASS
- E2E: 26 tests PASS

## I. Evidence一覧と完了条件

- `plane-gear-baseline.json`
- `plane-liftoff-window-before.jsonl`
- `plane-gear-suspension-sweep.json`
- `plane-tail-angle-sweep.json`
- `plane-wing-tail-sweep.json`
- `plane-liftoff-window-after.jsonl`
- `plane-liftoff-smoothness-summary.json`
- `plane-flight-final-v2.jsonl`
- `plane-flight-final-v2-summary.json`
- `docs/screenshots/starter-plane.png`

全ての機能To-do、Sweep、Telemetry、UI統合、回帰テスト、Studio E2E、Evidenceを完了した。
