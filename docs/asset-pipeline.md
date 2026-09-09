# Asset Pipeline

Studio→server→AssetProvider→取得→検証→原本保存→dedup／prune／法線補完→実行GLB→寸法・Collider情報・サムネイル→LocalAssetStorageという経路です。GLBはJSONとは別ファイルです。

Poly HavenのglTFは公式応答が示した関連ファイルだけを取得してNodeIOへ渡します。絶対パス、親ディレクトリ、任意URLを含むglTF参照は拒否します。原本のsource.gltfと関連ファイルも保持します。モデルの境界と三角形数を記録し、投影図のSVGサムネイルを生成します。

GLBヘッダー、バイト数、glTFバージョン、Scene、頂点の有限性、Index範囲、三角形上限、テクスチャ寸法を検査します。見た目を変える圧縮・リサイズ・材質削減は自動適用しません。最適化したファイルは原本と別に保存します。

外部取得は最大64MB、テクスチャ8192px、100万三角形。アップロードは4MB。ZIPは展開しません。Serverは取得済みの同じProvider／Assetを再利用します。将来はAssetStorageをObject Storage実装へ差し替えられます。
