# Asset Pipeline

原本を保持し、Runtime版だけをゲーム実行向けに最適化します。Studio→Server→ProviderまたはBinary Upload→検証→Original保存→Collider Source生成→Runtime／LOD生成→サムネイル→AssetRecordという順序です。

## 保存ファイル

```text
assets/<id>/
  original.glb
  runtime.glb          # 既存参照との互換用、LOD0と同じ内容
  runtime-lod0.glb
  runtime-lod1.glb
  runtime-lod2.glb
  collider.json
  thumbnail.svg
```

簡略化が適さないモデルはLOD0のみ、または削減できた段階だけを保存します。GLBのOriginalは入力とバイト単位で一致します。glTF取込ではsource.gltfと関連ファイルも保存し、original.glbは最適化前のパッケージ版です。`generateRuntime(await runtimeIO().readBinary(original), profile)`で再生成できます。入力Documentは変更しません。

## Runtime最適化

`dedup`、`prune`、不足法線の補完、`weld`で同一頂点を再共有します。LOD0には形状簡略化を適用しません。Meshoptは可逆のバッファ圧縮を使い、Three.js GLTFLoaderへMeshoptDecoderを設定しています。LOD1／LOD2はglTF Transform＋MeshoptSimplifierで生成します。スキン、アニメーション、Morph、三角形以外のPrimitiveはLOD0へフォールバックします。

| Profile     | Runtime Texture上限 | WebP品質 | LOD1／LOD2の目標比率 |
| ----------- | ------------------- | -------- | -------------------- |
| quality     | 4096px              | 95       | 0.60／0.25           |
| balanced    | 2048px              | 85       | 0.45／0.12           |
| performance | 1024px              | 75       | 0.30／0.08           |

TextureはsharpでWebP化／縮小します。KTX2は導入していません。簡略化の許容誤差はLOD1が0.01、LOD2が0.05です。実際の削減率は形状によります。圧縮・Texture・LODの失敗は警告として記録し、読み込めるRuntimeを残します。自己生成の詳細モデルでバイト数・三角形数・デコードを確認しています。値は品質保証ではなく初期Profileです。

## Collider Pipeline

Scene内のNode変換を適用した頂点とIndexを`collider.json`へ保存します。通常の岩・小物はconvexHull、building／road／jump等のカテゴリはtrimesh、必要ならImport APIでbox／convexHull／trimeshを明示できます。

Rapier側は素材URLごとに一度だけ取得・解析し、Entityの位置・回転・拡大率を適用します。ダウンロード、解析、Hull構築失敗時はBounds由来Boxへ戻します。Geometry Sourceは静的World Entity向けです。動的MachineへTrimeshは追加していません。Collider読込は15秒のタイムアウト、64MiBのRuntime reader上限、各Geometry配列300万要素の検証を持ちます。これは取込Source／Aggregateの製品上限とは別の、Boxへ復帰するためのRuntimeデコード上限です。

## Uploadと安全上限

`POST /api/upload?name=...&provider=local&sourceUrl=...&license=unknown&profile=balanced`へ`Content-Type: model/gltf-binary`でGLB本体を送信します。`application/octet-stream`も受け付けます。Base64 JSONは使用しません。必要ならqueryに`collider=trimesh`等を指定します。`GET /api/asset-limits`で現在の設定を取得できます。

| 環境変数                    | 既定値  | 対象                                     |
| --------------------------- | ------- | ---------------------------------------- |
| ASSET_MAX_SOURCE_MB         | 128     | 一つのUpload／外部取得ファイル           |
| ASSET_MAX_AGGREGATE_MB      | 512     | 関連ファイル合計・宣言された展開後サイズ |
| ASSET_MAX_TEXTURE_DIMENSION | 8192    | 取込前Textureの辺長                      |
| ASSET_MAX_TRIANGLES         | 2000000 | Geometryの安全上限                       |
| ASSET_STORAGE_BUDGET_MB     | 4096    | Asset Storageのファイル合計              |

MB設定はMiB換算です。固定4MB／64MBという製品制限ではありません。MIME、GLBヘッダーとJSONチャンク、glTFバージョン、外部参照パス、許可されたProviderホスト、有限の属性値、Index範囲、Texture寸法、三角形数を検証します。宣言された展開後サイズもデコード前に制限します。GLBは自己完結したファイルを受け付けます。

Pipelineの同時変換を直列化し、ServerのImport／Upload受付にも同時実行制限を設けます。別の取込中は429を返します。失敗したImportの途中ファイルは回収します。Storageは既存容量、上書き差分、削除を計上して別途上限を守ります。

## 保存容量とRuntime予算

保存済みライブラリーの容量と現在ロード中の量を区別します。Rendererは実際のBatchが使う一意のRuntimeファイルbytes、Texture寸法からの概算GPUメモリ、描画三角形数、Draw CallsをProfileの予算と比較し、Statsに超過項目数を表示します。Runtime予算超過を理由にOriginalの取込を拒否しません。Profileごとの具体値は`asset-core/src/profiles.ts`に集約しています。

Poly HavenのglTF／GLB、ambientCG検索、Local／Kenneyの境界は維持します。ambientCG ZIP Material変換、Cloud Storage、実Blenderは対象外です。
