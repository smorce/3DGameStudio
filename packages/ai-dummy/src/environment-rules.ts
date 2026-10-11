import { Vector3 } from "three";

/** GLBに保存する生成規則。配置Seedとは独立し、実行順序に依存しない。 */
export const environmentGeometryVersion = 4;
export interface TreeRules {
  kind: "oak" | "pine";
  seed: number;
  height: number;
  trunkRadius: number;
  bend: number;
  branches: number;
  branchAngle: number;
  crownRadius: number;
  crownDensity: number;
}
export interface HouseRules {
  seed: number;
  width: number;
  depth: number;
  floors: number;
  floorHeight: number;
  upperFloorOverhang: number;
  roofPitch: number;
  roofOverhang: number;
  windowLayout: "paired" | "regular";
  doorPlacement: "center" | "left" | "right";
  timberFrameStyle: "diagonal" | "cross";
  materialPalette: "warm" | "cool";
}
export function treeRules(kind: TreeRules["kind"], seed: number): TreeRules {
  return {
    kind,
    seed,
    height: kind === "pine" ? 10 : 7.7,
    trunkRadius: kind === "pine" ? 0.3 : 0.42,
    bend: 0.13,
    branches: kind === "pine" ? 28 : 8,
    branchAngle: kind === "pine" ? 0.12 : 0.65,
    crownRadius: kind === "pine" ? 3 : 3.6,
    crownDensity: kind === "pine" ? 18 : 44,
  };
}
export function houseRules(seed: number): HouseRules {
  return {
    seed,
    width: 6.8,
    depth: 5.7,
    floors: 2,
    floorHeight: 2.6,
    upperFloorOverhang: 0.28,
    roofPitch: 31 + ((seed % 3) - 1) * 2,
    roofOverhang: 0.5,
    windowLayout: seed % 2 ? "regular" : "paired",
    doorPlacement: ["center", "left", "right"][
      seed % 3
    ] as HouseRules["doorPlacement"],
    timberFrameStyle: seed % 2 ? "cross" : "diagonal",
    materialPalette: seed % 2 ? "cool" : "warm",
  };
}
/** 個体・枝・葉ごとに独立した乱数列を使う。LODで処理数が変わっても骨格を保つ。 */
export function ruleRandom(seed: number, index: number) {
  let state =
    (Math.imul(seed + 1, 2654435761) + Math.imul(index + 1, 2246822519)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function treeSkeleton(rules: TreeRules) {
  const pine = rules.kind === "pine";
  const branches = Array.from({ length: rules.branches }, (_, i) => {
    const random = ruleRandom(rules.seed, i);
    const angle = i * 2.399963 + (random() - 0.5) * 0.5;
    const y = pine
      ? 1.9 + (i / rules.branches) * (rules.height - 2.5)
      : rules.height * (0.37 + random() * 0.3);
    const length = pine
      ? rules.crownRadius * (1 - i / rules.branches)
      : rules.crownRadius * (0.48 + random() * 0.28);
    const start = new Vector3(
      (rules.bend * y) / rules.height,
      y,
      (rules.bend * 0.5 * y) / rules.height,
    );
    const end = start
      .clone()
      .add(
        new Vector3(
          Math.cos(angle) * length,
          length * rules.branchAngle,
          Math.sin(angle) * length,
        ),
      );
    return { start, end, angle, length };
  });
  const clusters = pine
    ? Array.from({ length: 7 }, (_, i) => ({
        center: new Vector3(0.05, rules.height * (0.27 + i * 0.099), 0.05),
        radius: new Vector3(
          rules.crownRadius * (1 - i / 8),
          rules.height * 0.105,
          rules.crownRadius * (1 - i / 8),
        ),
      }))
    : branches.map((b) => ({
        center: b.end.clone().add(new Vector3(0, rules.height * 0.058, 0)),
        radius: new Vector3(
          rules.crownRadius * 0.46,
          rules.height * 0.2,
          rules.crownRadius * 0.46,
        ),
      }));
  return { branches, clusters };
}
