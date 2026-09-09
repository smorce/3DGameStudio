import {
  NodeIO,
  Document,
  Accessor,
  type JSONDocument,
} from "@gltf-transform/core";
import { dedup, prune, getBounds, normals } from "@gltf-transform/functions";
import {
  makeRecord,
  type AssetCandidate,
  type DownloadOption,
} from "../../asset-core/src/index";
import { safeFetch } from "../../asset-providers/src/index";
import type { AssetStorage } from "../../storage/src/index";
import { uid, type Vec3 } from "../../project-schema/src/index";
export function validateGlb(bytes: Uint8Array) {
  if (bytes.length < 20 || bytes.length > 64 * 1024 * 1024)
    throw new Error("Invalid GLB size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw new Error("Invalid GLB header");
}
export async function placeholderGlb() {
  const d = new Document(),
    buffer = d.createBuffer();
  const pos = d
      .createAccessor()
      .setType(Accessor.Type.VEC3)
      .setArray(
        new Float32Array([-1, 0, -1, 1, 0, -1, 0, 1.4, 0, 1, 0, 1, -1, 0, 1]),
      )
      .setBuffer(buffer),
    indices = d
      .createAccessor()
      .setType(Accessor.Type.SCALAR)
      .setArray(
        new Uint16Array([0, 2, 1, 1, 2, 3, 3, 2, 4, 4, 2, 0, 0, 1, 3, 0, 3, 4]),
      )
      .setBuffer(buffer);
  const mat = d
    .createMaterial()
    .setBaseColorFactor([0.45, 0.52, 0.43, 1])
    .setRoughnessFactor(0.9);
  const mesh = d
    .createMesh()
    .addPrimitive(
      d
        .createPrimitive()
        .setAttribute("POSITION", pos)
        .setIndices(indices)
        .setMaterial(mat),
    );
  d.createScene().addChild(d.createNode().setMesh(mesh));
  return new NodeIO().writeBinary(d);
}
export async function importAsset(
  candidate: AssetCandidate,
  bytes: Uint8Array,
  storage: AssetStorage,
  option?: DownloadOption,
) {
  const io = new NodeIO();
  let doc: Document;
  const id = uid();
  if (option?.format === "gltf") {
    const json = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as JSONDocument["json"];
    if (json.asset?.version !== "2.0")
      throw new Error("Unsupported glTF version");
    const resources: JSONDocument["resources"] = {};
    let size = bytes.length;
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      const uri = item.uri;
      if (!uri) continue;
      if (uri.includes("..") || uri.startsWith("/") || uri.includes(":"))
        throw new Error("Unsafe glTF resource path");
      const resource = option.resources?.[uri];
      if (!resource) throw new Error(`Missing resource: ${uri}`);
      const data = await safeFetch(resource.url);
      size += data.length;
      if (size > 64 * 1024 * 1024)
        throw new Error("Asset exceeds aggregate size limit");
      resources[uri] = new Uint8Array(data);
    }
    doc = await io.readJSON({ json, resources });
    await storage.save(`${id}/source.gltf`, bytes);
    for (const [uri, data] of Object.entries(resources))
      await storage.save(`${id}/source/${uri}`, data);
  } else {
    validateGlb(bytes);
    doc = await io.readBinary(bytes);
  }
  for (const texture of doc.getRoot().listTextures()) {
    const size = texture.getSize();
    if (size && Math.max(...size) > 8192)
      throw new Error("Texture exceeds dimension limit");
  }
  const scene =
    doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("Asset has no scene");
  const bounds = getBounds(scene);
  if (![...bounds.min, ...bounds.max].every(Number.isFinite))
    throw new Error("Invalid asset bounds");
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION");
      if (!positions) throw new Error("Missing mesh positions");
      const array = positions.getArray();
      if (!array || Array.from(array).some((n) => !Number.isFinite(n)))
        throw new Error("Invalid vertex data");
      const indices = primitive.getIndices()?.getArray();
      if (
        indices &&
        Array.from(indices).some((n) => Number(n) >= positions.getCount())
      )
        throw new Error("Invalid mesh index");
      triangles += (indices?.length ?? positions.getCount()) / 3;
    }
  if (triangles > 1000000) throw new Error("Mesh exceeds triangle limit");
  const original =
    option?.format === "gltf" ? await io.writeBinary(doc) : bytes;
  await storage.save(`${id}/original.glb`, original);
  await doc.transform(dedup(), prune(), normals());
  const runtime = await io.writeBinary(doc);
  validateGlb(runtime);
  await storage.save(`${id}/runtime.glb`, runtime);
  const record = makeRecord(candidate, id);
  record.runtimeInfo = {
    bounds: { min: bounds.min as Vec3, max: bounds.max as Vec3 },
    triangles: Math.floor(triangles),
    collider: "box",
    lodLevels: [0],
  };
  const extent = Math.max(...bounds.max.map((n, i) => n - bounds.min[i]), 0.01);
  const projected: string[] = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const positions = prim.getAttribute("POSITION");
      if (!positions) continue;
      const idx = prim.getIndices();
      const count = idx?.getCount() ?? positions.getCount();
      const step = Math.max(3, Math.ceil(count / 600) * 3);
      for (let i = 0; i + 2 < count; i += step) {
        const points: string[] = [];
        for (let j = 0; j < 3; j++) {
          const v = positions.getElement(
            idx ? idx.getScalar(i + j) : i + j,
            [],
          );
          const x =
              matrix[0] * v[0] +
              matrix[4] * v[1] +
              matrix[8] * v[2] +
              matrix[12] -
              (bounds.min[0] + bounds.max[0]) / 2,
            y =
              matrix[1] * v[0] +
              matrix[5] * v[1] +
              matrix[9] * v[2] +
              matrix[13] -
              bounds.min[1],
            z =
              matrix[2] * v[0] +
              matrix[6] * v[1] +
              matrix[10] * v[2] +
              matrix[14] -
              (bounds.min[2] + bounds.max[2]) / 2;
          points.push(
            `${(128 + ((x - z) * 75) / extent).toFixed(1)},${(195 - ((y * 1.2 + (x + z) * 0.35) * 100) / extent).toFixed(1)}`,
          );
        }
        projected.push(
          `<polygon points="${points.join(" ")}" fill="#80977c" stroke="#526c57" stroke-width="0.4"/>`,
        );
      }
    }
  });
  const thumbnail = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="16" fill="#edf0e5"/>${projected.join("")}</svg>`;
  await storage.save(
    `${id}/thumbnail.svg`,
    new TextEncoder().encode(thumbnail),
  );
  record.files.thumbnail = `/api/files/${id}/thumbnail.svg`;
  record.processing.optimizedAt = new Date().toISOString();
  return record;
}
export type JobStatus =
  "pending" | "running" | "validating" | "completed" | "failed";
export interface GenerationWorker {
  generate(spec: { prompt: string }): Promise<Uint8Array>;
}
export class MockBlenderWorker implements GenerationWorker {
  async generate(spec: { prompt: string }) {
    await new Promise((r) => setTimeout(r, 150));
    if (spec.prompt.includes("fail"))
      throw new Error("Simulated worker failure");
    return placeholderGlb();
  }
}
export class GenerationQueue {
  jobs = new Map<
    string,
    { id: string; status: JobStatus; error?: string; assetId?: string }
  >();
  private tail = Promise.resolve();
  constructor(private worker: GenerationWorker) {}
  submit(
    spec: { prompt: string },
    consume: (bytes: Uint8Array) => Promise<string>,
  ) {
    const id = uid(),
      job: { id: string; status: JobStatus; error?: string; assetId?: string } =
        { id, status: "pending" };
    this.jobs.set(id, job);
    this.tail = this.tail.then(async () => {
      await new Promise((r) => setTimeout(r, 50));
      try {
        job.status = "running";
        const bytes = await this.worker.generate(spec);
        job.status = "validating";
        job.assetId = await consume(bytes);
        job.status = "completed";
      } catch (error) {
        job.status = "failed";
        job.error = String(error);
      }
      if (this.jobs.size > 100) {
        const oldest = [...this.jobs.values()].find((j) =>
          ["completed", "failed"].includes(j.status),
        );
        if (oldest) this.jobs.delete(oldest.id);
      }
    });
    return job;
  }
}
