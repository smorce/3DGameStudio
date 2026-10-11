import {
  environmentGeometryVersion,
  treeRules,
  houseRules,
  barnRules,
} from "./environment-rules";
import { alpineModelGlb } from "./alpine-models";
import { environmentModelGlb, qualityModelKind } from "./environment-models";
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
  generationVersion(slot: string) {
    return this.demoPrimitives && qualityModelKind(slot)
      ? environmentGeometryVersion
      : undefined;
  }
  async generate(
    request: AssetGenerationRequest,
  ): Promise<GeneratedAssetArtifact> {
    const promptHash = createHash("sha256")
      .update(
        JSON.stringify({
          ...request,
          ...(qualityModelKind(request.assetSlot)
            ? { environmentGeometryVersion }
            : {}),
        }),
      )
      .digest("hex");
    const quality = qualityModelKind(request.assetSlot);
    const house = request.assetSlot.endsWith(".barn")
      ? barnRules(request.variantIndex)
      : houseRules(request.variantIndex);
    const bytes = this.demoPrimitives
      ? quality
        ? await environmentModelGlb(
            quality,
            request.variantIndex,
            0,
            quality === "house" ? house : undefined,
          )
        : request.assetSlot.includes("alpine-village")
          ? await alpineModelGlb(request.assetSlot, request.variantIndex)
          : await demoPrimitiveGlb(request.assetSlot)
      : await placeholderGlb();
    return {
      generation:
        quality && this.demoPrimitives
          ? {
              kind: quality,
              version: environmentGeometryVersion,
              seed: request.variantIndex,
              parameters:
                quality === "house"
                  ? { ...house }
                  : quality === "oak" || quality === "pine"
                    ? { ...treeRules(quality, request.variantIndex) }
                    : {},
              materials: [],
            }
          : undefined,
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
