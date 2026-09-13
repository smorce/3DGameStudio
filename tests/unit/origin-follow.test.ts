import { expect, it } from "vitest";
import { lerp, slerp } from "../../packages/machine-system/src/math";
import {
  interpolatePose,
  interpolatePhysicsRenderState,
} from "../../packages/renderer-three/src/interpolation";
import {
  cameraFollowAlpha,
  sunFollowPose,
} from "../../packages/renderer-three/src/follow";
import {
  WorldRuntime,
  createStarterWorld,
} from "../../packages/world-system/src/index";
import { shiftPhysicsRenderState } from "../../packages/engine-core/src/interpolation";

it("planRebaseはoriginを変えず、commitRebaseだけが反映する", () => {
  const runtime = new WorldRuntime(createStarterWorld({ preset: "airfield" }));
  const plan = runtime.planRebase([200, 2, 10]);
  expect(plan).toBeDefined();
  expect(runtime.worldOrigin).toEqual([0, 0, 0]);
  expect(runtime.rebaseCount).toBe(0);
  runtime.commitRebase(plan!);
  expect(runtime.worldOrigin[0]).toBe(plan!.delta[0]);
  expect(runtime.rebaseCount).toBe(1);
  expect(runtime.toGlobal(runtime.toSimulation([200, 2, 10]))[0]).toBeCloseTo(
    200,
  );
  expect(runtime.planRebase([200, 2, 10])).toBeUndefined();
});

it("finite worldではRebaseしない", () => {
  const world = createStarterWorld({ preset: "airfield" });
  world.source = { kind: "finite" };
  const runtime = new WorldRuntime(world);
  expect(runtime.planRebase([400, 0, 0])).toBeUndefined();
});

it("Camera Followはdt基準で30/60/120fpsでも同じ時定数になる", () => {
  const a30 = cameraFollowAlpha(1 / 30);
  const a60 = cameraFollowAlpha(1 / 60);
  const a120 = cameraFollowAlpha(1 / 120);
  expect(a30).toBeGreaterThan(a60);
  expect(a60).toBeGreaterThan(a120);
  expect(a60).toBeCloseTo(1 - Math.exp(-5 / 60), 5);
  const remain = (alpha: number, frames: number) => (1 - alpha) ** frames;
  expect(remain(a30, 30)).toBeCloseTo(remain(a60, 60), 2);
  expect(remain(a60, 60)).toBeCloseTo(remain(a120, 120), 2);
});

it("Shadow FollowはPlayer周辺に留まり原点固定ではない", () => {
  const origin = sunFollowPose([0, 2, 0], 14);
  const far = sunFollowPose([0, 2, 200], 14);
  expect(Math.hypot(origin.target[0], origin.target[2])).toBeLessThan(1);
  expect(far.target[2]).toBeCloseTo(200);
  expect(Math.hypot(far.position[0] - 0, far.position[2] - 200)).toBeLessThan(
    50,
  );
  const preRebase = sunFollowPose([90, 4, 10], 14);
  const postRebase = sunFollowPose([90 - 96, 4, 10], 14);
  expect(preRebase.target[0]).toBeCloseTo(90);
  expect(postRebase.target[0]).toBeCloseTo(-6);
});

it("Render Interpolationは位置をlerpし回転をslerpする", () => {
  expect(lerp([0, 0, 0], [10, 0, 0], 0.5)).toEqual([5, 0, 0]);
  const q = slerp([0, 0, 0, 1], [0, 1, 0, 0], 0);
  expect(q[3]).toBeCloseTo(1);
  const previous = {
    poses: new Map([
      [
        "a",
        {
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
        },
      ],
    ]),
    wheels: new Map(),
  };
  const current = {
    poses: new Map([
      [
        "a",
        {
          position: [10, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
        },
      ],
    ]),
    wheels: new Map(),
  };
  const mid = interpolatePhysicsRenderState(previous, current, 0.5);
  expect(mid.poses.get("a")?.position[0]).toBeCloseTo(5);
  const shifted = shiftPhysicsRenderState(current, [10, 0, 0]);
  expect(shifted.poses.get("a")?.position[0]).toBeCloseTo(0);
  const pose = interpolatePose(
    { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
    0.25,
  );
  expect(pose.position[0]).toBeCloseTo(0.5);
});
