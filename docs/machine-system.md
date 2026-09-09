# Machine System

初期パーツはPanel、Block、Wheel、Motor、Steering、Hinge、Thruster、Wingです。LEVEL 1ではパレット選択時にモデルを変更せず、互換性のある空き位置を光らせ、クリックで取り付けます。WheelはPanelの4か所から選択できます。+Z側の2輪を操舵、-Z側の2輪を駆動輪とします。簡単画面で置いた値を詳細画面へ切り替えても再初期化しません。

Compileはfixed接続の連結成分ごとに複合剛体を作り、接続していない部品を別剛体にします。HingeはRapierのRevolute Jointへ変換します。WheelはRaycast Vehicleの車輪として実行し、サスペンション長・転がり・操舵を描画へ反映します。車輪の側面Colliderはありません。

Physicsの固定ステップは1/60秒、描画から独立した時間蓄積方式です。Ccdを有効にし、地形・道路・ジャンプ台・配置物との衝突を扱います。ジェットの推力、簡易浮力と揚力を追加しています。車以外の運動精度は既知の制約です。

実行中のPoseはProjectへ書き戻しません。`tests/integration/physics.test.ts`で前進と保存モデルの不変性を検証します。

配置候補の純粋計算、Connector互換性、part.attach／part.reattach／part.turn、Ghost、取消、Undo／Redoの設計は[パーツ配置](placement-system.md)を参照してください。
