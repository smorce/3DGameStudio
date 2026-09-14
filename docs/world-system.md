# World System

MachineとWorldは別の保存データです。Worldは標高格子、各点の色、水面、木・岩・建物・Asset配置を持ち、6種類の地形ブラシをCommand経由で編集します。

## 描画と物理のチャンク

`terrainChunks(project)`で既存の地形セルを分割し、描画と物理に同じ頂点・境界を使います。Terrain Colliderはチャンク単位Trimeshです。格子とチャンク幅が一致しない場合もセルを途中で切断せず、隣接セルの端点を一致させるため、今回はHeightfieldへ変換していません。

`ChunkStreamer<T>`は必要な範囲の決定と寿命管理を担当し、Three.js／Rapierに依存しません。ロード半径と保持半径のヒステリシスに加え、予算付き待ち行列（`maxCreatesPerUpdate` / `budgetMs`）と緊急半径（`urgentRadius`）で Frame Spike を抑えます。`create` が未準備（`undefined`）のときは予算を消費せず `pending` に残し、Ready 済みを優先します。進行方向の先読みはヒステリシス付きの進行線コリドーです。Physicsの既定値は`physicsStreaming`、描画は`renderStreaming`に集約しています。

Rapier AdapterはTerrain、World Entity、選択コースの道路・障害物を空間索引へ登録します。Procedural Terrain Colliderは `PreparedChunk` の local 頂点を Simulation 座標へ TypedArray 直焼きした Standalone Trimesh です（車両コントローラ互換のため translation 親付けは使いません）。チャンクをロードするとColliderを作り、最後の参照が外れると削除します。複数チャンクにまたがる物体は同じColliderを共有します。非常に大きな境界の物体は索引への大量複製を避け、ロード対象チャンクとの重なりを調べます。

PLAY中は先頭の操作対象Machineの剛体位置で、Vehicle更新とPhysics Stepの前に必要チャンクを用意します。リスポーン先も移動前にロードします。カメラ操作は物理チャンクを増やしません。描画側はカメラの注視点を基準とし、Play 中は Prefetch（`P3_RENDER_PREFETCH`）も要求します。

## Instance BatchとLOD

`groupInstances`がチャンクとassetId／内蔵種別でまとめ、Rendererの`WorldAssetBatch`が選択LODのglTF PrimitiveごとにInstancedMeshを構築します。Template内の階層変換とEntityの位置・回転・拡大率を合成します。木は幹と葉、岩は一つのPrimitiveを共有します。

Raycasterの`instanceId`をEntity IDの配列へ対応させて選択します。スキン、Morph、負の変換などInstancingが適さない形状には通常描画を使います。TemplateはURLごとの参照数で共有し、最後のBatchがなくなればGeometry／Material／Textureを解放します。チャンク破棄時はインスタンス用GPU領域も解放します。

LODはEntityごとのTHREE.LODではなく、バッチ中心とカメラの距離で切り替えます。距離閾値に10%のヒステリシスがあり、切替先がロードされるまで現在の形状を保持します。Origin Rebase時は `WorldAssetBatch.shiftOrigin` で中心も同じdeltaだけずらします。非同期ロードの世代を確認し、破棄後や古い要求の結果を再接続しません。

## 制約と検証

地形のProjectデータとCollider生成用索引はCPU側に保持します。配置済み外部素材のCollider SourceはPlay準備時に素材単位で取得します。GPUとRapier Colliderがチャンク単位の管理対象であり、すべてのCPUデータをディスクへ退避する方式ではありません。Origin RebaseはEngine TransactionでPhysics／Renderer／WorldRuntimeを同期します。

`tests/integration/world-streaming.test.ts`で遠距離往復、Collider上限、境界通過を検証します。Async Streaming 追従修正は[async-streaming-followup-report.md](async-streaming-followup-report.md)を参照してください。実測値は[evidence/physics-streaming.json](evidence/physics-streaming.json)、描画比較は[performance.md](performance.md)を参照してください。

水面と簡易浮力の責務は従来どおりwater-system／Physics Adapterにあります。
