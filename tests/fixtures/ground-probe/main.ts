import * as THREE from "three";
import { grassGround } from "../../../packages/renderer-three/src/grass-ground";
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  preserveDrawingBuffer: true,
});
renderer.setSize(512, 512);
renderer.setPixelRatio(1);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 2));
const camera = new THREE.OrthographicCamera(-128, 128, 128, -128, 0.1, 1000);
camera.up.set(0, 0, -1);
camera.position.set(128, 180, 128);
camera.lookAt(128, 0, 128);
function pixels() {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const data = new Uint8Array(512 * 512 * 4);
  gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function build(origin: number, divided: boolean) {
  const root = new THREE.Group(),
    cleanups: (() => void)[] = [],
    size = divided ? 128 : 256;
  for (let z = 0; z < 256; z += size)
    for (let x = 0; x < 256; x += size) {
      const material = new THREE.MeshStandardMaterial({
        color: "#79914f",
        roughness: 1,
      });
      const ground = grassGround(material, {
        originX: origin + x,
        originZ: -origin + z,
        bounds: {
          minX: origin + x,
          minZ: -origin + z,
          maxX: origin + x + size,
          maxZ: -origin + z + size,
        },
        area: { minX: -2e9, minZ: -2e9, maxX: 2e9, maxZ: 2e9 },
        seed: 42,
        height: () => 0,
        allowed: () => true,
      });
      ground.setActive(true);
      const geometry = new THREE.PlaneGeometry(size, size)
        .rotateX(-Math.PI / 2)
        .translate(size / 2, 0, size / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, 0, z);
      root.add(mesh);
      cleanups.push(() => {
        ground.release();
        geometry.dispose();
        material.dispose();
      });
    }
  scene.add(root);
  return {
    root,
    release() {
      scene.remove(root);
      cleanups.forEach((f) => f());
    },
  };
}
function difference(a: Uint8Array, b: Uint8Array) {
  let max = 0,
    changed = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = Math.abs(a[i] - b[i]);
    max = Math.max(max, delta);
    if (delta) changed++;
  }
  return { max, changed };
}
(
  window as unknown as { __GROUND_PROBE__: (origin: number) => unknown }
).__GROUND_PROBE__ = (origin) => {
  const whole = build(origin, false),
    expected = pixels();
  const wholeCapture = renderer.domElement.toDataURL();
  whole.release();
  const chunks = build(origin, true),
    before = pixels(),
    seam = difference(expected, before);
  const dividedCapture = renderer.domElement.toDataURL();
  const delta = new THREE.Vector3(1000000, 0, -1000000);
  chunks.root.position.sub(delta);
  camera.position.sub(delta);
  camera.updateMatrixWorld(true);
  const after = pixels(),
    rebase = difference(before, after);
  const rebaseCapture = renderer.domElement.toDataURL();
  camera.position.add(delta);
  camera.updateMatrixWorld(true);
  chunks.release();
  renderer.render(scene, camera);
  const gl = renderer.getContext(),
    debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    origin,
    seam,
    rebase,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    memory: { ...renderer.info.memory },
    programs: renderer.info.programs?.length,
    captures: {
      whole: wholeCapture,
      divided: dividedCapture,
      rebase: rebaseCapture,
    },
  };
};
