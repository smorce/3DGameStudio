import { z } from "zod";
export const colliderDataSchema = z
  .object({
    version: z.literal(1),
    vertices: z.array(z.number().finite()).min(9).max(3000000),
    indices: z.array(z.number().int().nonnegative()).min(3).max(3000000),
  })
  .refine(
    (data) =>
      data.vertices.length % 3 === 0 &&
      data.indices.length % 3 === 0 &&
      data.indices.every((i) => i < data.vertices.length / 3),
    "Invalid collider geometry",
  );
export type ColliderData = z.infer<typeof colliderDataSchema>;
export class ColliderTemplateCache {
  private templates = new Map<string, Promise<ColliderData | undefined>>();
  constructor(
    private read: (url: string) => Promise<unknown> = async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Collider download failed");
      const limit = 64 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit)
        throw new Error("Collider exceeds safety limit");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing collider body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) throw new Error("Collider exceeds safety limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  ) {}
  get(url: string) {
    let template = this.templates.get(url);
    if (!template) {
      template = this.read(url)
        .then((data) => colliderDataSchema.parse(data))
        .catch(() => undefined);
      this.templates.set(url, template);
    }
    return template;
  }
  clear() {
    this.templates.clear();
  }
}
