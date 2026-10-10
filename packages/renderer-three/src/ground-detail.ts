/** 絶対XZを渡す地表シェーダーの共通部。色変換は既存Three.jsに任せる。 */
export const groundDetailFunctions = `
float environmentHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float environmentNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(environmentHash(i), environmentHash(i + vec2(1,0)), f.x),
    mix(environmentHash(i + vec2(0,1)), environmentHash(i + vec2(1,1)), f.x), f.y);
}
float environmentCobble(vec2 p) {
  vec2 q = p * vec2(2.4, 3.2);
  q.x += mod(floor(q.y), 2.0) * 0.5;
  vec2 f = fract(q), edge = min(f, 1.0 - f);
  return smoothstep(0.035, 0.11, min(edge.x, edge.y));
}
`;
const groundDetailColor = `
float groundGrain = environmentNoise(environmentXZ * 12.0);
float groundPatch = environmentNoise(environmentXZ * 0.7);
float detailFade = 1.0 - smoothstep(0.04, 0.25, length(fwidth(environmentXZ)));
diffuseColor.rgb *= 1.0 + (groundGrain - 0.5) * 0.13 * detailFade + (groundPatch - 0.5) * 0.07;
float environmentPaving = PAVING_MASK;
float cobble = environmentCobble(environmentXZ);
diffuseColor.rgb *= 1.0 - environmentPaving * (1.0 - cobble) * 0.32 * detailFade;
`;
const groundDetailNormal = `
float microHeight = environmentNoise(environmentXZ * 12.0) * 0.006 + environmentPaving * cobble * 0.018;
float normalFade = 1.0 - smoothstep(0.04, 0.25, length(fwidth(environmentXZ)));
vec3 groundDx = dFdx(-vViewPosition), groundDy = dFdy(-vViewPosition);
vec3 groundR1 = cross(groundDy, normal), groundR2 = cross(normal, groundDx);
float groundDet = dot(groundDx, groundR1);
normal = normalize(abs(groundDet) * normal - sign(groundDet) * normalFade *
  (dFdx(microHeight) * groundR1 + dFdy(microHeight) * groundR2));
`;
/** 呼び出し側が座標varyingと舗装マスクを指定し、特定Worldへの依存を持たない。 */
export function groundDetailShader(coordinates: string, pavingMask = "0.0") {
  return {
    color: groundDetailColor
      .replaceAll("environmentXZ", coordinates)
      .replace("PAVING_MASK", pavingMask),
    normal: groundDetailNormal.replaceAll("environmentXZ", coordinates),
  };
}
