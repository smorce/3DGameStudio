import { z } from "zod";
export const vec3 = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export type Vec3 = z.infer<typeof vec3>;
export const PANEL_SIDE = 1;
export const DEFAULT_PANEL_THICKNESS = 0.12;
export const PANEL_MIN_THICKNESS = 0.02;
export const PANEL_MAX_THICKNESS = 1;
export const PANEL_DENSITY = 250;
export const panelMass = (thickness: number) =>
  PANEL_DENSITY * PANEL_SIDE * PANEL_SIDE * thickness;
export const transformSchema = z.object({
  position: vec3,
  rotation: vec3,
  scale: vec3.refine((v) => v.every((n) => n > 0 && n <= 100), "Invalid scale"),
});
export const identity = (): z.infer<typeof transformSchema> => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
const metadata = z.record(z.string(), z.unknown());
export const partKinds = [
  "Panel",
  "Block",
  "Wheel",
  "Motor",
  "Steering",
  "Hinge",
  "Thruster",
] as const;
export const partSchema = z.object({
  id: z.string(),
  definitionId: z.enum(partKinds),
  transform: transformSchema,
  visual: z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  physics: z.object({
    mass: z.number().positive().max(10000),
    friction: z.number().min(0).max(10),
    restitution: z.number().min(0).max(1),
    collider: z.enum(["box", "cylinder"]),
    size: vec3.refine((v) => v.every((n) => n > 0 && n <= 100), "Invalid size"),
  }),
  connectors: z.array(
    z.object({
      id: z.string(),
      position: vec3,
      axis: vec3,
      type: z.enum(["structural", "wheel", "propulsion", "mount"]).optional(),
      accepts: z.array(z.enum(partKinds)).optional(),
      normal: vec3.optional(),
    }),
  ),
  actuator: z.object({
    motorTorque: z.number().min(0).max(10000),
    steering: z.number().min(0).max(1),
    enabled: z.boolean(),
  }),
  metadata,
});
export type Part = z.infer<typeof partSchema>;
export const connectionSchema = z.object({
  id: z.string(),
  a: z.string(),
  b: z.string(),
  connectorA: z.string(),
  connectorB: z.string(),
  type: z.enum(["fixed", "revolute"]),
  axis: vec3.refine((v) => Math.hypot(...v) > 0.001, "Invalid joint axis"),
  damping: z.number().min(0),
});
export const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  parts: z.array(partSchema),
  connections: z.array(connectionSchema),
  controlBindings: z.array(z.object({ action: z.string(), key: z.string() })),
});
export type Machine = z.infer<typeof machineSchema>;
const assetFile = z
  .string()
  .regex(
    /^\/api\/files\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/,
    "Invalid asset file URL",
  );
export const assetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["model", "texture"]),
  source: z.object({
    provider: z.string(),
    sourceAssetId: z.string(),
    sourceUrl: z.string(),
    author: z.string(),
    retrievedAt: z.string(),
  }),
  license: z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    attributionRequired: z.boolean(),
    attributionText: z.string(),
  }),
  files: z.object({
    original: assetFile,
    runtime: assetFile,
    thumbnail: z.string(),
  }),
  processing: z.object({
    importedAt: z.string(),
    optimizedAt: z.string().nullable(),
    pipelineVersion: z.string(),
  }),
  runtimeInfo: z
    .object({
      bounds: z.object({ min: vec3, max: vec3 }),
      triangles: z.number().int().nonnegative(),
      collider: z.enum(["box", "convexHull", "trimesh"]),
      colliderFile: assetFile.optional(),
      colliderBytes: z.number().int().nonnegative().optional(),
      lods: z
        .array(
          z.object({
            level: z.number().int().min(0).max(2),
            file: assetFile,
            triangles: z.number().int().nonnegative(),
            distance: z.number().nonnegative(),
            bytes: z.number().int().nonnegative(),
          }),
        )
        .optional(),
      optimization: z
        .object({
          profile: z.enum(["quality", "balanced", "performance"]),
          sourceBytes: z.number().int().nonnegative(),
          runtimeBytes: z.number().int().nonnegative(),
          textureBytes: z.number().int().nonnegative(),
          warnings: z.array(z.string()),
        })
        .optional(),
      lodLevels: z.array(z.number()),
    })
    .optional(),
  ai: z
    .object({
      provider: z.string(),
      model: z.string(),
      promptHash: z.string(),
      generationId: z.string(),
    })
    .nullable(),
});
export type AssetRecord = z.infer<typeof assetSchema>;
export const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["rock", "tree", "building", "asset"]),
  assetId: z.string().optional(),
  transform: transformSchema,
});
export const terrainSchema = z
  .object({
    resolution: z.number().int().min(3).max(129),
    size: z.number().positive().max(4096),
    heights: z.array(z.number().finite()),
    colors: z.array(z.string()),
    seed: z.number().int(),
  })
  .refine(
    (t) =>
      t.heights.length === t.resolution * t.resolution &&
      t.colors.length === t.heights.length,
    "Invalid terrain grid",
  );
export type Terrain = z.infer<typeof terrainSchema>;
export const worldSchema = z.object({
  id: z.string(),
  name: z.string(),
  terrain: terrainSchema,
  water: z.object({ enabled: z.boolean(), height: z.number().finite() }),
  entities: z.array(entitySchema),
  chunkSize: z.number().positive(),
  lighting: z.object({
    intensity: z.number().min(0).max(10),
    timeOfDay: z.number().min(0).max(24),
  }),
  spawnPoints: z.array(vec3),
  environment: z.object({ sky: z.string(), fog: z.number().min(0).max(1) }),
});
const marker = z.object({ id: z.string(), position: vec3 });
export const courseSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.array(vec3),
  checkpoints: z.array(marker),
  start: vec3,
  goal: vec3,
  obstacles: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["jump", "loop", "bridge", "road", "tunnel", "obstacle"]),
      position: vec3,
      size: vec3,
    }),
  ),
  respawnPoints: z.array(vec3),
  metadata,
});
export type Course = z.infer<typeof courseSchema>;
export const projectSchema = z
  .object({
    schemaVersion: z.literal(3),
    id: z.string(),
    name: z.string(),
    world: worldSchema,
    courses: z.array(courseSchema),
    machines: z.array(machineSchema),
    assets: z.array(assetSchema),
    missions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        courseId: z.string(),
        targetSeconds: z.number().positive(),
      }),
    ),
    settings: z.object({
      gravity: vec3,
      activeCourseId: z.string().nullable().optional(),
      runtimeProfile: z
        .enum(["quality", "balanced", "performance"])
        .default("balanced"),
    }),
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    if (
      !unique([
        ...p.machines.map((m) => m.id),
        ...p.courses.map((c) => c.id),
        ...p.assets.map((a) => a.id),
        ...p.world.entities.map((e) => e.id),
        ...p.machines.flatMap((m) => m.parts.map((a) => a.id)),
        ...p.missions.map((m) => m.id),
      ])
    )
      issue("Duplicate identifiers");
    for (const m of p.machines) {
      if (
        !unique(m.parts.map((a) => a.id)) ||
        !unique(m.connections.map((a) => a.id))
      )
        issue("Duplicate machine identifiers");
      for (const part of m.parts) {
        if (part.definitionId !== "Panel") continue;
        if (
          part.transform.scale.some((value) => value !== 1) ||
          part.physics.size[0] !== PANEL_SIDE ||
          part.physics.size[2] !== PANEL_SIDE
        )
          issue("Panel width and length are fixed");
        if (
          Math.abs(part.physics.mass - panelMass(part.physics.size[1])) > 1e-6
        )
          issue("Panel mass must be derived from thickness");
      }
      for (const c of m.connections) {
        const a = m.parts.find((p) => p.id === c.a),
          b = m.parts.find((p) => p.id === c.b);
        if (
          !a ||
          !b ||
          a === b ||
          !a.connectors.some((x) => x.id === c.connectorA) ||
          !b.connectors.some((x) => x.id === c.connectorB)
        )
          issue("Invalid connection reference");
      }
    }
    for (const e of p.world.entities)
      if (e.kind === "asset" && !p.assets.some((a) => a.id === e.assetId))
        issue("Missing asset reference");
    if (
      p.settings.activeCourseId &&
      !p.courses.some((c) => c.id === p.settings.activeCourseId)
    )
      issue("Missing active course reference");
    for (const m of p.missions)
      if (!p.courses.some((c) => c.id === m.courseId))
        issue("Missing course reference");
  });
export type Project = z.infer<typeof projectSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function legacyNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function legacyVec3(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3
    ? (value.map((n, i) => legacyNumber(n, fallback[i])) as Vec3)
    : fallback;
}

function clampPanelThickness(value: number) {
  return Math.max(PANEL_MIN_THICKNESS, Math.min(PANEL_MAX_THICKNESS, value));
}

function migrateV2Part(input: unknown) {
  if (!isRecord(input)) return input;
  const transform = isRecord(input.transform) ? input.transform : {};
  const physics = isRecord(input.physics) ? input.physics : {};
  const oldSize = legacyVec3(physics.size, [
    PANEL_SIDE,
    DEFAULT_PANEL_THICKNESS,
    PANEL_SIDE,
  ]);
  const oldScale = legacyVec3(transform.scale, [1, 1, 1]);
  const isPanel =
    input.definitionId === "Panel" || input.definitionId === "Wing";
  const connectors = Array.isArray(input.connectors)
    ? input.connectors.map((connector) => {
        if (!isRecord(connector)) return connector;
        const accepts = Array.isArray(connector.accepts)
          ? connector.accepts
              .filter((kind): kind is string => typeof kind === "string")
              .map((kind) => (kind === "Wing" ? "Panel" : kind))
          : connector.accepts;
        return {
          ...connector,
          ...(connector.type === "wing" ? { type: "structural" } : {}),
          ...(Array.isArray(accepts) ? { accepts: [...new Set(accepts)] } : {}),
        };
      })
    : input.connectors;
  return {
    ...input,
    definitionId: input.definitionId === "Wing" ? "Panel" : input.definitionId,
    transform: {
      ...transform,
      ...(isPanel ? { scale: [1, 1, 1] } : {}),
    },
    physics: {
      ...physics,
      ...(isPanel
        ? {
            mass: panelMass(
              clampPanelThickness(oldSize[1] * Math.max(0.01, oldScale[1])),
            ),
            size: [
              PANEL_SIDE,
              clampPanelThickness(oldSize[1] * Math.max(0.01, oldScale[1])),
              PANEL_SIDE,
            ],
          }
        : {}),
    },
    ...(connectors ? { connectors } : {}),
  };
}

function migrateV2Project(input: Record<string, unknown>) {
  return {
    ...input,
    schemaVersion: 3,
    machines: Array.isArray(input.machines)
      ? input.machines.map((machine) => {
          if (!isRecord(machine)) return machine;
          const parts = Array.isArray(machine.parts)
            ? machine.parts.map(migrateV2Part)
            : machine.parts;
          const panels = Array.isArray(parts)
            ? parts.filter(
                (part): part is Record<string, unknown> =>
                  isRecord(part) && part.definitionId === "Panel",
              )
            : [];
          if (Array.isArray(parts) && Array.isArray(machine.connections)) {
            for (const panel of panels) {
              const panelPosition = isRecord(panel.transform)
                ? legacyVec3(panel.transform.position, [0, 0.85, 0])
                : [0, 0.85, 0];
              for (const connection of machine.connections) {
                if (
                  !isRecord(connection) ||
                  connection.a !== panel.id ||
                  typeof connection.connectorA !== "string" ||
                  !/^[0-3]$/.test(connection.connectorA)
                )
                  continue;
                const wheel = parts.find(
                  (part): part is Record<string, unknown> =>
                    isRecord(part) &&
                    part.id === connection.b &&
                    part.definitionId === "Wheel",
                );
                if (!wheel || !isRecord(wheel.transform)) continue;
                const slot = [
                  [-1, -0.45, 1.25],
                  [1, -0.45, 1.25],
                  [-1, -0.45, -1.25],
                  [1, -0.45, -1.25],
                ][Number(connection.connectorA)];
                wheel.transform.position = slot.map(
                  (value, index) => panelPosition[index] + value,
                );
              }
            }
          }
          return {
            ...machine,
            parts,
          };
        })
      : input.machines,
  };
}

export function parseProject(input: unknown): Project {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion === 0
  ) {
    input = {
      ...input,
      schemaVersion: 1,
      missions: "missions" in input ? input.missions : [],
    };
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion === 1
  ) {
    const old = input as { settings?: object; courses?: { id: string }[] };
    input = {
      ...input,
      schemaVersion: 2,
      settings: {
        ...old.settings,
        activeCourseId: old.courses?.[0]?.id ?? null,
      },
    };
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion === 2
  ) {
    input = migrateV2Project(input as Record<string, unknown>);
  }
  return projectSchema.parse(input);
}
export const uid = () => crypto.randomUUID();
export function emptyProject(): Project {
  const n = 33;
  return {
    schemaVersion: 3,
    id: uid(),
    name: "わたしのスタジオ",
    world: {
      id: uid(),
      name: "はじまりの草原",
      terrain: {
        resolution: n,
        size: 128,
        heights: Array(n * n).fill(0),
        colors: Array(n * n).fill("#7cab68"),
        seed: 42,
      },
      water: { enabled: false, height: -0.4 },
      entities: [],
      chunkSize: 32,
      lighting: { intensity: 2, timeOfDay: 14 },
      spawnPoints: [[0, 2, 0]],
      environment: { sky: "#c8e6f5", fog: 0.003 },
    },
    courses: [],
    machines: [],
    assets: [],
    missions: [],
    settings: {
      gravity: [0, -9.81, 0],
      activeCourseId: null,
      runtimeProfile: "balanced",
    },
  };
}

export function activeCourse(project: Project, courseId?: string | null) {
  const id =
    courseId !== undefined ? courseId : project.settings.activeCourseId;
  if (id === null) return undefined;
  if (id === undefined) return project.courses[0];
  const course = project.courses.find((c) => c.id === id);
  if (!course) throw new Error("Course not found");
  return course;
}
