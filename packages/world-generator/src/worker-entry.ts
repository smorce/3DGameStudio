/// <reference lib="webworker" />
import { buildIslandProxies } from "./far-proxy";
import {
  handlePrepareRequest,
  preparedChunkTransferList,
  type PrepareChunkRequest,
  type WorkerOutbound,
} from "./worker";

import type { WorldDesign } from "../../project-schema/src/index";
let design: WorldDesign | undefined;
const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (
  event: MessageEvent<
    | PrepareChunkRequest
    | { type: "generation-context"; design?: WorldDesign }
    | {
        type: "far-proxies";
        design: WorldDesign;
        seed: number;
        chunkSize: number;
        biomeProfileVersion?: number;
      }
  >,
) => {
  const request = event.data;
  if (request?.type === "far-proxies") {
    try {
      const proxies = buildIslandProxies(
        request.design,
        request.seed,
        request.chunkSize,
        request.biomeProfileVersion,
      );
      workerScope.postMessage(
        { type: "far-proxies", proxies },
        proxies.flatMap(
          (p) =>
            [
              p.positions.buffer,
              p.normals.buffer,
              p.indices.buffer,
            ] as ArrayBuffer[],
        ),
      );
    } catch (error) {
      workerScope.postMessage({
        type: "far-proxies-error",
        message: String(error),
      });
    }
    return;
  }
  if (request?.type === "generation-context") {
    design = request.design;
    return;
  }
  if (!request || request.type !== "prepare-chunk") return;
  try {
    const response = handlePrepareRequest({
      ...request,
      input: { ...request.input, design: request.input.design ?? design },
    });
    const transfer = preparedChunkTransferList(response.prepared);
    workerScope.postMessage(response satisfies WorkerOutbound, transfer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chunk preparation failed";
    const failure: WorkerOutbound = {
      type: "prepared-chunk-error",
      jobId: request.jobId,
      runtimeGeneration: request.runtimeGeneration,
      chunkKey: request.chunkKey,
      message,
    };
    workerScope.postMessage(failure);
  }
};
