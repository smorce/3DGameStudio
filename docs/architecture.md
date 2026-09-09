# アーキテクチャ

保存データは `packages/project-schema` のZodスキーマに従うJSONです。Three.jsのScene/Object3DやRapierのHandleは保存しません。UIとAIはCommandBusへコマンドを渡し、適用後の全モデルを検証します。

EngineはReactを参照せず、`new Engine(canvas)`、`await engine.load(project)`、`await engine.play()`、`engine.stop()`、`engine.dispose()`で使います。Machine Compileは固定接続グループをまとめ、可動関節を残します。ThreeRendererとRapierPhysicsが実行オブジェクトの生成・解放を担当します。

依存方向はUI→Command／Engine、Command→schema／各編集ロジック、Engine→描画／物理、各編集ロジック→schemaです。serverだけがNodeのファイルシステム・外部HTTP・GLB変換を参照します。各workspaceのpackage.jsonに依存を宣言しています。`pnpm cycles`で循環を検査します。

外部素材取得はserverの許可ホスト・容量制限を通し、Asset Pipelineが原本・実行GLB・サムネイル・寸法を保存します。Plugin SDKもexecuteだけを渡す境界です。
