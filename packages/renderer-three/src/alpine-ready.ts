import type { WorldRuntime } from "../../world-system/src/runtime";

/** 遅いFrameでも、準備済みChunkのPropを空のまま描画済みにしない。 */
export function alpineRenderChunk(runtime: WorldRuntime, key: string) {
  const cached = runtime.peekChunk(key);
  if (cached) return cached;
  // Workerの準備済み結果だけを、ChunkStreamerのcreate予算内でCatalog解決する。
  // 未準備のChunkにgetChunkを呼ばず、PLAY中の同期生成を起こさない。
  if (!runtime.peekPreparedChunk(key)) return undefined;
  return runtime.getChunk(key);
}
