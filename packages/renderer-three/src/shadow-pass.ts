import type * as THREE from "three";
import { DisjointGpuTimer } from "./gpu-timer";
/** 総GPUクエリと重ならないフレームでShadow Passを測定する。 */
export class ShadowPassProbe {
  private timer: DisjointGpuTimer;
  enabled = false;
  measuring = false;
  cpuMs = 0;
  private restore: () => void;
  constructor(
    renderer: THREE.WebGLRenderer,
    private meta: () => { frame: number; timeMs: number },
  ) {
    this.timer = new DisjointGpuTimer(
      renderer.getContext() as WebGL2RenderingContext,
    );
    const original = renderer.shadowMap.render;
    renderer.shadowMap.render = (...args) => {
      if (!this.enabled) return original.apply(renderer.shadowMap, args);
      const start = performance.now();
      if (this.measuring) this.timer.begin(this.meta());
      try {
        return original.apply(renderer.shadowMap, args);
      } finally {
        if (this.measuring) this.timer.end();
        this.cpuMs = performance.now() - start;
      }
    };
    this.restore = () => {
      renderer.shadowMap.render = original;
    };
  }
  get gpuMs() {
    this.timer.poll();
    const s = this.timer.snapshot();
    return s.sampleCount ? s.lastMs : -1;
  }
  dispose() {
    this.restore();
    this.timer.dispose();
  }
}
