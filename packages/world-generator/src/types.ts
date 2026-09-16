import type {
  EnvironmentPreset,
  Vec3,
  WorldDesign,
} from "../../project-schema/src/index";
/** Worker / prepare へ渡す Terrain Edit Overlay（serializable）。 */
export interface TerrainEditOverlay {
  heightDeltas?: Record<string, number>;
  colors?: Record<string, string>;
}

export interface GeneratorInput {
  seed: number;
  generatorVersion: number;
  preset: EnvironmentPreset;
  chunkX: number;
  chunkZ: number;
  chunkSize: number;
  chunkResolution: number;
  parameters?: Record<string, unknown>;
  design?: WorldDesign;
  /** Chunk に対応する編集差分。指定時は heights/colors に適用してから Mesh を作る。 */
  terrainEdit?: TerrainEditOverlay;
}

export interface GeneratedEntity {
  assetSlot?: string;
  assetId?: string;
  biome?: string;
  landmark?: boolean;
  missingAsset?: boolean;
  id: string;
  name: string;
  kind: "rock" | "tree" | "building";
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface GeneratedChunk {
  chunkX: number;
  chunkZ: number;
  size: number;
  resolution: number;
  heights: Float32Array;
  colors: string[];
  entities: GeneratedEntity[];
  biome: EnvironmentPreset;
}
