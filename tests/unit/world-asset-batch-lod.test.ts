import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AssetTemplates,
  WorldAssetBatch,
} from "../../packages/renderer-three/src/instances";
import type { Vec3 } from "../../packages/project-schema/src/index";

describe("WorldAssetBatch LOD center", () => {
  it("Origin Rebase 前後でカメラとの LOD 距離が不変", () => {
    const cache = new AssetTemplates();
    const batch = new WorldAssetBatch(
      [
        {
          id: "asset-1",
          name: "配置物",
          kind: "asset",
          transform: {
            position: [80, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        },
      ],
      undefined,
      cache,
      { lodCenter: [80, 0, 0] },
    );
    const cameraSim = new THREE.Vector3(100, 0, 0);
    const before = cameraSim.distanceTo(new THREE.Vector3(...batch.lodCenter));
    expect(before).toBeCloseTo(20, 5);

    const delta: Vec3 = [96, 0, 0];
    // カメラは Renderer.shiftOrigin と同じく delta だけ引く。
    cameraSim.sub(new THREE.Vector3(...delta));
    batch.shiftOrigin(delta);

    const after = cameraSim.distanceTo(new THREE.Vector3(...batch.lodCenter));
    expect(after).toBeCloseTo(before, 5);
    expect(batch.lodCenter[0]).toBeCloseTo(-16, 5);
    batch.dispose();
  });

  it("shiftOrigin しないと Rebase 後に LOD 距離が膨らむ", () => {
    const cache = new AssetTemplates();
    const batch = new WorldAssetBatch(
      [
        {
          id: "asset-2",
          name: "配置物",
          kind: "asset",
          transform: {
            position: [80, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        },
      ],
      undefined,
      cache,
      { lodCenter: [80, 0, 0] },
    );
    const cameraSim = new THREE.Vector3(100, 0, 0);
    const before = cameraSim.distanceTo(new THREE.Vector3(...batch.lodCenter));
    cameraSim.sub(new THREE.Vector3(96, 0, 0));
    const afterWithoutShift = cameraSim.distanceTo(
      new THREE.Vector3(...batch.lodCenter),
    );
    expect(afterWithoutShift).toBeGreaterThan(before + 50);
    batch.dispose();
  });
});
