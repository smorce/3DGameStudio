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

## 残る性能上の制約

InstancingのCullingとLODはチャンク内の素材Batch単位です。EntityごとのCullingより三角形数が増える画角があります。今回の主な効果はDraw Call削減と遠方Collider解放であり、すべてのGPU指標が改善したという結果ではありません。

Project格子、CPU索引、配置済み素材のCollider SourceはCPUメモリに保持します。スキン／Morph等は通常描画へ戻ります。実GPU、モバイル、長時間走行、大量の異なる素材、Origin Rebasingは今回の検証範囲外です。

`pnpm build && node scripts/world-benchmark.mjs after`で描画比較のAfterを再測定できます。元の5個の外部岩の参考測定は`evidence/performance.json`に履歴として残しています。
