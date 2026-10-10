/** 中央の広場と道路へ伸びる通路。木陰と外周には草地を残す。 */
export function insideEnvironmentPlaza(x: number, z: number) {
  const edge = Math.max(
    1 - Math.hypot((x - 32) / 4.5, (z + 15) / 3.5),
    1 - Math.hypot((x - 20) / 15, (z + 23) / 10),
    Math.min(3 - Math.abs(z + 23), Math.min(x - 1, 41 - x)) / 3,
  );
  return edge > 0.07 && Math.hypot(x - 30, z + 25) > 5.5;
}

/** 草除外と同じ絶対座標の楕円・通路を使い、境界だけをノイズで崩す。 */
export const environmentPlazaShader = `
float plazaEdge = max(1.0 - length((p - vec2(20.0, -23.0)) / vec2(15.0, 10.0)),
  min(3.0 - abs(p.y + 23.0), min(p.x - 1.0, 41.0 - p.x)) / 3.0);
plazaEdge = max(plazaEdge, 1.0 - length((p - vec2(32.0, -15.0)) / vec2(4.5, 3.5)));
float environmentPlaza = smoothstep(0.0, 0.07, plazaEdge + environmentNoise(p * 2.0) * 0.025)
  * smoothstep(4.5, 5.5, length(p - vec2(30.0, -25.0)));
`;
