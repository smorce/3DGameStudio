# 関節（Hinge）の配置とキー操作

パレットの「関節」は、Starter Planeの可動翼と同じ**薄い棒状 Hinge**です。PanelとPanelのあいだに置き、必要ならキー入力で角度を動かせます。

配置の付け方自体は[パーツ配置](placement-system.md)を参照してください。ここでは「初期設定のまま置いたとき」と「上下矢印で動かしたいとき」をまとめます。

## 初期設定で置くとどうなるか

パレットや `createPart("Hinge")` で置いた関節の既定値は次のとおりです。

| 項目 | 既定値 | 意味 |
| --- | --- | --- |
| 寸法 | `[1, 0.08, 0.08]` m | Panel辺に沿う棒状。旧い立方体関節ではない |
| 質量 | `0.5` kg | Plane可動翼と同じ |
| `motorMode` | `velocity` | 能動の角度追従はしない |
| `controlChannel` | `throttle` | 入力Channel名 |
| `motorTorque` | `0` | Hinge自身はTorqueを出さない |
| 接続 | 親へ `revolute`、出力側へ構造パーツ | 物理上は可動関節になる |

空のMachineのキー割当（既定）では、↑↓は `throttle`、←→は `steering` です。

この状態で Play すると:

- 関節は**受動の Revolute Joint**として動く（外力や慣性で回ることはある）
- ↑↓を押しても、関節がパネルを能動的に倒したり起こしたりは**しない**
- Motor Partを出力側へ固定接続していない限り、Velocity駆動もかからない

つまり「Panel → 関節 → Panel」と繋いだだけでは、飛行機の Elevator のように矢印キーでは動きません。

## 上下矢印で動かしたい場合

Hinge 自身を Position 制御にする方法が簡単です（Starter Planeと同じ考え方。Motor Partは不要です）。

### 手順

1. 「つくる」で Panel → 関節 → Panel を接続する
2. 「くわしくつくる」または Studio で関節を選ぶ
3. Actuator を次のようにする

| 項目 | 推奨値 | 説明 |
| --- | --- | --- |
| Motor Mode | `position` | 入力に応じて目標角度へ追従する |
| Control Channel | `throttle` または `pitch` | どのキー入力を読むか |
| Control Gain | `1`（必要なら符号反転で `-1`） | 入力の向き |
| Position Stiffness | `500` 前後 | Plane可動翼の参考値 |
| Position Damping | `50` 前後 | 同上 |
| Neutral Angle | `0` | 入力0のときの角度 |

4. キー割当を Channel に合わせる

**いちばん手早い方法（キー割当を触らない）**

- Control Channel を既定のまま `throttle` にする
- 空のMachineでは ↑ = `throttle +1`、↓ = `throttle -1` なので、そのまま上下矢印で動く

**飛行機と同じ割り振りにしたい場合**

- Control Channel を `pitch` にする
- Studio の Control Bindings で次を設定する
  - ↑ → channel `pitch`, value `1`
  - ↓ → channel `pitch`, value `-1`
- 車用に ↑↓ を `throttle` へ残したい場合は、両方の Binding を同居させないよう整理する

### 動作の要点

- `motorMode: "position"` の Hinge は、Physics が Revolute Joint を直接 Position 駆動する
- 入力0では `neutralAngleRad` へ戻ろうとする
- 角度制限が必要な場合は、接続（Revolute Connection）の limits を設定する（Plane可動翼は約 ±15°）

## 参考構成

```text
親 Panel  ──revolute──  Hinge(position / pitch or throttle)  ──fixed相当の出力──  子 Panel
```

Starter Plane は Elevator / Aileron / Rudder をこの方式で組んでいます。実装の詳細は [machine-system.md](machine-system.md) と [generic-flight-controls-final-report.md](evidence/generic-flight-controls-final-report.md) を参照してください。

## 別案: Motor Part で駆動する

従来どおり、Hinge の出力側へ Motor を固定接続し、Motor の `velocity` / `position` と `controlChannel` で駆動することもできます。既存プロジェクト互換用です。新しく可動翼を作る場合は、Hinge 自己駆動（上記）を推奨します。
