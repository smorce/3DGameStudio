# Panel Surface Aerodynamics

Machine Studioの空力面は、専用のWingではなく、すべて同じ正方形Panelです。Panelの形、位置、向き、厚さ、接続関係から物理条件を作り、`packages/aerodynamics`がRapierに依存しない純粋計算を担当します。

## Panel Model

- `PANEL_SIDE = 1.0`
- `DEFAULT_PANEL_THICKNESS = 0.12`
- `PANEL_DENSITY = 250`
- `area = PANEL_SIDE * PANEL_SIDE`
- 機体World座標は`+X = 右`、`+Y = 上`、`+Z = 機首方向`
- LOCAL X：横、LOCAL Y：厚さ／Surface Normal、LOCAL Z：縦
- Panel local `+Y`が面の法線で、PanelのWorld法線は機体姿勢で回転した`+Y`
- X軸回転の正方向はlocal `+Z`を`+Y`へ近づける機首上げで、正のwing incidenceは前進時に正の迎角を作る
- 新しいPanelの`transform.scale`は`[1, 1, 1]`
- Studioで変更できる寸法は`physics.size[1]`の厚さだけ

厚さを`t`とすると質量は`PANEL_DENSITY * PANEL_SIDE * PANEL_SIDE * t`です。厚さの変更はVisual、Collider、Massへ同じCommandで反映します。

Panelには4辺の`edge-x-`、`edge-x+`、`edge-z-`、`edge-z+` Structural Connectorがあります。辺同士を接続すると、子Panelの反対側の辺が同じAttachment Pointになります。前後の`jet-*` ConnectorにはThrusterを接続できます。

## 空力式

PanelのWorld Positionを`center`、World Normalを`n`、その点の速度を`panelVelocity`、風を`windVelocity`とします。

```text
relativeAirVelocity = panelVelocity - windVelocity
speed = |relativeAirVelocity|
q = 0.5 * airDensity * speed²
```

`flow = normalize(relativeAirVelocity)`、`normalAlongFlow = clamp(dot(n, flow), -1, 1)`とし、NormalをFlowに直交する平面へ射影します。

このモデルの迎角は「相対空気速度の向きから見たPanel法線の符号」です。したがって、機体前方`+Z`へ進む平板では、法線の`+Z`成分が正のとき正の迎角になります。正の迎角では`CL`が正になり、射影された法線のWorld Y成分が正であれば上向きLiftになります。速度を`-Z`へ反転すると、同じPanel法線に対する迎角とLift係数の符号も反転します。

```text
alpha = atan2(normalAlongFlow, |project(n, plane perpendicular to flow)|)
CL = clamp(1.1 * sin(2 * alpha), -1.1, 1.1)
CD = clamp(0.03 + 1.25 * normalAlongFlow², 0.03, 1.28)
lift = q * area * CL * normalize(projectedNormal)
drag = q * area * CD * -flow
force = lift + drag
```

速度がほぼ0、入力が非有限、またはNormalが無効な場合は力を0にします。最終力には`2500`の安全上限を設けています。Panelごとに`velocityAtPoint(panelWorldCenter)`を取得し、`addForceAtPoint(force, panelWorldCenter, true)`で作用させるため、翼端の速度差と偏心によるTorqueが残ります。すべての力を重心へ集約しません。

## ThrusterとMotor

- ThrusterのLOCAL +Zが推進方向、LOCAL -ZがNozzle／排気方向。
- Starter Planeの機体forwardもWorld +Zで、正のThrottleはThrusterのWorld +Z推力と正の`forwardSpeedMps`を生む。
- Thrusterは自身のWorld Positionへ継続`addForceAtPoint`を適用します。
- MotorはWheel全体への加算値ではありません。
- Motorは明示的に固定接続されたHinge側のRevolute Jointだけを駆動し、`configureMotorVelocity`を使います。
- 接続されていないMotorは物理効果を持ちません。

## v2 → v3 Migration

v2の`Wing`はPanelへ変換します。ID、位置、回転、色、接続参照、Metadataは保持し、厚さは旧`physics.size[1] * transform.scale[1]`を`0.02`〜`1`へClampします。幅・長さは新しい`PANEL_SIDE`へ統一し、Scaleは`[1, 1, 1]`へ戻します。旧`wing` ConnectorはStructuralへ変換し、`accepts: ["Wing"]`は`accepts: ["Panel"]`になります。

v3の新規Part KindとPaletteにはWingが存在しません。`planeTemplate`も複数のPanelとThrusterだけで構成されます。

## Known Scope

このモデルは軽量なSurface近似です。Wing-body interaction、Wake、Downwash、Ground effect、Compressibility、Viscosity、詳細なStall、Turbulenceは扱いません。これは意図したScopeであり、数値流体力学への置き換えではありません。
