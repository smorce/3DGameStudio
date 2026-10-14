import { expect, it, vi } from "vitest";
import { Engine } from "../../packages/engine-core/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";

it("停止時は地形を再読込せず、その場で編集状態へ戻す", async () => {
  const project = emptyProject();
  const restoreEditTransforms = vi.fn();
  const reload = vi.fn();
  const load = vi.fn();
  const dispose = vi.fn();
  const engine = Object.assign(Object.create(Engine.prototype), {
    mode: "PLAY",
    blur: vi.fn(),
    ticket: 0,
    project,
    keys: new Set(["KeyW"]),
    input: { throttle: 1, steering: 1 },
    accumulator: 0.01,
    previousRenderState: {},
    currentRenderState: {},
    physics: { dispose },
    renderer: { restoreEditTransforms, load },
    worldRuntime: { setPlayHotPath: vi.fn(), reload },
  }) as Engine;

  const stopped = engine.stop();
  // 次の描画フレームを待たずに背景・姿勢・カメラの復帰を完了する。
  expect(engine.mode).toBe("EDIT");
  expect(restoreEditTransforms).toHaveBeenCalledExactlyOnceWith(project);
  expect(dispose).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  await stopped;
  await engine.stop();
  expect(restoreEditTransforms).toHaveBeenCalledOnce();
});
