# World System

MachineとWorldは別データです。Worldは標高格子、各点の色、水面、木・岩・建物・Asset配置を持ちます。Raise／Lower／Flatten／Smooth／Paint／NoiseをCommand経由で編集できます。

`terrainChunks`は地形のセルをチャンクに分割します。`ChunkStreamer`はカメラ周辺の5×5範囲を管理し、離れた描画グループのGPUリソースを破棄します。再訪時にデータから再生成します。外部GLBの非同期完了時にも世代と親グループの存在を確認します。

`groupInstances`は同じチャンク・同じ素材をまとめる境界です。InstancedMesh、LOD、Origin Rebasingは未実装です。物理地形は初期ロード時に全体のTrimeshを作るため、非常に広い世界には追加のストリーミングが必要です。

水面は描画レイヤーとして分離し、water-systemに水没深度計算を用意しています。浮力は実行アダプターが部品metadataから適用します。
