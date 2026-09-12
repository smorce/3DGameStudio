# 汎用可動翼・ユーザー操縦Starter Plane 実装レポート

## 実装結果

- Schemaをv5へ更新し、`controlBindings`を任意Channelの加算入力へ移行した。v4のWASD、Arrow alias、Space brakeはmigrationで保持する。
- Engineは保存Bindingとアナログ入力をChannel mapへ集約し、Physicsへ渡す。ArrowキーのEngine内hard-codeは撤去した。
- MotorはVelocity／Positionの2モードを持つ。PositionはRapier `configureMotorPosition()`、入力0はNeutral角へ戻る。
- Revolute Connectionに任意limitsを追加し、Rapier `setLimits()`へ適用した。Motorは明示的に接続されたHingeだけを駆動する。
- Starter Planeを固定主翼、左右Elevator、左右Aileron、Rudder、固定Twin Thruster、Nose/Main三輪Gearへ再設計した。空力role、Gear role、Motor実測値をTelemetryへ保存する。
- Studio InspectorへMotor mode、Channel、Gain、Position設定、Hinge limits、Control Binding編集とUndo可能なCommandを追加した。

## 検証

| ゲート                                     | 結果                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `pnpm typecheck`                           | PASS                                                |
| `pnpm lint`                                | PASS                                                |
| `pnpm test`                                | PASS: 17 files / 134 tests                          |
| `pnpm build`                               | PASS: Studio / Player / Server                      |
| Position Motor / Hinge limits integration  | PASS                                                |
| Car / Boat / Legacy Motor-Hinge regression | PASS                                                |
| Geometry sweep                             | PASS: Wing 0/2/4°, Tail -2/0/2°を記録               |
| Neutral ground-roll telemetry              | PASS: auto-liftoff判定なし                          |
| Playwright E2E                             | PASS: 既存全体26 tests、追加Inspector suite 8 tests |

## Evidence

- `plane-neutral-ground-roll.jsonl`: W入力だけのGround Roll。
- `plane-controlled-rotation.jsonl`: Throttle後にPitch Channelを入力した実Telemetry。
- `plane-control-surface-telemetry.json`: Elevator／Aileron／RudderのMotorと空力roleを抽出。
- `plane-liftoff-window.jsonl`: 最初の非接地Window。
- `plane-geometry-sweep.json`: Wing 0/2/4° × Tail -2/0/2°。
- `car-boat-regression.json`: CarとBoatの実Rapier回帰。
- `generic-flight-controls-architecture.md`: 入力、機構、Telemetryの構成。
- `generic-flight-controls-inspector.png`: Studio InspectorのE2Eスクリーンショット。
- `generic-flight-controls-quality-gates.json`: 実行済みゲートと全体Format検査の境界。

## 判定と残課題

W入力だけではPosition Motorを動かさず、Ground Rollから自動でPitchを生成しないことを確認した。Pitch入力時のSurface Pose、接地状態のNose→Main遷移、Motor目標／実角度はTelemetryで確認できる。短時間の接地遷移後に高度を保つ長時間巡航は空力モデルのチューニング対象として残るため、`stableTakeoff`の不成立をEvidenceへ隠さず記録している。

全体`format:check`は、編集禁止の`指示12.md`を含む既存23ファイルが未整形のため不合格だった。今回変更したファイルのPrettier check、型、Lint、Build、Unit／Integration、E2EはPASSである。
