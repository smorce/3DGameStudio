import {
  Box3,
  CylinderGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import type { EnvironmentSurface } from "./environment-materials";
import { ruleRandom, treeSkeleton, type TreeRules } from "./environment-rules";

/** 骨格と葉群を先に確定し、近中遠景では同じ樹冠から詳細だけを選ぶ。 */
export function buildTree(
  r: TreeRules,
  level: number,
  add: (s: EnvironmentSurface, g: BufferGeometry) => void,
) {
  const pine = r.kind === "pine",
    skeleton = treeSkeleton(r);
  const branch = (a: Vector3, b: Vector3, radius: number, segments = 8) => {
    const delta = b.clone().sub(a),
      g = new CylinderGeometry(radius * 0.48, radius, delta.length(), segments);
    g.applyQuaternion(
      new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    add("bark", g);
  };
  if (level === 2)
    branch(
      new Vector3(),
      new Vector3(r.bend, r.height, r.bend * 0.5),
      r.trunkRadius,
      5,
    );
  else
    for (let i = 0; i < 4; i++) {
      const point = (t: number) =>
        new Vector3(
          Math.sin((t * Math.PI) / 2) * r.bend,
          r.height * t,
          r.bend * t * 0.5,
        );
      branch(point(i / 4), point((i + 1) / 4), r.trunkRadius * (1 - i / 5));
    }
  if (level < 2)
    skeleton.branches.forEach((b, i) => {
      branch(b.start, b.end, pine ? 0.085 : 0.12);
      if (level === 0)
        for (let j = 0; j < 3; j++) {
          const a = b.start.clone().lerp(b.end, 0.55 + j * 0.15);
          const angle = b.angle + (j - 1) * 0.65;
          branch(
            a,
            a
              .clone()
              .add(
                new Vector3(
                  Math.cos(angle) * b.length * 0.4,
                  pine ? 0.2 : 0.65,
                  Math.sin(angle) * b.length * 0.4,
                ),
              ),
            0.035 + (i % 2) * 0.008,
            5,
          );
        }
    });
  const foliage: BufferGeometry[] = [];
  const envelope = new Box3();
  skeleton.clusters.forEach((cluster, i) => {
    const proxy = new IcosahedronGeometry(1, 0);
    proxy.scale(...cluster.radius.toArray());
    proxy.translate(...cluster.center.toArray());
    proxy.computeBoundingBox();
    envelope.union(proxy.boundingBox!);
    if (level === 2) {
      foliage.push(proxy);
      return;
    }
    proxy.dispose();
    const count =
      level === 0 ? r.crownDensity : Math.ceil(r.crownDensity * 0.4);
    for (let j = 0; j < count; j++) {
      const random = ruleRandom(r.seed, 1000 + i * 100 + j);
      const azimuth = random() * Math.PI * 2,
        vertical = random() * 2 - 1;
      const radius = Math.pow(random(), 1 / 3) * 0.8;
      const p = new Vector3(
        Math.cos(azimuth) * Math.sqrt(1 - vertical * vertical),
        vertical,
        Math.sin(azimuth) * Math.sqrt(1 - vertical * vertical),
      )
        .multiplyScalar(radius)
        .multiply(cluster.radius)
        .add(cluster.center);
      // 葉カードを広めに取り、三角形数を増やさずに樹冠内部の透けを減らす。
      const g = new PlaneGeometry(pine ? 1.5 : 1.5, pine ? 0.8 : 1.22);
      g.rotateX((random() - 0.5) * 2);
      g.rotateY(random() * Math.PI * 2);
      g.rotateZ(random() - 0.5);
      g.translate(...p.toArray());
      foliage.push(g);
    }
  });
  // 葉群の外形を共通の包絡へ合わせ、LOD切替で樹冠の幅・中心が変わらないようにする。
  const actual = new Box3();
  foliage.forEach((g) => {
    g.computeBoundingBox();
    actual.union(g.boundingBox!);
  });
  const actualSize = actual.getSize(new Vector3()),
    targetSize = envelope.getSize(new Vector3());
  for (const g of foliage) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++)
      p.setXYZ(
        i,
        envelope.min.x +
          ((p.getX(i) - actual.min.x) / actualSize.x) * targetSize.x,
        envelope.min.y +
          ((p.getY(i) - actual.min.y) / actualSize.y) * targetSize.y,
        envelope.min.z +
          ((p.getZ(i) - actual.min.z) / actualSize.z) * targetSize.z,
      );
    g.computeVertexNormals();
    add(pine ? "needle" : "leaf", g);
  }
}
