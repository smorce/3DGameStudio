/// <reference lib="webworker" />
import {
  handlePrepareRequest,
  preparedChunkTransferList,
  type PrepareChunkRequest,
  type WorkerOutbound,
} from "./worker";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<PrepareChunkRequest>) => {
  const request = event.data;
  if (!request || request.type !== "prepare-chunk") return;
  try {
    const response = handlePrepareRequest(request);
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
