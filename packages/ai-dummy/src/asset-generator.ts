import { demoPrimitiveGlb } from "./demo-primitives";
import type {
  AssetGenerator,
  AssetGenerationRequest,
  GeneratedAssetArtifact,
} from "../../asset-core/src/index";
import { placeholderGlb } from "../../asset-pipeline/src/index";
import { createHash } from "node:crypto";

/** 開発時専用。既存placeholderを通し、外部APIやBlenderを呼び出さない。 */
export class DummyAstraAssetGenerator implements AssetGenerator {
  constructor(private readonly demoPrimitives = false) {}
  async generate(
    request: AssetGenerationRequest,
  ): Promise<GeneratedAssetArtifact> {
    const promptHash = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    const bytes = this.demoPrimitives
      ? await demoPrimitiveGlb(request.assetSlot)
      : await placeholderGlb();
    return {
      candidate: {
        id: `dummy-${promptHash}`,
        name: `${request.assetSlot} (Dummy ${request.variantIndex})`,
        provider: "dummy-astra",
        sourceUrl: "local:dummy-astra",
        author: "3DGameStudio",
        license: "project-owned",
        thumbnail: "",
        category: request.assetSlot,
      },
      bytes,
      option: {
        id: promptHash,
        format: "glb",
        size: bytes.length,
        url: "local:dummy-astra",
      },
      ai: {
        provider: "dummy-astra",
        model: "dummy",
        promptHash,
        generationId: promptHash,
      },
    };
  }
}
