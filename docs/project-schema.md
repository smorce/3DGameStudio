# Project Model v5

ProjectはschemaVersion、id、name、world、courses、machines、assets、missions、settingsを持ちます。Three.js／Rapierのオブジェクトや大きなGeometry配列を保存モデルへ埋め込みません。座標は右手系でYが上、前方が+Z、単位はメートル、回転はXYZ Eulerラジアンです。

## 今回の追加

- `schemaVersion: 5`。
- ActuatorのMotorは`motorTorque`を最大トルク（N·m）、`targetAngularVelocity`を入力100%時の目標相対角速度（rad/s）として別々に保存する。
- `partKinds`からWingを削除し、Panelを固定正方形の空力面として扱います。
- `settings.activeCourseId`: コースIDまたはnull。欠落時のみ互換フォールバックを許容します。
- `settings.runtimeProfile`: quality／balanced／performance。既定値balanced。
- `Suspension` Partを追加。`physics.collider: "none"`とsuspension設定を持ち、設定のAuthorityとしてPanel／Blockへfixed接続できます。
- `Wheel`はSuspensionへrevolute接続できます。Wheelへ直接設定されたsuspensionは、従来のPanel→Wheel接続での互換Fallbackとして保持します。
- `controlBindings`は`{ channel, key, value }`形式で任意の入力Channelへ加算します。同一Channelは`[-1, 1]`へClampされ、v4のArrow／Space互換Bindingも移行時に追加されます。
- Motorは`velocity`／`position`の2モードを持ち、`controlChannel`、`controlGain`、`neutralAngleRad`、Position PID相当のstiffness／dampingを保存します。
- Revolute Connectionは任意の`limits.minAngleRad`／`maxAngleRad`を持ち、RapierのJoint limitへ適用されます。
- `runtimeInfo.collider`: box／convexHull／trimesh。
- `runtimeInfo.colliderFile`／`colliderBytes`: 別ファイルのCollider Geometry参照とサイズ。
- `runtimeInfo.lods[]`: level、file、triangles、distance、bytes。旧`lodLevels`も読み書きできます。
- `runtimeInfo.optimization`: profile、sourceBytes、runtimeBytes、textureBytes、warnings。

ファイルURLは従来と同じ内部の`/api/files/<asset>/<file>`に制限します。Bounds、Collider方式、LOD情報だけをProjectへ保存し、Original／Runtime／Collider本体はAsset Storageへ置きます。MachineのCollider型は`box`／`cylinder`／`none`です。

## Migration

`parseProject(unknown)`はv0→v1→v2→v3→v4→v5の順で移行します。v0にmissionsがなければ空配列を追加します。v1では`courses[0]?.id ?? null`をactiveCourseIdへ設定し、runtimeProfileをbalancedへ補完します。v2のWingはPanelへ変換し、旧Panelを含む全Panelの幅・長さを`PANEL_SIDE`へ正規化します。v3ではMotorの旧目標速度`motorTorque / 20`を`targetAngularVelocity`へ補完し、Motor以外のActuatorには未使用値として0を補完します。v4では旧action bindingをthrottle／steeringへ変換し、ArrowUp／ArrowDown／ArrowLeft／ArrowRight／Spaceの互換Bindingを追加します。旧Assetの`collider: "box"`、`lodLevels: [0]`、`runtime.glb`はそのまま使えます。古いファイルを自動的に再処理することはありません。

未対応バージョン、不正な数値、地形配列長、重複ID、不正な接続・素材・コース参照を拒否します。activeCourseIdも参照整合性を検証します。読込失敗時は現在のCommandBusを置き換えません。

Machineのparts／connections／controlBindings、Worldの地形・水・照明・スポーン・環境、Courseの点列やチェックポイントなど既存構造は維持しています。単体テストで3つの既存デモのv0／v1移行とv2 Wing Fixtureのv3移行→保存→再読込を検証します。
