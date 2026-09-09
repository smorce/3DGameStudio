# Course System

CourseはWorld上の経路、Start、Goal、順序付きCheckpoint、Obstacle、Respawn、metadataを保存します。道路は従来の幅4mの区間Mesh／Colliderへ変換します。地面のクリックや道路のドラッグはCommandとして履歴へ記録します。

## 走るコースの選択

`settings.activeCourseId`を保存し、LEVEL 2／Studioの「走るコース」で選択します。`course.activate` Commandを通すためUndo／Redoと保存・再読込に対応します。新しいコースの作成時はそのコースを選択します。nullはフリー走行です。LEVEL 1には選択UIを追加していません。

Engineの`play({courseId})`は明示指定を優先し、指定がなければsettingsを使います。両方が未指定の場合に限って最初のコースへフォールバックします。nullは明示的なコースなしとして扱い、存在しないIDはエラーにします。旧v1プロジェクトの読込時は最初のコースIDを設定します。

選択した一つだけに`CourseProgress`を作り、そのStartから走行します。順番にCheckpointを通り、最後にGoalへ到達すると完走します。Rや落下時の復帰にはそのコースの直前Checkpointを使用します。

EDITでは全コースを表示し、選択した道路を別色で示します。PLAYでは選択コースだけを描画・物理へ渡します。道路・障害物のColliderは空間チャンクで管理し、非選択コースの障害物は生成しません。編集道具も現在の選択コースへ適用します。

一本道、サーキット、オフロード、島一周、空中経路のテンプレートは維持しています。Loop／Tunnel専用形状は引き続き未実装です。

`world-streaming.test.ts`でBのStart／Checkpoint／GoalとAのCollider除外を検証し、`tests/e2e/world-runtime.spec.ts`ではBの選択・保存・Reload・実走完走まで確認します。
