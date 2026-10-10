/** 代表広場の描画用舗装。地形高さ・道路・物理素材は変更しない。 */
export function insideEnvironmentPlaza(x: number, z: number) {
  return (
    x > 0.5 &&
    x < 41.5 &&
    z > -35.5 &&
    z < -10.5 &&
    Math.hypot(x - 30, z + 25) > 5.5
  );
}

/** 草の除外と同じ絶対座標を使い、樹木の足元には草の島を残す。 */
export const environmentPlazaShader = `
float plazaEdge = min(min(p.x, 42.0 - p.x), min(p.y + 36.0, -10.0 - p.y));
float environmentPlaza = 0.0;
if (plazaEdge > -1.0) {
  environmentPlaza = smoothstep(0.0, 1.0, plazaEdge + environmentNoise(p * 2.0) * 0.4)
    * smoothstep(4.5, 5.5, length(p - vec2(30.0, -25.0)));
}
`;
