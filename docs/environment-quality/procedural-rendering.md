# プロシージャル環境描画：指示24

## 作業状態

開始時HEADは `db876e8da7f260740da0e7be82760d445cb652f7`、作業ブランチは `feat/procedural-environment-rendering`。利用者の未追跡ファイル `指示24.md` を保持した。

Phase A〜Dの実装を追加した。**最終比較・長時間安定性・全E2Eの実行中であり、この時点では指示24の完了条件を満たしたとは扱わない。** 以下は実装の責務と検証方法を記録する。最終測定と採用判断は結果の取得後に更新する。

## Phase A：草と地表

A0（従来の8葉／3葉）、A1（地表マスク＋近景草）、A2（幅広葉＋頂点シェーダーの揺れ）を維持し、A3（地表マスク＋近傍だけのInstance buffer）を追加した。A0を標準に維持している。

A3は絶対座標の16mパッチを使い、カメラ周辺80m角と所有Chunkの交差領域だけを生成する。配置配列はInstance bufferへ転記した後に保持しない。カメラがパッチ境界を越えるとbufferを破棄して同じSeedから再配置する。A3を初期モードにしたChunkでは、全Chunk分の配置を先に作らない。近景表示の26m／30mヒステリシスはA1と共有する。草の物理Entityは追加していない。

マスクは128画素の内部領域に両側1画素の余白を加えた130×130 RGBA8。同じ絶対座標を隣接Chunkの余白で評価し、境界の線形補間を一致させる。地表模様は絶対原点を周期で縮めて渡し、Rebaseで位相を変えない。境界外の除外条件も、絶対座標を所有する地形セルと近隣9Chunkの建物輪郭から求める。マスク作成用の高さキャッシュは作成後に空にする。

A1／A3から解除するとTextureを直ちにdisposeし、元の地表シェーダーへ戻す。草ChunkのreleaseはInstance bufferも破棄する。GeometryとMaterialは参照数を減らし、最後のChunk解放時だけ破棄する。

## Phase B：樹木

`environment-rules.ts` に広葉樹・針葉樹の成長規則を定義した。Seed、幹の高さ・太さ・曲がり、主枝数、枝角度、樹冠幅、葉群密度を保存する。枝・葉群ごとに独立した乱数列を使い、LODの処理数やChunk読込順で後続の形状が変わらない。

近景は曲がった幹・主枝・小枝・葉カード、中景は小枝を省き葉を約40%に減らす。遠景は同じ葉群の包絡から作る簡略樹冠。葉群の包絡を共通化し、高さ・幅・中心を維持する。可視LODは既存の距離ヒステリシスとTemplate cacheを使う。葉は頂点シェーダーで最大約8cm揺らし、影側にも同じ変位を適用する。位相は配置回転とモデル座標から決め、Rebaseで変えない。

| 方式 | 実装 |
| --- | --- |
| B0 | 既存の近景影。balancedでは85mの個体距離制限とバッチのヒステリシスを維持 |
| B1 | 45m以内の詳細な影 |
| B2 | 簡略樹冠の影。品質設定の距離内で使用 |
| B3 | 35m以内は詳細モデル、35〜80mは保存済み葉群・幹の影モデル、80〜130mは保存済み簡略樹冠・幹 |

B3の専用モデルも同じ規則とSeedからGLBとして事前生成し、既存Pipelineで圧縮・保存する。Shadow Passでは個体のSimulation座標とカメラ座標から範囲を選ぶ。比較用の影素材は選択時に読み込み、解除・LOD交換・Chunk解放・非同期取消で参照を解放する。

幹Colliderは既存のconvexHull経路を維持する。樹冠にColliderを追加しない。既存のRapier統合テストで衝突、Rebase、解放、再読込を検証する。

## Phase C：住宅と材質

住宅の幅・奥行・階数・階高・上階張り出し・屋根勾配・軒幅・窓配置・扉位置・木組み・色調を規則として保存する。石の基礎、階ごとの壁、張り出し、柱梁、前後・側面の斜め補強、切妻、棟、軒、窓枠・窓台、扉、煙突を事前生成する。全LODに建物と屋根の外形を残し、中景は窓の桟を省き、遠景は窓枠・補強・柱の細部を省く。

既存の14棟の配置、Asset Slot、WorldのSeedは維持した。保存済みGLBをCatalogから読み込み、Runtimeで住宅Geometryを再生成しない。Colliderは既存Pipelineの形状から生成し、実車両が壁を通過しないことを統合テストで確認する。

| 方式 | 実装 |
| --- | --- |
| C0 | 既存の共有・埋め込みTexture |
| C1 | Seedから木の節・木目・建材の色むらを作り、PNGを保存して読み込む |
| C2 | 既存Materialのシェーダーで木目・組積目地の模様を解析的に計算 |

C1は選択時だけ画像を読み込み、GLBのTextureと同じpoolへ追加する。未完了の読込中にMaterialがdisposeされた場合は、完了したTextureを破棄してpoolへ登録しない。C0への復帰では元のmapへ戻す。読み込んだ共有画像はTemplateの寿命内で再利用し、最後のTemplate参照で破棄する。C2はUniformで切り替え、同じモードを毎フレーム再設定して再コンパイルを繰り返さない。

## Phase D：既存基盤への統合

Asset Factory → Asset Pipeline → Asset Catalog → WorldBuildManifest → World Runtime → Three.jsの経路を維持した。生成規則はGLBのextrasとCatalogの任意のgeneration欄に保存する。形状規則のバージョンは4、既存Textureレシピのバージョンは3。Seed・パラメータ・Material名・LODファイル・内容ハッシュを追跡する。

Factoryは生成版が古い素材を充足済みとして数えず、新版が準備できた後に古い生成素材をready候補から外す。旧Asset IDは削除せず、既存素材参照の形式を維持する。生成版をpromptHashに含め、Pipelineの内容ハッシュと併せて更新を識別する。新しい生成素材のmetadataHashにはRuntime情報も含め、LOD・影・画像の変更でBakeが古くなったことを検出する。再生成後にManifestを再Bakeする。

Chunk配置は既存Seed・絶対座標・半開区間の所有規則を使う。Rendererのバッチと草は既存の親Chunkに属し、Origin RebaseでInstance matrixを再生成しない。影用カメラもRebase時に同じdeltaだけ移動する。World切替・非同期取消は既存Template cacheの参照管理を使う。

新しい品質体系は設けず、既存の `settings.runtimeProfile` を使う。performanceは草の画面上の表示範囲を0.7倍、可視LOD距離を0.65倍、標準の樹木影を45mへ制限する。balancedは標準距離、qualityは草の範囲1.25倍、LOD距離1.35倍、標準の樹木影120m。遠景LODを廃止しない。診断APIで同じprofileと実験方式を切り替えられる。

## 検証と測定

基準コミットを別worktreeに保持し、同じ実Studio、Alpine Village／Seed 42、1440×1000、Canvas 1440×771、FOV 45°、Pixel Ratio 1で比較する。森林の小道は指定の位置 `[72,16,-137]`、注視点 `[122,16,-153]`。実際に補正されたカメラ位置は各サンプルに保存する。

`hybrid-environment.spec.ts` は6景観とA0〜A3／B0〜B3／C0〜C2を比較する。正式測定は `HYBRID_FULL=1` で10秒×3回。安定したChunk数・読込キュー・描画数を待ってから採取する。素材生成時間はNodeスクリプトでウォームアップ後3回、Geometry＋GLBとPipelineを分ける。World準備時間は読み込み開始から安定条件成立までの観測値で、待機ポーリングの時間を含む。

GPU総時間とShadow Passクエリは入れ子にできないため、Shadow Passは4フレームに1回、残りのフレームは総GPU時間を測る。CPU Shadow Passは命令投入時間。GPU結果は非同期に到着するため、採取フレームとの厳密な対応は保証しない。未対応値はnull。基準コミットのShadow Pass個別計測は未実装であり、総GPU時間だけを比較する。

通常のE2Eは正式なdocs証跡へ書き込まない。明示的な `UPDATE_E2E_EVIDENCE=1` の場合だけ正式保存先を使う。指示24の比較結果も、成功したテスト出力を明示操作で保存する。

## 実行中の確認

- Typecheck・Lint・循環依存検査は成功。
- Unit／Integrationは54ファイル・414件成功。
- `sample-worlds:prepare`／`sample-worlds:validate` は成功。既存8ワールドのJSONに差分なし。Alpine Villageの生成素材・Manifestを更新。
- 基準コミットのRTX 4090比較は6景観・10秒×3回で成功。ブラウザのrenderer文字列も確認する。
- 初回の短いブラウザ試行は、実行中の素材再生成で旧URLが404になり失敗した。正式結果として採用しない。
- 最終版の測定は影の個体距離判定を修正するため一度中断した。中断出力を正式結果として採用しない。

## 再実行

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm sample-worlds:prepare
pnpm sample-worlds:validate
PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright pnpm test:e2e

HYBRID_FULL=1 FIDELITY_EXISTING_BUILD=1 \
PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright \
pnpm exec playwright test --config=playwright.hybrid.config.ts

HYBRID_FULL=1 FIDELITY_EXISTING_BUILD=1 GEOMETRY_GPU_CAPTURE=1 \
GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA \
PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright \
pnpm exec playwright test --config=playwright.hybrid.config.ts

pnpm exec tsx scripts/hybrid-environment-generation.ts
```
