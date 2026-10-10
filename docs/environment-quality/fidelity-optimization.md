# 環境描画の視覚品質改善と性能最適化

## 作業範囲

`指示21.md` に基づき、`feat/high-quality-environment-assets` から `feat/environment-fidelity-optimization` を作成した。山脈・地形高さ・道路制御点・World Schema・物理計算は変更対象にしない。既存の品質素材、16m草パッチ、Chunk単位のインスタンス、非同期LOD、Texture参照管理を利用する。

## 参考画像の分析

`森林の小道.png`、`木組みの家.png`、`村の広場.png` と、Phase4の3枚の比較画像を目視で分析した。ピクセル類似度は計算しない。

- 森林: 参考は道路外側に草の連続した覆いがあり、道路端で短くなる。現行は幅の細い株が離れ、地面の露出が大きい。現行の葉カードは大きな葉模様が目立ち、参考の細かく不規則な葉群とは異なる。遠方の樹冠は低ポリゴンの輪郭が残る。
- 住宅: 参考は石・木・屋根の材質に色と寸法の違いがあり、大きな木と草が住宅へつながる。現行は規則的な目地が強く、建物の周囲が開いている。
- 村: Phase4の村カメラは遠い俯瞰で、参考の目線構図と一致しない。既存の村の全景カメラと広場カメラの両方を改修前後で保存する。構図の変更を品質改善の数値として扱わない。

## Phase A: 森林

草の候補セルとSeedは維持する。道路の外側6m以内の候補を残し、森林内部は決定的に22%間引く。道路端2.5m以内は株を短くする。道路の中央、建物の境界、水面、急斜面、滑走路は既存の配置除外を利用する。

草の方法比較は、三角形予算と覆いの面積を分けて検討した。

| 方法 | 予算への影響 | 判断 |
| --- | --- | --- |
| 全株を2倍 | Instanceと草三角形が約2倍 | 不採用。遠景と森林全域にも負荷がかかる |
| 葉数を増やす | 1株の三角形が増える | 不採用 |
| 株を広げる | 頂点数を増やさず覆いが広がる | 道路外側へ重点採用 |
| 葉幅と向きの変化 | 頂点数の増加なし | 採用 |
| 地表の色むら・微細法線 | Draw Callsを追加しない。Fragment処理は増える | 既存Shaderを調整し、診断で比較 |

草は近景10葉31三角形から8葉25三角形へ減らす。中景は3葉10三角形を維持。幅と根元の広がりを変え、道路外側では横方向を1.55倍にする。16mパッチは維持し、視錐台外のパッチを除外する。草丈の投影サイズに対するLODと非表示しきい値を調整する。草の影描画は元から無効であり、その仕様を維持する。

広葉樹は近景572枚から468枚へカードを減らし、カード寸法を1.9×1.5mから1.55×1.25mへ小さくする。1カードの葉群は22枚の大きな模様から62枚の小さな模様へ変更する。これはTexture上の葉模様であり、Geometryのカード枚数ではない。MASKとMSAAのalpha-to-coverageを利用し、半透明のソート処理は追加しない。葉の裏側の過度な暗さを弱いemissiveで抑える。

地表は既存の絶対XZノイズと法線処理を調整して色むらと小石を表す。地形頂点の高さや物理的接地位置は変更しない。

## Phase B: 住宅と村

木目と漆喰の広い色むら、石と屋根のセル別色差を追加した。窓ガラスの不要な法線Textureを除き、平坦な法線と弱い色勾配を使う。住宅のGeometryは722三角形・5 Materialを維持し、Textureは14から13へ減った。扉・窓枠・木組みの既存形状を利用する。石の目地や屋根の配列自体は規則的なままであり、寸法の不規則化や新しい窓枠Geometryは追加していない。

代表住宅の横と代表広場に、既存素材の広葉樹を各1本、1.3倍で描画専用に配置した。道路から5m以上、既存建物の中心から9m以上離し、所有Chunkを固定する。物理Entity、WorldBuildManifest、衝突判定には追加しない。建物の草除外余白は0.7mから0.35mへ縮め、既存の低い草と長い草を壁際へ寄せる。建物足元の土・小石はShaderで表現する。木箱・樽・屋台は既存配置を利用し、追加の小物を大量配置しない。

広場の絶対XZ範囲はx=0〜42、z=-36〜-10。地表Shaderで石畳と不規則な境界を表し、草を内部から除く。大樹の足元に半径5.5mの草地を残す。地形高さと道路制御点は維持する。最初の住宅・村案では広場の草が小物を覆っていたため、その案を `phase-b-trial/` に残し、舗装範囲の草除外を採用した。

Alpine Villageの環境光を1.1から0.9へ下げ、太陽光2.8・時刻15.5・空色#86b4cc・霧0.00048を維持した。近景のShadow Mapは既存の2048px、カメラと対象の距離に応じた範囲、遠景は既存220m範囲を利用する。色空間・既存Shadow方式は維持し、全画面エフェクトは追加しない。建物の陰影は強まったが、参考画像の暖かい照明や素材の細密さには届いていない。

## Phase C: 統合と性能

草のMaterialと近景・中景GeometryをChunk間で参照共有し、最後の利用者の解放時に破棄する。二重解放は無効にする。v1とv2の品質素材Recipeは別の共有キーを使い、同じTexture種別を別版へ混ぜない。一般素材へ葉専用設定を適用しない。

樹木の45m・110mのLODと既存ヒステリシスを維持する。近景のカード寸法と枚数を調整し、松の中景を削減する。広葉樹の中景は空洞化を避けるため156枚から182枚へ増やしており、中景の全樹種が削減されたわけではない。遠景の広葉樹は同じ200三角形のまま樹冠の半径と高さを合わせる。品質樹木バッチの最近距離90mで影を止め、80mで戻す。バッチ単位の判定であるため、近い木が混在するChunkでは遠い木も影描画に残る。

草は16mパッチのまま投影サイズ12/14pxで詳細LOD、6.5/7.5pxで非表示へ切り替え、視錐台外を描画しない。Rebase後の世界行列を更新して同じ絶対位置のパッチを判定する。非同期LODの置換にも影設定を適用する。

## 測定方法

Chromium、ANGLE SwiftShader、同一Seed 42、1440×1000のViewport、Pixel Ratio 1、FOV 45°、同じカメラ座標と方向、同一の太陽時刻・品質設定で比較する。StudioからAlpine Villageを選び、既存のWorld Runtimeで描画する。カメラ設定は `tests/e2e/environment-quality.spec.ts` に固定する。

各視点で10秒の待機後、10秒の観測を3回連続して行う。engine.frameで重複を除き、nearest-rank法の中央値・p95・最小・最大を保存する。3回は同じロード中の連続観測であり、独立した3回のコールドロードではない。初期状態のスナップショットと安定観測を別に保存する。初期スナップショットは読み込み時間全体の分布ではない。

樹木、草、建物バッチ、地表詳細、影を一つずつ無効にし、10秒の観測を行う。建物診断は細部だけではなく建物バッチ全体を除外する。結果は相互作用があるため足し合わせない。診断はProjectに保存しない。地表詳細の診断は詳細色・法線の適用を除外するが、共通Shaderの一部計算は残る。

CPU描画時間はコマンド送信時間。RAF間隔はGPU・スケジューリング・その他の処理を含み、CPU描画時間と同一ではない。取得できないGPU時間はnullのまま扱う。JS HeapはGPUメモリではない。素材ごとのMaterial/Texture/Geometry予算はGLBの測定に保存する。World Generatorの100Chunkを3回測り、Rendererの草生成・GLBロード・GPUアップロードとは区別する。

実GPUの性能は未検証。SwiftShaderの結果をハードウェアのFPSとして扱わない。Draw Callsだけの減少を総合的な性能改善と断定しない。

## 証跡の再生成

本改修の環境比較テストは `test-results/` にのみ出力する。正式証跡へ移す処理は以下の明示コマンドに分離する。

```bash
FIDELITY_CAPTURE=1 QUALITY_PHASE=phase4 \
  PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright \
  pnpm exec playwright test --config playwright.environment.config.ts
# beforeは改修開始Commitの描画出力に対してのみ実行する。
pnpm exec tsx scripts/environment-fidelity-evidence.ts before
# Phase AはQUALITY_PHASE=phase1、Phase Bはphase3に加え住宅視点も使用する。
pnpm exec tsx scripts/environment-fidelity-evidence.ts phase-a
pnpm exec tsx scripts/environment-fidelity-assets.ts phase-a
# 最終の全視点観測結果をphase-cへ保存する。
pnpm exec tsx scripts/environment-fidelity-evidence.ts phase-c
pnpm exec tsx scripts/environment-fidelity-assets.ts phase-c
pnpm exec tsx scripts/environment-fidelity-alpha.ts
# 広場の実際の目線位置を別途確認し、正式比較を更新する。
FIDELITY_EYE_OUTPUT=test-results/fidelity-eye-after \
  PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright \
  pnpm exec playwright test --config playwright.environment-eye.config.ts
pnpm exec tsx scripts/environment-fidelity-evidence.ts eye-level test-results/fidelity-eye-after
pnpm exec tsx scripts/environment-fidelity-provenance.ts
# 葉MASKとMSAAを順番に比較する。全E2Eや目線計測とは同時に動かさない。
FIDELITY_ALPHA_CAPTURE=1 FIDELITY_EYE_OUTPUT=test-results/alpha-browser \
  PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright \
  pnpm exec playwright test --config playwright.environment-eye.config.ts
pnpm exec tsx scripts/environment-fidelity-alpha-browser-evidence.ts
```

改修前は今回の作業開始時点を使用する。以前のPhase4の短時間測定値は歴史的な基準として併記し、今回の同条件測定とは分ける。

## 検証と未達成事項

型チェック、Lintと循環依存確認、49ファイル388件のテスト（Unit 34ファイル300件、Integration 15ファイル88件）、Studio/Player/ServerのBuild、サンプル生成、9ワールドそれぞれ100Chunkの検証が成功した。E2Eの最終結果は下の検証記録へ記載する。本改修の環境比較テストは正式な画像を上書きしない。

追加テストは、葉Atlasの四象限分布・alpha被覆、v1/v2 Texture共有と最後の解放、草Geometry/Materialの共有と二重解放、草三角形予算、視錐台とRebase、景観樹木の所有Chunk・道路/建物除外、広場の草除外と樹木下の草を確認する。

既存8ワールドのJSONと参照するGLBは開始Commitとバイト単位で同じ（`legacy-world-regression.json`）。World Schema、道路、地形高、車・飛行機・ボートの物理、Part別VFX入力は変更していない。共有リソースや草カリングは共通Rendererに適用するが、品質Recipe、広場、追加樹木、環境光調整はAlpine Villageに限定する。

参考画像の制作環境・素材・照明が不明であり、完全一致には達していない。遠景の低ポリゴン樹木、カードや草の三角形輪郭、規則的な石壁と屋根、広場の配置・建物比率、LOD切替の見え方は改善余地がある。森林の歴史的197 Draw Calls目標は未達。実GPU計測、独立した複数コールドロード、長時間の実GPU安定性、動くカメラでの葉のちらつきの定量評価は未検証。

## カウンターの解釈と初回測定の修正

開始Commitは `44dff8baed69b8fadfb670ae424152e1281e2e62`。最初の森林観測ではChunkが増え続け、3窓のDraw Calls中央値が168/221/264となった。この結果は `before/` に初回観測として保存し、安定後の比較には使用しない。追加の住宅近接カメラでも最初のロードは198/276/313と変動したため、その結果は `before-extra/` に保存する。

`before-stable/` は、描画待ち・生成待ち・Worker実行数が0で、Chunk数・Draw Calls・Texture数が5回連続で変わらないことを確認してから測定する。森林は3窓とも290回、住宅近接は374回、角度制限で高くなった村カメラは384回だった。Phase4の歴史的な197/336/627回は、短時間・読み込み途中を含む別の観測である。

Three.jsの `WebGLRenderer.js` は `shadowMap.render()` の後で `info.reset()` を呼ぶ。現行のカウンターは主に色描画のDraw Calls/Trianglesであり、Shadow Passを含む全描画回数とは区別する。影診断はフレーム時間、CPU送信時間、取得可能なGPU時間で評価する。

草の方式比較表は、形状予算と覆いの設計比較であり、全方式を実ブラウザで個別に測定したベンチマークではない。採用した方式について同条件のブラウザ画像・診断・性能結果を保存する。

## 統合測定の結果

以下は各10秒窓の中央値を3窓で集約した値。分布全体のp95・最小・最大・サンプル数は [performance-comparison.json](fidelity-optimization/phase-c/performance-comparison.json) に保存する。列中の矢印は今回の安定した改修前→改修後を示す。カメラに角度制限が適用された従来視点も、両版で同じ実座標で比較する。

| 視点 | Draw Calls | Triangles | RAF ms | CPU送信 ms | GPU query ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 森林の小道 | 290 → 273 | 483,284 → 424,483 | 466.7 → 383.4 | 5.2 → 5.5 | 454.1 → 377.3 |
| 住宅近景 | 336 → 323 | 525,288 → 489,728 | 333.4 → 333.3 | 6.7 → 6.6 | 329.1 → 321.4 |
| 村全景 | 616 → 618 | 670,880 → 671,436 | 400.0 → 400.0 | 8.3 → 7.5 | 380.6 → 388.9 |
| 従来の広場 | 372 → 366 | 473,511 → 430,208 | 400.0 → 400.0 | 7.2 → 6.3 | 387.5 → 396.3 |
| 住宅の材質近接 | 374 → 322 | 490,155 → 413,366 | 350.0 → 316.7 | 7.2 → 6.3 | 338.3 → 312.5 |
| 角度補正前の追加広場 | 384 → 369 | 491,421 → 434,454 | 416.7 → 416.6 | 6.6 → 6.2 | 403.7 → 402.9 |
| 全景 | 675 → 678 | 673,590 → 674,390 | 416.6 → 400.0 | 8.4 → 6.7 | 398.7 → 397.0 |
| 真上 | 415 → 417 | 483,166 → 483,566 | 266.7 → 266.6 | 7.3 → 6.0 | 257.7 → 252.7 |

森林のDraw Callsは5.9%、三角形は12.2%減り、RAF中央値は466.7から383.4msへ下がった。住宅の材質近接はDraw Calls13.9%、三角形15.7%減り、RAFは350.0から316.7msへ下がった。従来の住宅近景は描画回数が減ったがRAFはほぼ同じ。村全景は2回・556三角形増え、RAF400msのまま、GPU queryは380.6から388.9msへ増えた。村全景に総合的な性能改善があったとは評価しない。

指示の歴史的な197/336/627回に対して、最終の従来3視点は273/323/618回。森林の197回目標は未達である。歴史的値とは読み込み状態・測定窓が異なるため、323や618がその値を下回ることだけで性能改善とは評価しない。

## 負荷の内訳

最終版で各要素を1つだけ除いた結果。各診断は10秒1窓であり、通常表示の3窓ほど再現性を評価していない。

| 視点・無効要素 | Draw Calls | RAF ms | GPU query ms |
| --- | ---: | ---: | ---: |
| 森林の小道・trees | 85 | 233.3 | 224.8 |
| 森林の小道・grass | 251 | 333.4 | 325.7 |
| 森林の小道・buildingDetails | 273 | 400.0 | 327.8 |
| 森林の小道・groundDetails | 273 | 350.0 | 346.6 |
| 森林の小道・shadows | 273 | 299.9 | 284.1 |
| 住宅近景・trees | 133 | 283.4 | 277.8 |
| 住宅近景・grass | 306 | 316.6 | 299.9 |
| 住宅近景・buildingDetails | 294 | 316.6 | 303.4 |
| 住宅近景・groundDetails | 323 | 333.4 | 329.4 |
| 住宅近景・shadows | 323 | 266.7 | 262.9 |
| 従来の広場・trees | 127 | 283.3 | 271.8 |
| 従来の広場・grass | 351 | 383.4 | 378.4 |
| 従来の広場・buildingDetails | 336 | 383.3 | 374.1 |
| 従来の広場・groundDetails | 366 | 400.0 | 393.8 |
| 従来の広場・shadows | 366 | 316.6 | 307.0 |

樹木を除くと森林273→85、住宅323→133、広場366→127回となり、枝葉バッチが主要なDraw Calls要因だった。影を除くと回数は変わらないが、RAFは森林約300、住宅約267、広場約317msへ下がる。影は色描画カウンターに表れない大きな費用であり、樹木の影距離制限を採用した。草除外は森林で22回、住宅17回、広場15回を削減する。地表詳細の効果はShader共通処理や測定変動を含み、診断値をそのまま個別の費用として合算できない。

## リソースと生成時間

| 視点 | WebGL Geometry数 | WebGL Texture数 | JS Heap MiB |
| --- | ---: | ---: | ---: |
| 森林の小道 | 144 → 134 | 6 → 6 | 202.0 → 188.9 |
| 住宅近景 | 166 → 148 | 20 → 19 | 173.8 → 184.2 |
| 村全景 | 225 → 205 | 17 → 17 | 188.5 → 190.9 |
| 従来の広場 | 226 → 208 | 20 → 19 | 176.6 → 180.1 |
| 住宅の材質近接 | 168 → 200 | 20 → 19 | 191.2 → 184.8 |
| 角度補正前の追加広場 | 192 → 212 | 20 → 19 | 179.1 → 199.4 |
| 全景 | 216 → 194 | 12 → 12 | 177.1 → 172.7 |
| 真上 | 222 → 200 | 12 → 12 | 174.4 → 172.6 |

JS HeapはGCやカメラ履歴によって変動し、全視点で低下していない。Material数はWebGLRenderer.infoが持たないため、観測APIでシーンに付いたMeshのMaterial・Geometry・Textureを数える。この値はLine/Sprite、ロードキャッシュ、GPUの実メモリを含まず、上表のWebGLカウンターとは一致しない。

最終の森林でMesh Material250、Geometry252、Texture18、草Instance120,814、草パッチ1,026、表示パッチ22。共有化前のPhase AはMaterial337、Geometry347、Texture19、草Instance121,168、パッチ1,026、表示22だった。同じカメラでも資産キャッシュの履歴が異なるため、この比較は資源集計の観測であり独立したメモリベンチマークではない。全景と真上では草の表示パッチ0となった。

| 資産LOD | 葉カード数 | 三角形数 | Material数 |
| --- | ---: | ---: | ---: |
| 広葉樹・近 | 572 → 468 | 2,008 → 1,800 | 2 → 2 |
| 広葉樹・中 | 156 → 182 | 1,176 → 1,228 | 2 → 2 |
| 広葉樹・遠 | 0 → 0 | 200 → 200 | 1 → 1 |
| 松・近 | 576 → 448 | 2,208 → 1,952 | 2 → 2 |
| 松・中 | 384 → 256 | 1,824 → 1,568 | 2 → 2 |
| 松・遠 | 0 → 0 | 180 → 180 | 1 → 1 |
| 住宅・近 | — | 722 → 722 | 5 → 5 |

100Chunkの純粋なWorld Generator処理を3回測定した。中央値は改修前8.025/7.979/7.838ms、改修後7.805/7.481/7.802ms。p95は前26.013/24.126/23.789ms、後23.842/23.416/23.266ms。描画専用の草生成、GLB読込、GPU転送、初回Streamingの総時間はこの値に含まれない。ブラウザのStreaming request/commit時間の分布は性能JSONへ保存する。

## 視覚評価と不採用案

[森林の比較](fidelity-optimization/phase-a/comparison.png)、[住宅の比較](fidelity-optimization/phase-b/house-comparison.png)、[広場の比較](fidelity-optimization/phase-b/village-comparison.png) は左から参考・改修前・改修後。森林は同じ既存樹木と道路を固定し、追加した広葉樹は住宅と広場の2本に限定する。

| 項目 | 改善した点 | 残る違い |
| --- | --- | --- |
| 森林の密度 | 道路外側の株幅と葉の向きで地面の覆いを増やした | 参考の細い草が連続する密度には届かず、三角形輪郭が残る |
| 樹冠の形状 | 小さい葉群、非平面カード、カード寸法のばらつき、Atlasの均等分布 | 幹と枝の構造は同じで、遠景の低ポリゴン輪郭とLOD差が残る |
| 葉の色と光 | 葉模様ごとの色差、弱い裏面emissive、環境光を減らした陰影 | 参考の光の透過や柔らかい葉影とは異なる |
| 地表 | 土の色むら、小石、微細法線、短い道路端の草 | 独立した立体小石や野草モデルは追加していない |
| 住宅の材質 | 木・石・漆喰・屋根の色差、平坦なガラス法線 | 規則的な目地・瓦配列や繰り返し、参考の細かな形状が残る |
| 建物と植生 | 大樹2本、壁際の草、足元の土、舗装と草の島 | 住宅の比率・広場の構成・背景山は参考と異なる |
| 距離別表示 | 同じLOD距離のまま遠景樹冠の外形を近景へ寄せる | クロスフェードを追加しておらず、切替を完全には消せていない |

小さな葉を少量だけ配置した最初の案はalpha被覆12.2%で樹冠が疎になったため不採用（`phase-a-trial/`）。採用Atlasは33.3%、改修前は22.6%。x/y分布の相関による斜めの偏りも修正した。初回の草拡張は幅の広い三角形が目立ったため不採用（`phase-a-density-trial/`）。葉幅を抑え、各葉を放射方向に対して横向きにした案を採用した。

alpha cutoff 0.4/0.5/0.6のCPU上の8bit 2×2 mip被覆率を [alpha-comparison.json](fidelity-optimization/phase-c/alpha-comparison.json) に記録した。実ブラウザはMSAA 4サンプルを確認し、採用版はMASK cutoff 0.5とalpha-to-coverageを使う。CPU比較は投影・実GPUフィルタ・MSAAを再現せず、閾値やAA方式ごとの実ブラウザ性能比較ではない。このCPU結果とは別に、下記の4条件を実ブラウザで比較した。動くカメラのちらつきの定量評価は未検証。

## 変更ファイルと影響

- `packages/ai-dummy/src/environment-materials.ts`、`environment-models.ts`: 材質Recipe v2と樹木形状。
- `packages/renderer-three/src/vegetation.ts`、`world-vegetation.ts`: 草Geometry共有、投影LOD、視錐台、道路外側と広場の配置。
- `packages/world-generator/src/vegetation.ts`: 任意の道路距離入力と決定的な草候補の間引き。地形生成と物理Entityは変更しない。
- `packages/renderer-three/src/instances.ts`: 版別Texture共有、葉MASK/AA、品質樹木の影距離。
- `packages/renderer-three/src/ground-detail.ts`、`alpine-surface.ts`、`environment-plaza.ts`: 地表の色・法線、代表広場の描画舗装。
- `packages/renderer-three/src/environment-accents.ts`、`index.ts`: 描画専用樹木、照明、診断とリソース集計、任意の正確な観測カメラ。
- `packages/engine-core/src/agent-observation.ts`: 既存観測APIへ診断、リソース数、任意のexactPoseを追加。Project Schemaは変更しない。
- `tests/unit/environment-quality.test.ts`、`tests/e2e/environment-quality.spec.ts`、`tests/environment-eye/{eye,alpha}.spec.ts`、`playwright.environment*.config.ts`: リソース・配置・実ブラウザの比較検証。
- `scripts/environment-fidelity-{evidence,assets,alpha,alpha-browser-evidence,provenance}.ts`: 合格済み出力の明示的保存、GLB予算・Chunk生成・alpha集計。
- `demos/worlds/alpine-village.json`、`demos/sample-worlds/library.json`、内容ハッシュGLB: 品質素材の再生成と参照更新。既存8ワールドの定義は変更しない。
- 本報告書と `docs/environment-quality/fidelity-optimization/`: 実行結果、参考・前・後・比較画像、初回と安定時の測定、不採用案の証跡。

## 目線カメラの補正

OrbitControlsはPlay中の最大極角を0.48πへ制限する。追加カメラでy=13を指定しても実際のyは16.704へ持ち上がり、目線条件を満たしていなかった。この旧観測を `village-eye` として残し、正式な広場比較は `village-eye-exact` へ置き換えた。

観測APIに任意の `{ exactPose: true }` を加え、その呼び出し時だけ最大極角をπにする。既存の呼び出しとPlay/編集切替は従来の制限を維持する。改修開始Commitの別Checkoutにもこの観測オプションだけを適用し、同じカメラ位置 `[39,13,-7]` と対象 `[37,14,-50]` をブラウザで数値検証した。地表高11.2882276866mに対して高さ1.7117723134mである。

旧角度補正ありの比較は `*-raised.png`、旧広場は `village-square-legacy.png` に残す。Phase Bの元の目線指定カメラは角度補正を受けていたため、正式な広場比較画像は最終統合版で撮り直した。Phase B時点の生データと元画像は保持し、`validation.json` の `screenshotSources` に各画像と性能記録の対応を明示する。正確な目線の生データは `before-eye/` と `eye-level/` に保存する。全景・住宅・森林の既存比較値は変更しない。追加近接視点は開始位置とカメラ移動履歴が既存全視点テストと異なるため、キャッシュとLODヒステリシスによる資産数差を完全に除いた比較ではない。

正確な目線でのDraw Callsは337→322、三角形457,897→402,057、RAF中央値399.9→383.3ms、CPU送信5.2→5.1ms、GPU query384.3→368.7msとなった。両版の実座標と地表高は `before-eye/validation.json` と `eye-level/validation.json` に保存する。これらの数値は専用の1視点テストから集計し、旧 `village-eye` の数値と混ぜない。

目線の改修前は、開始Commitの独立したCheckoutへ `exactPose` の観測APIと専用テストだけを適用し、port8792で測定した。生成済み資産・草・照明は開始Commitのままである。`before-eye` の正式保存には合格した `test-results/fidelity-eye-before` を指定する。通常版はport8793で動かし、2つのブラウザ計測を同時に実行しない。

森林・住宅・旧広場の画像とカメラ検証を別の旧画像に上書きして比較しない。目線補正前のカメラを削除せず、正確な目線の独立結果を追加する。正式画像は専用スクリプトの明示実行で更新し、本改修の環境比較E2Eは `test-results/` のみを更新する。

## 最終の検証記録

`pnpm test:e2e` は50件すべて成功（19.9分）。既存8ワールドとAlpine Villageの初期データからの起動、レース島の3CheckpointからGoal、飛行機の離陸、ボートの浮上・旋回、長距離飛行とRebase、物理Streaming、保存・再読込、Part別VFXを通過した。目線の専用実ブラウザ検証は開始版と最終版で各1件成功した。

目線カメラの問題を修正するため、最初の全E2E実行は10件成功時点で中断した（1件中断、39件未実行）。この実行を成功扱いにはせず、修正後に全50件を最初から再実行した。中断記録も `verification/e2e-interrupted.log` に残す。

コマンド結果は [validation-results.json](fidelity-optimization/validation-results.json)、実行ログは [verification/](fidelity-optimization/verification/)、変更ファイルの完全な一覧は [changed-files.json](fidelity-optimization/changed-files.json) に保存する。

## 葉MASKとMSAAの実ブラウザ比較

4条件すべて合格（5.5分）。GLBレスポンスの `leaf` / `needle` のMASK cutoffだけを測定用に差し替え、Projectと配布資産は変更しない。各条件は新しいページからワールドを読み込み、待ち数0と同じカウンター5回を確認して10秒1窓を測る。実カメラ座標と対象の一致も集計時に確認する。MSAA無効だけは起動前のWebGL context属性を変更し、Materialのalpha-to-coverageフラグは採用版のまま維持する。

[葉の縁の比較](fidelity-optimization/alpha-browser/leaf-edge-comparison.png) は左から0.4/MSAA4、0.5/MSAA4、0.6/MSAA4、0.5/MSAA無効。対応するフル画像・生データ・中央値/p95/最小/最大は [alpha-browser/](fidelity-optimization/alpha-browser/) に保存する。

| cutoff / MSAA | Draw Calls / Triangles | RAF 中央値 / p95 ms | GPU query 中央値 / p95 ms |
| --- | ---: | ---: | ---: |
| 0.4 / 4x | 273 / 424,483 | 383.3 / 400.0 | 367.4 / 389.9 |
| 0.5 / 4x | 273 / 424,483 | 366.5 / 400.0 | 351.5 / 384.2 |
| 0.6 / 4x | 273 / 424,483 | 383.3 / 416.6 | 367.1 / 417.9 |
| 0.5 / 無効 | 273 / 424,483 | 266.7 / 283.4 | 263.0 / 278.3 |

MSAA無効は速いが、採用素材の葉の縁に明るい線と強いギザギザが出たため採用しない。0.4〜0.6の静止差は小さく、1窓ずつの測定から0.5が性能上最適とは断定しない。従来のcutoff 0.5と既存MSAA 4サンプルを維持し、alpha-to-coverageを組み合わせる。MASK方式のままで、半透明ソートや新しい全画面AAは追加しない。MSAA無効の試験はシーン全体のサンプル数を変えるため、その時間差を葉だけの費用とは扱わない。

通常E2E50件に加え、最終版の専用ブラウザ検証は目線1件・葉比較4件が成功した。動くカメラのちらつき、別の実GPUやMSAAサンプル数での結果は未検証。

既存E2Eには `docs/screenshots/` と `docs/evidence/` へ直接出力するテストが残っている。今回の実行で更新された38件の追跡済みファイルと2件の新規出力は `test-results/full-e2e-legacy-artifacts/` へ退避し、過去の追跡証跡は開始Commitへ戻した。本改修の環境品質の正式証跡は明示コマンドで保存したものだけを差分に残す。
