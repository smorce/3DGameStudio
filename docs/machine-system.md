# Machine System

初期パーツはPanel、Block、Wheel、Suspension、Motor、Steering、Hinge、Thrusterです。LEVEL 1ではパレット選択時にモデルを変更せず、互換性のある空き位置を光らせ、クリックで取り付けます。Panelは固定サイズの正方形で、4辺のStructural Connectorを使って並べられます。Suspensionは構造側へfixed、Wheelへrevoluteで接続し、restLength等はSuspension側をAuthorityとします。Panelへ直接revolute接続されたWheelは従来どおりWheel側設定をFallbackとして使います。簡単画面で置いた値を詳細画面へ切り替えても再初期化しません。

Compileはfixed接続の連結成分ごとに複合剛体を作り、接続していない部品を別剛体にします。HingeはRapierのRevolute Jointへ変換します。パレットのHingeは薄い棒状（既定`[1, 0.08, 0.08]`m）で、初期は受動関節です。`motorMode: "position"`にするとMotor Partなしで自分の関節をキー入力から駆動できます。初期設定のまま置いたときの挙動と、上下矢印で動かす手順は[関節の配置とキー操作](hinge-controls.md)を参照してください。SuspensionはColliderを持たず、質量だけを複合剛体へ加えます。WheelはRaycast Vehicleの車輪として実行し、サスペンション長・転がり・操舵を描画へ反映します。車輪の側面Colliderはありません。

Physicsの固定ステップは1/60秒、描画から独立した時間蓄積方式です。Ccdを有効にし、地形・道路・ジャンプ台・配置物との衝突を扱います。ThrusterはWorld Positionへの継続Force、Panelは各World PositionへのSurface Aerodynamics、Motorは明示接続されたRevolute Jointだけを駆動するTorque Actuatorとして処理します。Motorの`motorTorque`は最大Torque（N·m）、`targetAngularVelocity`は目標相対角速度（rad/s）です。速度誤差へ比例ゲイン40を掛けた要求Torqueを最大TorqueでClampし、Body Aへ負方向、Body Bへ正方向に等しく加えます。Rapier 0.19.3の公開JavaScript APIにはMotor最大Impulseを設定するAPIがないため、このTorque制限はJointを維持した公開RigidBody `addTorque()`による方式Bです。`throttle`が0またはMotorが無効なら能動Torqueは加えず、Hinge dampingだけを受動的に適用します。車以外の運動精度は既知の制約です。

実行中のPoseはProjectへ書き戻しません。`tests/integration/physics.test.ts`で前進と保存モデルの不変性を検証します。

配置候補の純粋計算、Connector互換性、part.attach／part.reattach／part.turn、Ghost、取消、Undo／Redoの設計は[パーツ配置](placement-system.md)を参照してください。
