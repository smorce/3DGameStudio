# Known Issues

- 空力はPanel単位の簡易Surface Modelです。Wake、Downwash、Ground effect、Compressibility、Viscosity、詳細なStall、Turbulenceは再現しません。
- PanelのEdge Connectorは接続位置を維持しますが、任意形状同士の干渉解決や自動配置は行いません。
- Motorは明示的にHinge側へ固定接続された場合だけRevolute Jointを駆動します。未接続Motorの自動Wheel強化はありません。`motorTorque`（最大Torque）と`targetAngularVelocity`（目標角速度）は独立していますが、Rapier 0.19.3の公開Joint APIに最大Impulse設定がないため、速度誤差比例制御とBody A／Bへの等大反対向きTorqueで制限します。
- `pnpm format:check` は作業指示・過去報告の原本を `.prettierignore` に除外したうえで、実装・テスト・現行文書を検査します。
- 高速落下時の地形めり込みは、終端速度クランプ（80 m/s）とステップ後のめり込み復帰（車輪下端・Partコライダ最下点を地形高さと比較し、機体全体を持ち上げて下向き速度を消す）で防いでいます。地形の高さ場に基づく復帰のため、建物など地形以外の静的Colliderへの貫通は対象外です。
- 翼付き機体の高速落下で起きていたCCD「air-stop」は、同一機体の別RigidBody Collider同士をCCDが衝突候補にしていたことが原因です。本番ではMachineごとに異なる`collisionGroups`を割り当て、自機内部だけ衝突（とCCD予測）を除外します。地形・他Machineとの衝突とCCDは維持します。membership/filterは各16bitのため同時ユニーク割当は最大15機で、超過時はbitを周回再利用します（将来はPhysics Hookへ移行予定）。

# 現在の制約

本リポジトリはローカル制作向けの初期実装です。以下は隠さず残す拡張・制約です。

- 車輪はRapierのRaycast Vehicleでシミュレーションします。独立した車輪Colliderによる側面衝突や実サスペンションのリンク機構はありません。可動Hingeは実Revolute Jointです。
- 浮力・揚力は簡易近似です。Propeller、Servo、Spring、Suspension、Sensor、Battery、Logic、Ropeは未実装です。飛行機・ボートは工作の出発点であり、車と同等の操縦品質までは検証していません。
- 描画と静的Colliderはチャンク単位でロード／破棄します。Procedural Terrain の重い生成（heights / mesh / normals / colors）は Worker Pool 側で行い、Main Thread は Frame Budget 内の Commit に限定します。Physics Terrain は PreparedChunk を Simulation 座標へ TypedArray 直焼きした Standalone Trimesh です（当面の正式方式）。chunk-local Trimesh + translation / Fixed Body / HeightField は実装・検証済みだが、DynamicRayCastVehicleController を含む現行車両 Physics で接地回帰が観測されたため採用を撤回しており、根本原因は未特定です。Projectの地形格子・空間索引、配置済み素材のCollider SourceはCPU側に保持します。Origin RebaseはEngineがPhysics / Renderer / WorldRuntimeを同じdeltaで同期するTransactionです（LOD Batch 中心も同じdeltaでずらします）。実GPU・モバイル・長時間運用での大規模性能は未検証です。
- Instancingの描画範囲判定とLOD切替は専用 Collection で分散更新します。個体ごとのFrustum Cullingより描画三角形数が増える画角があります。スキン／Morph等は通常描画へ戻り、複雑な素材のLOD生成はLOD0のみになる場合があります。
- CourseのLoop／Tunnelはデータ種別のみで、専用の曲面・トンネル形状の生成は未実装です。複数コースの選択・保存・実行は対応しています。
- オンライン素材の実取込はPoly HavenのglTF／GLBを対象とします。ambientCGの検索・メタデータは実動作確認済みですが、ZIPマテリアルの変換は未実装です。Kenneyは展開済みGLBを個別に読み込みます。
- Importには設定可能な安全上限とStorage予算があります。Runtime Profileの値は初期値です。TextureはWebP、MeshはMeshoptを使用し、KTX2は未導入です。Runtime予算超過は監視表示であり、自動的な品質調整や強制退避は行いません。
- Static AssetはBox／Convex Hull／Trimeshに対応します。自動の凸分解は未実装です。Collider SourceのRuntime読込は64MiB、各Geometry配列は300万要素までの安全上限があり、破損・未対応・過大なデータはBoxへ戻します。旧素材は元のBoxを保ち、再Importしない限りLODやColliderを自動生成しません。
- LEVEL 1は互換性のある接続先への配置・つけ直しと離散回転に対応します。任意の面への配置、部品の重なりの自動解消、複数マシンの編集選択、汎用Transform Gizmoは未実装です。任意軸・回転・大きさは詳細画面で編集します。
- 保存履歴は最大100操作のメモリ内スナップショットです。保存／再読込で編集モデルは復元しますが履歴は復元しません。ブラウザーの保存容量を超えた場合はJSON書き出しを利用してください。
- 素材ファイルはServerのデータディレクトリに保存します。JSONだけを別環境へ移しても、素材ファイルは自動転送されません。
- Serverのプロジェクト保存APIは単一ファイルです。共同編集、アカウント、認証、クラウド運用、実Blender、実AI接続は対象外です。生成Jobもプロセスメモリ内で、再起動では復元しません。
- Chromiumで自動検証しています。Firefox／WebKitの実行構成はありますが、今回の合否対象には含めていません。
- Rapier初期化で依存ライブラリ由来のdeprecated parameters警告が1回出ます。実行例外ではありません。Rapier WASMを含む遅延チャンクは約2.24MB（gzip約0.83MB）で、低速回線では最初のPlayに読み込み時間がかかります。
- テクスチャメモリは概算値です。GPU実測値ではありません。Visual Regressionの基準画像比較は未導入で、提出画像は機能テストから撮影しています。

## World Design / Asset Factory（指示17）

- Real AI Planner、Real Astra、Blender自動操作は未実装です。交換用interface、Dummy実装、Processorまでの結合試験を用意しています。
- 引数なしDummyは共通placeholderです。同梱Sample Worldは木・灯台等を区別するPrimitive素材を使いますが、同じSlot内のvariantは共通形状で、完成した美術素材ではありません。
- PBR texture ZIPは登録できますが、Rendererでは未対応です。Material推定や偽GLB生成はしません。画像形式はPNG/JPEG/WebP、ZIPは非暗号化store/deflateに限定します。
- Far Proxyは低解像度terrainのみで、Propと編集差分は近景で反映します。独立したMid専用LODは未追加です。
- CLIのKenney/KayKitローカルPackは空の境界です。外部Providerのacquireは通常テストで実通信していません。
- BakeはAsset metadataと保存時SHA-256を固定します。Runtimeで配信ファイル全体のhashを再計算しません。
- 自然Propの近傍判定は候補配列を走査します。高密度化にはSpatial Hash化の余地があります。
- 指示18で6種類のBiome Surface Profileを導入しました。Biome別の摩擦・滑り・砂の抵抗は未導入です。
- 未審査の取得Assetはstyle=unverified／reviewRequiredとして区別します。geometry・texture・materialからの自動画風審査・変換は未実装です。
- 初期報告のE2E失敗4件への対応は[レビュー対応報告](docs/world-generation-review-fixes.md)に記録しています。

## Sample World（指示18）

- 山岳・雪山でOrbitカメラを地形へ近づけると、地形内部が見える場合があります。カメラの地形衝突回避は未実装です。
- Biomeの斜面色によりWorld Designの生成CPU負荷が増えています。Worker実行を維持し、[計測結果](docs/sample-worlds-report.md#性能)に前後比較を記録しています。
