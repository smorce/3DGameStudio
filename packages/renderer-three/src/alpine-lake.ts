import * as THREE from "three";
import { alpineLake } from "../../world-generator/src/alpine-landscape";
import { alpineSkyColors } from "./alpine-atmosphere";

/** 湖面は1枚の円盤。波は絶対座標の解析式、反射は空の配色だけを使いRender Targetを持たない。 */
export function alpineLakeSurface() {
  const radius = alpineLake.radius * 1.3 * 1.12;
  const geometry = new THREE.CircleGeometry(radius, 72);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        lakeTime: { value: 0 },
        lakeCenter: {
          value: new THREE.Vector2(alpineLake.center[0], alpineLake.center[1]),
        },
        lakeRadius: { value: alpineLake.radius },
        sunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
        deepColor: { value: new THREE.Color("#1d4f73") },
        shallowColor: { value: new THREE.Color("#4f8a83") },
        skyHorizon: { value: new THREE.Color(alpineSkyColors.horizon) },
        skyZenith: { value: new THREE.Color(alpineSkyColors.zenith) },
      },
    ]),
    vertexShader: `
      uniform vec2 lakeCenter;
      varying vec2 lakeXZ;
      varying vec3 lakeWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        lakeWorld = world.xyz;
        lakeXZ = position.xz + lakeCenter;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float lakeTime;
      uniform vec2 lakeCenter;
      uniform float lakeRadius;
      uniform vec3 sunDirection;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      uniform vec3 skyHorizon;
      uniform vec3 skyZenith;
      varying vec2 lakeXZ;
      varying vec3 lakeWorld;
      #include <fog_pars_fragment>
      vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
        return dir * cos(dot(p, dir) * freq + lakeTime * speed) * freq * amp;
      }
      void main() {
        vec2 p = lakeXZ;
        vec2 g = wave(p, vec2(0.83, 0.55), 0.55, 1.2, 0.05)
          + wave(p, vec2(-0.42, 0.91), 0.92, 1.7, 0.03)
          + wave(p, vec2(0.98, -0.2), 1.9, 2.4, 0.012)
          + wave(p, vec2(-0.7, -0.71), 3.1, 3.1, 0.006);
        vec3 normal = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 view = normalize(cameraPosition - lakeWorld);
        float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
        vec3 reflected = reflect(-view, normal);
        vec3 sky = mix(skyHorizon, skyZenith, pow(clamp(reflected.y, 0.0, 1.0), 0.6));
        vec2 d = p - lakeCenter;
        float angle = atan(d.y, d.x);
        float shore = lakeRadius * (1.0 + 0.16 * sin(angle * 2.0 + 1.1)
          + 0.09 * sin(angle * 3.0 + 2.3) + 0.05 * sin(angle * 5.0 + 0.4));
        float t = length(d) / shore;
        vec3 body = mix(deepColor, shallowColor, smoothstep(0.62, 1.0, t));
        vec3 color = mix(body, sky, clamp(fresnel * 0.85, 0.0, 1.0));
        float glint = pow(max(dot(reflected, normalize(sunDirection)), 0.0), 220.0);
        color += vec3(1.0, 0.94, 0.82) * glint * 2.2;
        color += vec3(0.9) * smoothstep(0.965, 1.0, t) * 0.12;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "alpine-lake";
  mesh.userData.alpineLakeTick = (time: number, sun: THREE.Vector3) => {
    material.uniforms.lakeTime.value = time;
    material.uniforms.sunDirection.value.copy(sun);
  };
  return mesh;
}
