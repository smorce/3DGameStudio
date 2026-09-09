# 素材の出典とライセンス

AssetRecord.sourceにprovider、sourceAssetId、sourceUrl、author、retrievedAtを保存します。licenseにはid、name、url、attributionRequired、attributionTextを保持します。不明な出典はunknownです。

同梱Rock 07の作者はJenelle van Heerden、提供元は[Poly Haven](https://polyhaven.com/a/rock_07)、ライセンスは[CC0](https://creativecommons.org/publicdomain/zero/1.0/)です。取得日時とファイル参照は `demos/external-asset-record.json` に保存しています。

[Poly Haven公式API](https://polyhaven.com/our-api)の条件に従い、UIにはPoly Havenの名前を表示し、ServerはMachineStudio固有User-Agentとキャッシュを使用します。このサービス利用条件と個々の素材のCC0は別に扱います。

ambientCGは[公式API](https://docs.ambientcg.com/api/v2/)を使用します。Kenneyはユーザーが公式Pack内のGLBを取り込み、出典が未確認の場合はunknownのまま保持します。同梱の簡易岩は本実装で生成したCC0プレースホルダーです。
