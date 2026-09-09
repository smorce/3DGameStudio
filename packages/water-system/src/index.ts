export interface WaterSurface {
  enabled: boolean;
  height: number;
}
export function submergedDepth(surface: WaterSurface, y: number) {
  return surface.enabled ? Math.max(0, surface.height - y) : 0;
}
