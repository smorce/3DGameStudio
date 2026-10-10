import * as THREE from "three";
import { alpineFields } from "../../world-generator/src/alpine-farmland";
import { groundDetailFunctions, groundDetailShader } from "./ground-detail";

/** 近景と遠景で同じ絶対座標の区画・畝を描き、粗い頂点色の反復を防ぐ。 */
export function alpineSurfaceMaterial(originX = 0, originZ = 0) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
  });
  material.onBeforeCompile = (shader) => {
    const detail = groundDetailShader(
      "alpineXZ",
      "road * (1.0 - smoothstep(60.0, 80.0, length(alpineXZ - vec2(0.0, -83.0))))",
    );
    shader.uniforms.alpineOffset = {
      value: new THREE.Vector2(originX, originZ),
    };
    shader.vertexShader =
      "varying vec2 alpineXZ;\nuniform vec2 alpineOffset;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nalpineXZ = position.xz + alpineOffset;",
      );
    const fields = alpineFields
      .map((field) => {
        const edges = field.points
          .map((a, i) => {
            const b = field.points[(i + 1) % field.points.length];
            return `if ((p.y > ${a[1].toFixed(1)}) != (p.y > ${b[1].toFixed(1)})) { if (p.x < (${b[0] - a[0]}.0) * (p.y - ${a[1].toFixed(1)}) / (${b[1] - a[1]}.0) + ${a[0].toFixed(1)}) inside = !inside; }`;
          })
          .join("\n");
        const color = new THREE.Color(
          field.crop === "wheat"
            ? "#c3ae68"
            : field.crop === "stubble"
              ? "#a48c59"
              : field.crop === "soil"
                ? "#785b3e"
                : "#93a15d",
        ).toArray();
        const xs = field.points.map((point) => point[0]),
          zs = field.points.map((point) => point[1]);
        return `if (p.x >= ${Math.min(...xs).toFixed(1)} && p.x <= ${Math.max(...xs).toFixed(1)} && p.y >= ${Math.min(...zs).toFixed(1)} && p.y <= ${Math.max(...zs).toFixed(1)}) { bool inside = false; ${edges}\n if (inside) { diffuseColor.rgb = vec3(${color.join(",")}); crop = ${field.crop === "grass" ? "0.0" : "1.0"}; } }`;
      })
      .join("\n");
    // 道路の既存頂点色（#a6a28e）を保持し、畑の色で舗装を塗り潰さない。
    shader.fragmentShader =
      "varying vec2 alpineXZ;\n" +
      groundDetailFunctions +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
      #include <color_fragment>
      vec2 p = alpineXZ;
      vec3 terrainColor = diffuseColor.rgb;
      float road = smoothstep(0.55, 0.67, vColor.b / max(vColor.r, 0.0001));
      float crop = 0.0;
      ${fields}
      diffuseColor.rgb = mix(diffuseColor.rgb, terrainColor, road);
      float broad = sin(p.x * 0.09 + sin(p.y * 0.05)) * sin(p.y * 0.07);
      float rowCoord = p.x + p.y * 0.18;
      float rows = sin(rowCoord * 7.0) * exp(-fwidth(rowCoord) * 2.0);
      diffuseColor.rgb *= 0.95 + broad * 0.045 + rows * crop * (1.0 - road) * 0.065;
      ${detail.color}
    `,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      "#include <normal_fragment_maps>\n" + detail.normal,
    );
  };
  material.customProgramCacheKey = () => "alpine-surface-v2";
  return material;
}
