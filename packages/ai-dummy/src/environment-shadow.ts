import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import {
  Box3,
  CylinderGeometry,
  IcosahedronGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  treeSkeleton,
  environmentGeometryVersion,
  type TreeRules,
} from "./environment-rules";
/** 影専用の中遠景モデルを事前保存する。樹冠規則とSeedは表示モデルと共有する。 */
export async function environmentShadowGlb(rules: TreeRules, level: 1 | 2) {
  const geometries: BufferGeometry[] = [],
    envelope = new Box3();
  for (const cluster of treeSkeleton(rules).clusters) {
    const geometry = new IcosahedronGeometry(1, 0);
    geometry.scale(...cluster.radius.toArray());
    geometry.translate(...cluster.center.toArray());
    geometry.computeBoundingBox();
    envelope.union(geometry.boundingBox!);
    geometries.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  if (level === 2) {
    geometries.forEach((g) => g.dispose());
    geometries.length = 0;
    const size = envelope.getSize(new Vector3()),
      center = envelope.getCenter(new Vector3());
    const geometry = new IcosahedronGeometry(1, 0);
    geometry.scale(size.x / 2, size.y / 2, size.z / 2);
    geometry.translate(...center.toArray());
    geometries.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  const trunk = new CylinderGeometry(
    rules.trunkRadius * 0.48,
    rules.trunkRadius,
    rules.height,
    5,
  );
  trunk.translate(rules.bend / 2, rules.height / 2, rules.bend / 4);
  geometries.push(trunk.toNonIndexed());
  trunk.dispose();
  const geometry = mergeGeometries(geometries)!;
  const doc = new Document(),
    buffer = doc.createBuffer(),
    material = doc
      .createMaterial("environment-shadow")
      .setBaseColorFactor([0.2, 0.3, 0.1, 1]);
  const primitive = doc.createPrimitive().setMaterial(material);
  for (const [name, semantic] of [
    ["position", "POSITION"],
    ["normal", "NORMAL"],
  ] as const)
    primitive.setAttribute(
      semantic,
      doc
        .createAccessor()
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array(geometry.getAttribute(name).array))
        .setBuffer(buffer),
    );
  doc
    .createScene()
    .setExtras({
      environmentGeometryVersion,
      environmentSeed: rules.seed,
      environmentRules: { ...rules },
      environmentShadowLod: level,
    })
    .addChild(
      doc
        .createNode("shadow-crown")
        .setMesh(doc.createMesh().addPrimitive(primitive)),
    );
  geometry.dispose();
  geometries.forEach((g) => g.dispose());
  return new NodeIO().writeBinary(doc);
}
