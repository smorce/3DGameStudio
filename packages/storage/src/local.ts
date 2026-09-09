import { mkdir, readFile, writeFile, unlink, access } from "node:fs/promises";
import path from "node:path";
import type { AssetStorage } from "./index";
export class LocalAssetStorage implements AssetStorage {
  constructor(readonly root: string) {}
  private path(id: string) {
    if (
      id.includes("..") ||
      !/^[-a-zA-Z0-9_./]+$/.test(id) ||
      id.startsWith("/")
    )
      throw new Error("Invalid storage path");
    const p = path.resolve(this.root, id);
    if (!p.startsWith(path.resolve(this.root) + path.sep))
      throw new Error("Invalid storage path");
    return p;
  }
  async save(id: string, data: Uint8Array) {
    const file = this.path(id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  async load(id: string) {
    return new Uint8Array(await readFile(this.path(id)));
  }
  async exists(id: string) {
    try {
      await access(this.path(id));
      return true;
    } catch {
      return false;
    }
  }
  async remove(id: string) {
    await unlink(this.path(id));
  }
  getUrl(id: string) {
    this.path(id);
    return `/api/files/${id}`;
  }
}
