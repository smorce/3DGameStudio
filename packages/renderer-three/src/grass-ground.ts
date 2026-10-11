import * as THREE from "three";
import {
  vegetationCoverage,
  type vegetationPlacements,
} from "../../world-generator/src/vegetation";

type Options = Parameters<typeof vegetationPlacements>[0] & {
  originX: number;
  originZ: number;
};

/** 既存の除外条件を地表にも適用する。TextureはA1を使うChunkだけが所有する。 */
export function grassGround(
  material: THREE.MeshStandardMaterial,
  options: Options,
) {
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey.bind(material);
  const originalProgramKey = originalKey();
  const enabled = { value: 1 };
  let texture: THREE.DataTexture | undefined;
  let active = false;
  const sizeX = options.bounds.maxX - options.bounds.minX;
  const sizeZ = options.bounds.maxZ - options.bounds.minZ;
  return {
    setActive(next: boolean) {
      if (active === next) return;
      active = next;
      if (!next) {
        material.onBeforeCompile = originalCompile;
        material.customProgramCacheKey = () => originalProgramKey;
        material.needsUpdate = true;
        return;
      }
      if (!texture) {
        const started = performance.now();
        const resolution = 128;
        const data = new Uint8Array(resolution * resolution * 4);
        for (let z = 0; z < resolution; z++)
          for (let x = 0; x < resolution; x++) {
            const wx = options.bounds.minX + ((x + 0.5) / resolution) * sizeX;
            const wz = options.bounds.minZ + ((z + 0.5) / resolution) * sizeZ;
            const allowed =
              wx >= options.area.minX &&
              wx < options.area.maxX &&
              wz >= options.area.minZ &&
              wz < options.area.maxZ &&
              options.allowed(wx, wz);
            const offset = (z * resolution + x) * 4;
            const distance = options.roadDistance?.(wx, wz);
            data[offset] = allowed
              ? vegetationCoverage(
                  options.seed,
                  wx,
                  wz,
                  distance,
                  options.spacing,
                ) * 255
              : 0;
            data[offset + 3] = 255;
          }
        texture = new THREE.DataTexture(data, resolution, resolution);
        texture.minFilter = texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        material.userData.grassCoverageTexture = texture;
        material.userData.grassCoveragePreparationMs =
          performance.now() - started;
        material.userData.grassCoverageBytes = data.byteLength;
      }
      material.onBeforeCompile = (shader, renderer) => {
        originalCompile.call(material, shader, renderer);
        shader.uniforms.grassCoverage = { value: texture };
        shader.uniforms.grassCoverageEnabled =
          material.userData.groundDetailsUniform ?? enabled;
        shader.uniforms.grassGroundSize = {
          value: new THREE.Vector2(sizeX, sizeZ),
        };
        shader.uniforms.grassGroundOrigin = {
          value: new THREE.Vector2(
            options.originX % ((Math.PI * 2) / 0.73),
            options.originZ % ((Math.PI * 2) / 0.91),
          ),
        };
        shader.uniforms.grassGroundSeed = { value: (options.seed % 97) * 0.1 };
        shader.vertexShader =
          "varying vec2 grassGroundUV;\nuniform vec2 grassGroundSize;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\ngrassGroundUV = position.xz / grassGroundSize;",
          );
        shader.fragmentShader =
          "varying vec2 grassGroundUV;\nuniform sampler2D grassCoverage;\nuniform float grassCoverageEnabled;\nuniform vec2 grassGroundSize;\nuniform vec2 grassGroundOrigin;\nuniform float grassGroundSeed;\n" +
          shader.fragmentShader.replace(
            "#include <opaque_fragment>",
            `float grassCover = texture2D(grassCoverage, grassGroundUV).r * grassCoverageEnabled;
          vec2 grassAbsolute = grassGroundUV * grassGroundSize + grassGroundOrigin;
          float grassPattern = sin(grassAbsolute.x * 0.73 + grassGroundSeed) * sin(grassAbsolute.y * 0.91);
          outgoingLight *= mix(vec3(1.0), vec3(0.82, 1.04, 0.73) * (1.0 + grassPattern * 0.10), grassCover * 0.45);
          #include <opaque_fragment>`,
          );
      };
      material.customProgramCacheKey = () =>
        originalProgramKey + "-grass-coverage-v2";
      material.needsUpdate = true;
    },
    release() {
      texture?.dispose();
      delete material.userData.grassCoverageTexture;
      delete material.userData.grassCoveragePreparationMs;
      delete material.userData.grassCoverageBytes;
      texture = undefined;
    },
  };
}
