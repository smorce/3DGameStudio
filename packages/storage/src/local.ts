import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  access,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { AssetStorage } from "./index";
export class LocalAssetStorage implements AssetStorage {
  private used?: number;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly root: string,
    private budget = Infinity,
  ) {}
  private async diskUsage(dir = this.root): Promise<number> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      let size = 0;
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        size += entry.isDirectory()
          ? await this.diskUsage(file)
          : (await stat(file)).size;
      }
      return size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }

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
    await this.serialized(async () => {
      this.used ??= await this.diskUsage();
      let previous = 0;
      try {
        previous = (await stat(file)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (this.used - previous + data.length > this.budget)
        throw new Error("Asset storage budget exceeded");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
      this.used = this.used - previous + data.length;
    });
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
    const file = this.path(id);
    await this.serialized(async () => {
      const size = (await stat(file)).size;
      await unlink(file);
      if (this.used !== undefined) this.used -= size;
    });
  }
  getUrl(id: string) {
    this.path(id);
    return `/api/files/${id}`;
  }
}
