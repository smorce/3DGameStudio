import * as THREE from "three";

/** GLBの羽根だけを局所ピボットで回す。物理・Part別VFX入力には触れない。 */
export function alpineRotorTick(mesh: THREE.InstancedMesh) {
  const original = Array.from({ length: mesh.count }, (_, index) => {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    return matrix;
  });
  const pivot = new THREE.Matrix4().makeTranslation(0, 10.5, 3.1);
  const inversePivot = pivot.clone().invert();
  const rotation = new THREE.Matrix4(),
    matrix = new THREE.Matrix4();
  return (time: number) => {
    rotation
      .copy(pivot)
      .multiply(new THREE.Matrix4().makeRotationZ(time * 0.08))
      .multiply(inversePivot);
    original.forEach((base, index) => {
      matrix.copy(base).multiply(rotation);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
}
