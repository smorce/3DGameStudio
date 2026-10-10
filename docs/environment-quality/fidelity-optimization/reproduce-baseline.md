# 改修前の正確な目線を再現する

開始Commitは `44dff8baed69b8fadfb670ae424152e1281e2e62`。`baseline-observation.patch` は観測APIとカメラの任意の `exactPose` だけを変更する。素材・草・地表・照明・ワールドを改修後へ差し替えない。

1. 開始Commitを別のCheckoutへ取得する。
2. `git apply <正式証跡の絶対パス>/baseline-observation.patch` を実行する。
3. 最終版の `playwright.environment-eye.config.ts`、`tests/environment-eye/eye.spec.ts` と既存のE2E fixturesを同じパスへ置く。
4. 同じlockfileに基づく依存関係を使用する。今回の測定は既存ワークスペースのnode_modulesをsymlinkし、インストールは行っていない。
5. 改修後や全E2Eのブラウザを止めてから次を実行する。

```bash
FIDELITY_EYE_PORT=8792 \
FIDELITY_EYE_OUTPUT=<最終版ワークスペースの絶対パス>/test-results/fidelity-eye-before \
PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright \
pnpm exec playwright test --config playwright.environment-eye.config.ts
```

合格した出力を、最終版ワークスペースから明示的に保存する。

```bash
pnpm exec tsx scripts/environment-fidelity-evidence.ts before-eye test-results/fidelity-eye-before
```

`before-eye/validation.json` の実座標、対象、地表高を改修後の `eye-level/validation.json` と照合する。このテストは今回の広場の正確な目線を確認し、全視点の比較や複数コールドロードの分布を置き換えるものではない。
