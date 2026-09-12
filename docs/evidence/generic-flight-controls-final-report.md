# 汎用可動翼・ユーザー操縦Starter Plane 実装レポート

## 実装結果

- Schemaをv5へ更新し、`controlBindings`を任意Channelの加算入力へ移行した。v4のWASD、Arrow alias、Space brakeはmigrationで保持する。
- Engineは保存Bindingとアナログ入力をChannel mapへ集約し、Physicsへ渡す。ArrowキーのEngine内hard-codeは撤去した。
- **HingeはMotor Partなしで自分のRevolute Jointをposition制御できる。** `motorMode: "position"`を持つHingeはPhysicsが直接`configureMotorPosition()`で駆動する。Motor Part経由の駆動(既存Project互換)もそのまま残した。
- **Starter Planeの可動翼(Elevator×2 / Aileron×2 / Rudder)からMotor Part 5個を全廃**し、Hinge自身へ`controlChannel` / `controlGain` / stiffness / dampingを設定した。制御機構の追加質量はMotor 15kg + Hinge 15kgからHinge 2.5kgへ減少。
- **Hingeを「2枚のPanelが接する境界に回転軸がある薄い蝶番」へ変更した。** Plane用Hingeは1×0.08×0.08m・0.5kgで、`childAnchor=[0,0,0]`により回転軸を親Panelの端面上へ一致させ、可動Panelの前縁を同じ点へ密着させた。旧実装の約0.66mの構造的隙間は解消。
- **空力モデルの迎角符号を物理的に正しい向きへ修正した。** 旧実装は「法線が進行方向へ傾く=正の迎角」で、機首を上げると揚力が減る鏡写しの世界になっており、`↑`での離陸が原理的に不可能だった。修正後は前縁上げ(法線後傾)が正の迎角・上向き揚力。テンプレートの取付角は主翼+2°(rotation −2°)、水平尾翼−3°(rotation +3°、下向き揚力で機首上げ支援)。
- **Landing Gearを実際に近いPanelの下面(`-thickness/2`)へ密着させた。** Nose Gearは機首Panel下面(z=2.35)。Main Gearはテンプレート内で全Partの実質量分布から重心z(約−0.5)を計算し、その約0.5m後方の胴体Panel下面(x=±0.5)へ左右接続する。旧実装の機首Panelからの遠隔Connector(z=−4.1)と0.28mの空中Connectorは撤去。
- 機首に30kgのエンジンBlockを置いて重心を主翼付近へ前進させ、静的安定(重心が空力中心の前)を確保した。Thrusterは前方胴体(z=+1)の左右へ移設。
- Studio InspectorはHingeでもMotor Mode / Control Channel / Gain / Position設定を編集できる。

## 検証

| ゲート                               | 結果                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| `pnpm typecheck`                     | PASS                                                              |
| `pnpm lint`                          | PASS                                                              |
| `pnpm test`                          | PASS: 17 files / 137 tests                                        |
| `pnpm build`                         | PASS: Studio / Player / Server                                    |
| Hinge自己駆動(Motorなし) integration | PASS: `Position制御のHingeはMotor Partなしで自分の関節を駆動する` |
| Motor駆動Hinge(既存互換) regression  | PASS                                                              |
| **W+↑での安定離陸**                  | **PASS: `stableTakeoff=true`(step 351 / 5.85s)**                  |
| 接地順シーケンス                     | PASS: `111`(3輪) → `011`(Noseのみ離れる) → `000`(離陸)            |
| Neutral W単独                        | PASS: 600 stepでも自動離陸なし(最高36.3 m/s・高度1.1m)            |
| Playwright E2E (plane suite)         | PASS: 8 tests                                                     |

## Evidence

- `plane-controlled-rotation.jsonl` / `plane-controlled-rotation-summary.json`: W+`↑`(step 240から)での離陸Telemetry。`stableTakeoff: true`、最高高度92.7m、前進中の上向きLiftは857/857サンプルで正(平均+1628N)。
- `plane-neutral-ground-roll.jsonl` / `plane-neutral-ground-roll-summary.json`: W単独600 step。自動離陸なし。
- `generic-flight-controls-architecture.md`: 入力、機構、Telemetryの構成。

## 判定と残課題

`↑`入力で `3輪 → Noseのみ離れる(step 287, pitch −0.09 rad=機首上げ) → Main 2輪 → 0輪(step 351)` の離陸シーケンスが成立し、`findStableForwardTakeoff`が安定離陸と判定した。W単独では離陸しない。旧レポートで未成立だった`stableTakeoff`は解消済み。

残課題:

- `↑`を押し続けると最大Pitchが約65°まで達する(判定Window内は0.8 rad以下)。実用上は問題ないが、Pitch rate制限やElevator authorityの調整余地がある。
- 旧世界の符号を前提に取得した過去のSweep証跡(`wing-angle-sweep.json`等)は再取得が必要。`scripts/starter-plane-telemetry.ts`の角度引数は物理迎角(前縁上げが正)へ再定義済み。
