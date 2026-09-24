import * as THREE from "three";
import type { Vec3 } from "../../../project-schema/src/index";
import { EFFECT_CONFIG } from "./effect-config";

/** 固定長リングプール。粒子は機体から独立した描画ワールド座標を保持する。 */
export class EffectParticleSystem {
  readonly positions: Float32Array;
  readonly ages: Float32Array;
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  readonly points: THREE.Points;
  private readonly velocities: Float32Array;
  private readonly sizes: Float32Array;
  private readonly opacity: Float32Array;
  private cursor = 0;
  private seed = 12345;
  activeCount = 0;
  constructor(
    readonly capacity: number,
    readonly smoke = false,
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.ages = new Float32Array(capacity).fill(-1);
    this.sizes = new Float32Array(capacity);
    this.opacity = new Float32Array(capacity);
    for (const [name, array, size] of [
      ["position", this.positions, 3],
      ["particleSize", this.sizes, 1],
      ["particleOpacity", this.opacity, 1],
    ] as const)
      this.geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        viewportHeight: { value: 720 },
        tint: { value: new THREE.Color(smoke ? "#edf0ee" : "#e9f5ff") },
      },
      vertexShader: `attribute float particleSize; attribute float particleOpacity;
        uniform float viewportHeight; varying float alpha;
        void main() { vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_PointSize = clamp(particleSize * viewportHeight * projectionMatrix[1][1] / max(0.1, -2.0*p.z), 1.0, 96.0);
          alpha = particleOpacity; }`,
      fragmentShader: `uniform vec3 tint; varying float alpha;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = alpha * (1.0 - smoothstep(0.0, 1.0, r));
          if (a < 0.002) discard;
          gl_FragColor = vec4(tint, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  emit(position: THREE.Vector3) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (this.ages[i] < 0) this.activeCount++;
    this.ages[i] = 0;
    const offset = i * 3;
    this.positions[offset] = position.x;
    this.positions[offset + 1] = position.y;
    this.positions[offset + 2] = position.z;
    this.velocities[offset] = this.smoke
      ? (this.random() - 0.5) * EFFECT_CONFIG.smoke.spread
      : 0;
    this.velocities[offset + 1] = this.smoke ? EFFECT_CONFIG.smoke.rise : 0;
    this.velocities[offset + 2] = this.smoke
      ? (this.random() - 0.5) * EFFECT_CONFIG.smoke.spread
      : 0;
  }
  update(dt: number, viewportHeight = 720) {
    const config = this.smoke ? EFFECT_CONFIG.smoke : EFFECT_CONFIG.vapor;
    for (let i = 0; i < this.capacity; i++) {
      if (this.ages[i] < 0) continue;
      this.ages[i] += dt;
      if (this.ages[i] >= config.lifetime) {
        this.ages[i] = -1;
        this.opacity[i] = 0;
        this.activeCount--;
        continue;
      }
      const age = this.ages[i] / config.lifetime;
      for (let axis = 0; axis < 3; axis++)
        this.positions[i * 3 + axis] += this.velocities[i * 3 + axis] * dt;
      this.sizes[i] =
        config.size * (this.smoke ? 1 + age * EFFECT_CONFIG.smoke.growth : 1);
      this.opacity[i] = config.opacity * (1 - age);
    }
    this.material.uniforms.viewportHeight.value = viewportHeight;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.particleSize.needsUpdate = true;
    this.geometry.attributes.particleOpacity.needsUpdate = true;
    this.points.visible = this.activeCount > 0;
  }
  shiftOrigin(delta: Vec3) {
    for (let i = 0; i < this.capacity; i++)
      if (this.ages[i] >= 0)
        for (let axis = 0; axis < 3; axis++)
          this.positions[i * 3 + axis] -= delta[axis];
    this.geometry.attributes.position.needsUpdate = true;
  }
  clear() {
    this.ages.fill(-1);
    this.opacity.fill(0);
    this.activeCount = 0;
    this.cursor = 0;
    this.seed = 12345;
    this.points.visible = false;
    this.geometry.attributes.particleOpacity.needsUpdate = true;
  }
  dispose() {
    this.clear();
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
