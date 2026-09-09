# 性能

StudioのRuntime StatsにFPS、Draw Calls、Triangles、Rigid Bodies、Colliders、Chunks、位置を表示します。Engine.statsにはJoints、Loaded Assets、Texture Memory Estimateもあります。テクスチャメモリは1枚あたり1MiBの粗い推定でGPU実測ではありません。

固定接続部品は複合剛体へまとめます。ThreeRendererはチャンクをロード／破棄し、カメラから離れた配置物の描画リソースを保持し続けません。Three.jsのFrustum Cullingを利用します。Editor変更時にはシーンを再構築する初期方式です。

RapierはPlay時に動的importするため初回表示でWASMを読み込みません。Studioの初期JSは約0.95MB（gzip約0.26MB）、物理チャンクは約2.24MB（gzip約0.83MB）。大きなRapierチャンクについてViteが警告します。WASMの別配信・更なる最適化は今後の課題です。

描画FPSは実測表示で、性能保証値ではありません。E2EはソフトウェアGPUのChromiumです。大規模世界・モバイル実機での性能検証、Instancing、LOD、物理Chunk Streamingは未完了です。

## 外部素材デモの測定

`scripts/performance-smoke.mjs`で、Rock 07を5個含むデモを本番ビルドから表示し、初期読込後に20サンプルを採取した。Chromium SwiftShader／1280×720で平均27.5FPS、最小20FPS。[生データ](evidence/performance.json)を保存している。実GPUの結果ではなく、大規模性能の合否判定には使わない。
