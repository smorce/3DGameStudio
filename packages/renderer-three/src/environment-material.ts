import * as THREE from "three";
export type BuildingMaterialMode = "C0" | "C1" | "C2";
/** 基準Texture・保存済みTexture・解析的模様を同じ形状上で比較する。 */
export function configureBuildingMaterial(
  material: THREE.MeshStandardMaterial,
  generated: THREE.Texture | (() => Promise<THREE.Texture>),
  onReady?: () => void,
) {
  const original = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  const enabled = { value: 0 };
  material.userData.baselineMap = material.map;
  if (generated instanceof THREE.Texture)
    material.userData.generatedMap = generated;
  let disposed = false,
    pending: Promise<void> | undefined;
  material.addEventListener("dispose", () => {
    disposed = true;
  });
  const palette = material.color.clone();
  const colors: Record<string, string> = {
    wood: "#826341",
    stone: "#a6a28f",
    roof: "#904e35",
    plaster: "#dad1b8",
    glass: "#476973",
  };
  const base = new THREE.Color(colors[material.name] ?? "#ffffff").multiply(
    palette,
  );
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    shader.uniforms.environmentSurfaceMode = enabled;
    shader.uniforms.environmentSurfaceColor = { value: base };
    shader.uniforms.environmentSurfaceKind = {
      value: ["wood", "stone", "roof"].indexOf(material.name),
    };
    shader.fragmentShader =
      "uniform float environmentSurfaceMode;\nuniform vec3 environmentSurfaceColor;\nuniform float environmentSurfaceKind;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
    #ifdef USE_MAP
      if (environmentSurfaceMode > 0.5) {
        vec2 p = vMapUv;
        float grain = sin(p.x * 100.0 + sin(p.y * 12.56637) * 2.0);
        float rows = environmentSurfaceKind > 1.5 ? 8.0 : 4.0;
        float row = floor(p.y * rows);
        vec2 cell = fract(vec2(p.x * 4.0 + mod(row, 2.0) * 0.5, p.y * rows));
        float mortar = step(0.045, cell.x) * step(0.06, cell.y);
        float pattern = environmentSurfaceKind < -0.5 ? 1.0 : environmentSurfaceKind < 0.5 ? 0.94 + grain * 0.12 : 0.73 + mortar * 0.27;
        diffuseColor.rgb = environmentSurfaceColor * pattern;
      }
    #endif`,
      );
  };
  material.customProgramCacheKey = () => key + "-environment-surface-v1";
  material.userData.setBuildingMaterialMode = (mode: BuildingMaterialMode) => {
    if (material.userData.buildingMaterialMode === mode) return;
    if (
      mode === "C1" &&
      !material.userData.generatedMap &&
      typeof generated === "function" &&
      !pending
    ) {
      pending = generated()
        .then((texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }
          material.userData.generatedMap = texture;
          onReady?.();
          if (material.userData.buildingMaterialMode === "C1") {
            material.map = material.userData.generatedMap;
            material.needsUpdate = true;
          }
        })
        .catch((error) => {
          if (!disposed)
            console.error("Building material download failed", error);
        });
    }
    material.userData.buildingMaterialMode = mode;
    enabled.value = mode === "C2" ? 1 : 0;
    material.map =
      mode === "C1"
        ? (material.userData.generatedMap ?? material.userData.baselineMap)
        : material.userData.baselineMap;
    material.color.copy(palette);
    material.needsUpdate = true;
  };
}
