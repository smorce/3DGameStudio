import type * as THREE from "three";
/** 位相は配置回転とモデル座標から決まり、Origin Rebaseでは変化しない。 */
export function foliageWind(
  shader: Parameters<THREE.Material["onBeforeCompile"]>[0],
) {
  shader.uniforms.environmentWindTime = {
    get value() {
      return performance.now() / 1000;
    },
  };
  shader.vertexShader =
    "uniform float environmentWindTime;\n" +
    shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
  #ifdef USE_INSTANCING
    float windPhase = atan(instanceMatrix[0].z, instanceMatrix[0].x) + position.x * 0.31 + position.z * 0.23;
    transformed.x += sin(environmentWindTime * 1.4 + windPhase) * clamp(position.y * 0.1, 0.0, 1.0) * 0.08;
  #endif`,
    );
}
