import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sampleWorldCatalog } from "../../packages/sample-worlds/src/builders";
import { sampleWorldCatalog as metadata } from "../../packages/sample-worlds/src/metadata";
import { assertPreparedSampleCurrent } from "../../packages/sample-worlds/src/freshness";
import {
  parseProject,
  type Project,
} from "../../packages/project-schema/src/index";
import { CURRENT_BIOME_PROFILE_VERSION } from "../../packages/world-generator/src/index";

it.each(sampleWorldCatalog)(
  "$id のPrepared Demoは現在の定義に一致する",
  (descriptor) => {
    const prepared = parseProject(
      JSON.parse(readFileSync(`demos/worlds/${descriptor.id}.json`, "utf8")),
    );
    expect(() =>
      assertPreparedSampleCurrent(descriptor, prepared),
    ).not.toThrow();
  },
);
it("MetadataとBuilderの一覧は一致しMetadataは組み立て関数を持たない", () => {
  expect(
    sampleWorldCatalog.map(
      ({ buildProject: _build, biomeProfileVersion: _version, ...item }) =>
        item,
    ),
  ).toEqual(metadata);
  expect(metadata.every((item) => !("buildProject" in item))).toBe(true);
  expect(
    sampleWorldCatalog.every(
      (item) => item.biomeProfileVersion === CURRENT_BIOME_PROFILE_VERSION,
    ),
  ).toBe(true);
});
const changes: [string, (p: Project) => void][] = [
  [
    "World",
    (p) => {
      p.world.spawnPoints[0][0]++;
    },
  ],
  [
    "Machine",
    (p) => {
      p.machines[0].parts[0].transform.position[0]++;
    },
  ],
  [
    "Course",
    (p) => {
      p.courses[0].checkpoints[0].position[0]++;
    },
  ],
  [
    "Mission",
    (p) => {
      p.missions.push({
        id: "time-trial",
        name: "3分以内に完走",
        courseId: p.courses[0].id,
        targetSeconds: 180,
      });
    },
  ],
  [
    "Settings",
    (p) => {
      p.settings.activeCourseId = undefined;
    },
  ],
];
it.each(changes)("%sを変更してprepareし忘れると失敗する", (_name, change) => {
  const descriptor = sampleWorldCatalog.find((w) => w.id === "race-island")!;
  const prepared = parseProject(
    JSON.parse(readFileSync("demos/worlds/race-island.json", "utf8")),
  );
  const current = descriptor.buildProject();
  change(current);
  expect(() =>
    assertPreparedSampleCurrent(
      { ...descriptor, buildProject: () => current },
      prepared,
    ),
  ).toThrow(/Stale prepared sample world: race-island.*sample-worlds:prepare/);
});
it("Preparedの改変とManifest欠落・古いFingerprintも拒否する", () => {
  const descriptor = sampleWorldCatalog.find((w) => w.id === "race-island")!;
  const prepared = parseProject(
    JSON.parse(readFileSync("demos/worlds/race-island.json", "utf8")),
  );
  for (const [, change] of changes) {
    const modified = structuredClone(prepared);
    change(modified);
    expect(() => assertPreparedSampleCurrent(descriptor, modified)).toThrow(
      /Stale prepared/,
    );
  }
  prepared.world.buildManifest!.worldFingerprint = "stale";
  expect(() => assertPreparedSampleCurrent(descriptor, prepared)).toThrow(
    /Stale prepared/,
  );
  delete prepared.world.buildManifest;
  expect(() => assertPreparedSampleCurrent(descriptor, prepared)).toThrow(
    /Stale prepared/,
  );
});
it("Prepared ManifestのBiome版がDescriptorと違うと失敗する", () => {
  const descriptor = sampleWorldCatalog.find((w) => w.id === "race-island")!;
  const prepared = parseProject(
    JSON.parse(readFileSync("demos/worlds/race-island.json", "utf8")),
  );
  prepared.world.buildManifest!.biomeProfileVersion =
    CURRENT_BIOME_PROFILE_VERSION + 1;
  expect(() => assertPreparedSampleCurrent(descriptor, prepared)).toThrow(
    /Stale prepared/,
  );
});
