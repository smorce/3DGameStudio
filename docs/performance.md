# 性能と実測

## 今回の比較条件

Chromium＋SwiftShader、1280×720、本番ビルド。1024m四方／129×129の地形、岩1,500個（近傍500個・遠方1,000個）、2コースを使います。フィクスチャは`tests/fixtures/benchmark-world.json`です。

Beforeは元コミット`bc77656`を別worktreeへ展開して同じ`world-benchmark.mjs`を実行しました。Afterは今回のコードです。起動後2秒、Play準備完了後2秒のStatsを採取します。描画回数はThree.jsの実測値です。物理チャンク数のBefore=0はStreaming機構が存在しないことを示し、Colliderがないという意味ではありません。

| 指標                  |        Before |  After | 解釈                                              |
| --------------------- | ------------: | -----: | ------------------------------------------------- |
| Draw Calls            |           219 |     32 | 約85.4%削減                                       |
| 描画Triangles         |        16,708 | 30,668 | バッチ単位のFrustum Cullingで増加                 |
| 描画Loaded Chunks     |            25 |     25 | 同じ近傍範囲                                      |
| Physics Chunks        | 0（一括生成） |     25 | 近傍だけを保持                                    |
| Colliders             |         1,503 |    526 | 遠方1,000個を除外、Terrain25＋Entity500＋Machine1 |
| 読込外部Runtime bytes |             0 |      0 | このWorldは内蔵岩のみ                             |

生データは[evidence/performance-before.json](evidence/performance-before.json)と[evidence/performance-after.json](evidence/performance-after.json)です。境界で微小な物理移動が起きると保持チャンクが増える場合があります。FPSは参考表示で、短い単一シナリオのソフトウェアGPU測定から実機性能を保証することはできません。

## 同じ外部GLBの最適化比較

64×32分割の詳細球体をglTFとして生成した同一Sourceを、元コードと今回のPipelineで処理しました。Originalは117,140 bytes、3,968 trianglesです。

| 指標                  |  Before |         After |
| --------------------- | ------: | ------------: |
| Runtime LOD0 bytes    | 286,324 |        38,896 |
| LOD0 triangles        |   3,968 |         3,968 |
| LOD1 bytes／triangles |    なし | 19,112／1,785 |
| LOD2 bytes／triangles |    なし |    8,164／475 |

旧Pipelineは法線処理で頂点を展開していました。今回の前処理は同一頂点を再共有し、Meshoptの可逆バッファ圧縮を加えます。LOD0の三角形数は保持し、LOD2では約88%削減しています。値は素材ごとに異なります。

[evidence/runtime-before.json](evidence/runtime-before.json)、[evidence/runtime-optimization.json](evidence/runtime-optimization.json)に実測を保存します。生成した各LODはThree.js GLTFLoader＋MeshoptDecoderでデコードし、三角形数を検証しています。WebP素材は本番ブラウザーで表示しています。

## 移動時の物理上限

別の1024m World（Terrain1,024チャンク、Entity900個）で、Machineをx=320→-320→0→320→-320へ移動します。各地点でTerrain25＋Entity36＋Machine1＝62 Colliderを保持し、遠方は残りません。生データは[evidence/physics-streaming.json](evidence/physics-streaming.json)。同じテストで総Collider150未満、保持チャンク49以下、World Entity Collider位置を検証します。

境界テストは車体をx=30から32の境界を越えて移動し、毎Physics Stepで地面を抜けていないことを検査します。カメラ位置は物理更新APIに渡していません。

## Runtime Statsと予算

StatsにはFPS、Draw Calls、Triangles、Loaded Chunks、Physics Chunks、Collider数、Runtime bytes、Texture Memory Estimate、LOD別Batch数を表示します。Engine APIではTerrain／World Entity Collider数とInstance Batch数も取得できます。

Textureメモリは共有Textureを一度だけ数え、画像寸法×RGBA8×Mip係数で見積もります。圧縮GLBのbytesとは区別し、GPU実測値ではありません。quality／balanced／performanceの予算は`asset-core/src/profiles.ts`で設定します。超過時はStatsに項目数を表示し、保存ライブラリーの容量だけを理由にRuntime予算を超過扱いにしません。

## PLAY 描画準備（preparePlayRendering）

PLAY 開始直後の単発 Frame Spike（約20–30ms）の主因は、特定 Part ではなく **PLAY 用 Scene の最初の本格的な WebGL 描画に伴う GPU/Driver 側の準備コスト**です。Shader Compile 単体でも Buffer 転送単体でもなく、初回描画にまとまって現れます。

対策として `ThreeRenderer.preparePlayRendering()` を PLAY 開始処理の標準動作にしています。

順序の要点:

1. Physics / Renderer の PLAY 状態を構築する
2. 遅延表示物（Thruster 炎・Motor indicator など）を一時的に描画対象へ含める
3. `compileAsync` と 1 回の実描画で GPU 側を温める
4. Profiler / GPU Timer をリセットし、Camera snap のあと Physics を開始する

これにより約27ms級のコストは Gameplay の最初の RAF から消え、PLAY ボタン後の準備フェーズへ移ります。無効化して回帰比較するときだけ `?disablePlayRenderPrewarm=1` を使います。多回 A/B は [evidence/play-render-prewarm-bench.json](evidence/play-render-prewarm-bench.json) を参照してください。

### 今後の注意（動的追加 Material）

`WebGLRenderer.compileAsync(scene, camera)` は **呼び出した時点で Scene に含まれる Material** だけを事前コンパイルします。したがって次のようなケースでは、PLAY 開始時の `preparePlayRendering()` だけでは足りません。

- PLAY 中に GLTF / GLB を後からロードして Scene へ追加する
- 新しい Material・透明 Material・特殊 Shader を実行時に生成して初めて描画する
- LOD 切替や Streaming Commit で、準備時点に存在しなかった Geometry / Material が初めて描かれる

これらは **追加したタイミングで別途温める**必要があります。例:

1. 新規 Object を Scene に載せ、初回表示前に必要な Mesh を一時的に描画対象へ含める
2. `await renderer.compileAsync(scene, camera)`（または追加分だけを対象にした compile）
3. 必要なら 1 回描画して Buffer 等も温める
4. 見た目の visible 状態を戻してから通常の Gameplay 描画へ戻す

温めていないまま初めて描くと、PLAY 開始時と同じ種類の単発 Stall が再発し得ます。

## 残る性能上の制約

InstancingのCullingとLODはチャンク内の素材Batch単位です。EntityごとのCullingより三角形数が増える画角があります。今回の主な効果はDraw Call削減と遠方Collider解放であり、すべてのGPU指標が改善したという結果ではありません。

Project格子、CPU索引、配置済み素材のCollider SourceはCPUメモリに保持します。スキン／Morph等は通常描画へ戻ります。実GPU、モバイル、長時間走行、大量の異なる素材、Origin Rebasingは今回の検証範囲外です。動的に追加する Material / GLTF の初回描画コストは上記「PLAY 描画準備」節を参照してください。

`pnpm build && node scripts/world-benchmark.mjs after`で描画比較のAfterを再測定できます。元の5個の外部岩の参考測定は`evidence/performance.json`に履歴として残しています。
