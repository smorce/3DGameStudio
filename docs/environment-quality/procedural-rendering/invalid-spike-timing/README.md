# 測定API修正前のデータ

画像は実ブラウザの出力だが、CPU描画時間とフレーム間隔は最新フレームではなく最後のSpikeの値を複製している。これらの中央値・p95を性能比較や採用判断に使用してはいけない。A1の最初のSwiftShader撮影は地表位相のUniform化前の試作である。llvmpipe-A0はソフトウェア描画でありRTX 4090の実測ではない。修正後の正式比較は親ディレクトリのA0/A1/A2とGPU-A0/GPU-A1/GPU-A2に保存する。

修正前の画像・JSON本体は通常測定出力として `test-results/procedural-invalid-spike-timing/` に保存した。正式な比較証跡には含めない。
