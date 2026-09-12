# 汎用可動翼・ユーザー操縦Starter Plane

## 入力経路

`controlBindings` は保存された `{ channel, key, value }` を入力ソースとし、Engineが同一Channelを加算して `[-1, 1]` にClampする。ゲームパッドとUIのアナログ入力も同じChannel mapへ合流するため、PhysicsはArrowキーやMachine名を参照しない。

## 機体構成

- 主翼: `Panel` の固定構造。`metadata.aeroRole = "main-wing"`。
- Elevator: 左右それぞれ `Hinge + Panel + Motor`。`controlChannel = "pitch"`。
- Aileron: 左右それぞれ `Hinge + Panel + Motor`。`controlChannel = "turn"`、左右の`controlGain`を反転。
- Rudder: `Hinge + Panel + Motor`。`controlChannel = "turn"`。
- 推進: 固定構造に接続した左右Twin Thruster。可動翼には接続しない。
- Landing Gear: Nose 1輪、Main 2輪。各輪は `Panel → Suspension → Wheel`、`metadata.gearRole`を持つ。

## Motor / Hinge

Velocity Motorは既存のbounded torque制御を維持する。Position MotorはRapierの`configureMotorPosition()`へ目標角度、stiffness、dampingを渡し、入力0では`neutralAngleRad`へ戻す。Revolute Connectionの任意limitsは`setLimits()`へ適用する。Motor未接続のHingeにはMotor制御を適用しない。

## Telemetry

Machine sampleへ`controlChannels`、`motorByPart`、Wheelの`role`を追加した。Motorには入力値、目標角度、実相対角度、誤差を記録し、空力role別集計とLanding Gear接地状態を同一時刻で確認できる。

## 互換性

Schema v4の`action/key`はv5のChannel形式へmigrationする。WASDに加えて旧EngineのArrow aliasとSpace brakeを保存Bindingとして補完するため、Car、Boat、Legacy Motor/Hingeの操作経路を維持する。
