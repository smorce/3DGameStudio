import {
  generateChunk,
  type GeneratedChunk,
  type GeneratorInput,
} from "./index";

export interface GenerateChunkRequest {
  type: "generate-chunk";
  ticket: number;
  input: GeneratorInput;
}

export interface GenerateChunkResponse {
  type: "chunk";
  ticket: number;
  chunk: GeneratedChunk;
}

/** Generator本体はWorker APIに依存しない。Adapterだけがメッセージを扱う。 */
export function generateChunkOnThisThread(
  input: GeneratorInput,
): GeneratedChunk {
  return generateChunk(input);
}

export function handleWorkerRequest(
  request: GenerateChunkRequest,
): GenerateChunkResponse {
  return {
    type: "chunk",
    ticket: request.ticket,
    chunk: generateChunk(request.input),
  };
}
