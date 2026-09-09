# Command System

`CommandBus.execute(command)`が単一編集、`batch(commands)`が原子的な複数編集です。draftに適用して検証してからstateを置き換えます。失敗した途中状態は公開しません。AIプランの複数編集も一回のUndoで戻ります。

project.create、machine.create/delete、part.add/remove/move/rotate/update/connect/disconnect、part.connection.update、world.create/update、terrain各ブラシ、asset.import/place/update/remove、course各操作、mission.createを用意しています。コマンドはJSONとしてシリアライズ可能です。

履歴はbefore／afterスナップショット方式で最大100操作です。Undo後に新しく編集するとRedo枝を破棄します。購読通知でReactがモデルコピーを再取得します。外部へ可変stateを返しません。接続先の親Transformを変更した場合は子の配置を追従させます。

`load`は検証済みファイルの読み込み境界で、履歴をリセットします。新規制作操作はproject.createコマンドです。履歴の永続化・共同編集競合解決は未実装です。
