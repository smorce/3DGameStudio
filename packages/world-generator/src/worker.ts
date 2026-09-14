import {
  prepareChunk,
  preparedChunkTransferList,
  type PreparedChunk,
} from "./prepare";
import type { GeneratorInput } from "./index";

export type ChunkPriority =
  | "P0_PHYSICS_CRITICAL"
  | "P1_PHYSICS_PREFETCH"
  | "P2_VISIBLE_RENDER"
  | "P3_RENDER_PREFETCH"
  | "P4_EDITOR";

export const CHUNK_PRIORITY_ORDER: Record<ChunkPriority, number> = {
  P0_PHYSICS_CRITICAL: 0,
  P1_PHYSICS_PREFETCH: 1,
  P2_VISIBLE_RENDER: 2,
  P3_RENDER_PREFETCH: 3,
  P4_EDITOR: 4,
};

export function higherPriority(
  a: ChunkPriority,
  b: ChunkPriority,
): ChunkPriority {
  return CHUNK_PRIORITY_ORDER[a] <= CHUNK_PRIORITY_ORDER[b] ? a : b;
}

export interface PrepareChunkRequest {
  type: "prepare-chunk";
  jobId: number;
  runtimeGeneration: number;
  chunkKey: string;
  input: GeneratorInput;
}

export interface PrepareChunkResponse {
  type: "prepared-chunk";
  jobId: number;
  runtimeGeneration: number;
  chunkKey: string;
  prepared: PreparedChunk;
}

export interface PrepareChunkError {
  type: "prepared-chunk-error";
  jobId: number;
  runtimeGeneration: number;
  chunkKey: string;
  message: string;
}

export type WorkerOutbound = PrepareChunkResponse | PrepareChunkError;

/** Generator本体はWorker APIに依存しない。Adapterだけがメッセージを扱う。 */
export function prepareChunkOnThisThread(input: GeneratorInput): PreparedChunk {
  return prepareChunk(input);
}

export function handlePrepareRequest(
  request: PrepareChunkRequest,
): PrepareChunkResponse {
  return {
    type: "prepared-chunk",
    jobId: request.jobId,
    runtimeGeneration: request.runtimeGeneration,
    chunkKey: request.chunkKey,
    prepared: prepareChunk(request.input),
  };
}

export { prepareChunk, preparedChunkTransferList };
export type { PreparedChunk };
