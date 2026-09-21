import type { Project } from "../../project-schema/src/index";
import {
  fingerprint,
  worldContentFingerprint,
} from "../../asset-catalog/src/index";
import type { SampleWorldDescriptor } from "./builders";

/** AssetとBake結果を除き、現在の遊びの定義全体を比較する。 */
export function sampleDefinitionFingerprint(project: Project): string {
  const world = { ...project.world };
  delete world.buildManifest;
  return fingerprint({
    world,
    courses: project.courses,
    machines: project.machines,
    missions: project.missions,
    settings: project.settings,
  });
}

export function assertPreparedSampleCurrent(
  descriptor: SampleWorldDescriptor,
  prepared: Project,
): void {
  const current = descriptor.buildProject();
  const expected = worldContentFingerprint(current);
  if (
    worldContentFingerprint(prepared) !== expected ||
    sampleDefinitionFingerprint(prepared) !==
      sampleDefinitionFingerprint(current) ||
    (current.world.source.kind === "procedural" &&
      current.world.source.design &&
      (prepared.world.buildManifest?.worldFingerprint !== expected ||
        prepared.world.buildManifest?.biomeProfileVersion !==
          descriptor.biomeProfileVersion))
  ) {
    throw new Error(
      `Stale prepared sample world: ${descriptor.id}. Run pnpm sample-worlds:prepare and commit the generated demos.`,
    );
  }
}
