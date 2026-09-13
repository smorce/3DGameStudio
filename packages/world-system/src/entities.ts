import type { Vec3 } from "../../project-schema/src/index";
import type { GeneratedEntity } from "../../world-generator/src/index";

export type BuiltinEntityKind = "tree" | "building" | "rock";
type Quat = [number, number, number, number];

export type BuiltinVisualPart =
  | {
      shape: "cylinder";
      radiusTop: number;
      radiusBottom: number;
      height: number;
      localPosition: Vec3;
      localRotation: Vec3;
      color: string;
    }
  | {
      shape: "cone";
      radius: number;
      height: number;
      localPosition: Vec3;
      localRotation: Vec3;
      color: string;
      radialSegments?: number;
    }
  | {
      shape: "box";
      size: Vec3;
      localPosition: Vec3;
      localRotation: Vec3;
      color: string;
    }
  | {
      shape: "icosahedron";
      radius: number;
      localPosition: Vec3;
      localRotation: Vec3;
      color: string;
    };

export type BuiltinColliderPart =
  | {
      type: "cylinder";
      radius: number;
      halfHeight: number;
      localPosition: Vec3;
      localRotation: Vec3;
    }
  | {
      type: "cuboid";
      halfExtents: Vec3;
      localPosition: Vec3;
      localRotation: Vec3;
    }
  | {
      type: "ball";
      radius: number;
      localPosition: Vec3;
      localRotation: Vec3;
    };

export interface BuiltinEntityDefinition {
  kind: BuiltinEntityKind;
  visual: BuiltinVisualPart[];
  colliders: BuiltinColliderPart[];
}

export interface EntityTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export type WorldColliderPose =
  | {
      type: "cylinder";
      radius: number;
      halfHeight: number;
      translation: Vec3;
      rotation: Quat;
    }
  | {
      type: "cuboid";
      halfExtents: Vec3;
      translation: Vec3;
      rotation: Quat;
    }
  | {
      type: "ball";
      radius: number;
      translation: Vec3;
      rotation: Quat;
    };

const TREE: BuiltinEntityDefinition = {
  kind: "tree",
  visual: [
    {
      shape: "cylinder",
      radiusTop: 0.15,
      radiusBottom: 0.2,
      height: 1.5,
      localPosition: [0, 0.75, 0],
      localRotation: [0, 0, 0],
      color: "#856349",
    },
    {
      shape: "cone",
      radius: 1,
      height: 2.4,
      localPosition: [0, 2, 0],
      localRotation: [0, 0, 0],
      color: "#3e7956",
    },
  ],
  colliders: [
    {
      type: "cylinder",
      radius: 0.2,
      halfHeight: 0.75,
      localPosition: [0, 0.75, 0],
      localRotation: [0, 0, 0],
    },
  ],
};

const BUILDING: BuiltinEntityDefinition = {
  kind: "building",
  visual: [
    {
      shape: "box",
      size: [2, 2.6, 2],
      localPosition: [0, 1.3, 0],
      localRotation: [0, 0, 0],
      color: "#c8b891",
    },
    {
      shape: "cone",
      radius: 1.55,
      height: 0.9,
      localPosition: [0, 3.05, 0],
      localRotation: [0, Math.PI / 4, 0],
      color: "#a85f54",
      radialSegments: 4,
    },
    {
      shape: "box",
      size: [0.35, 0.38, 0.06],
      localPosition: [-0.55, 1.45, 1.03],
      localRotation: [0, 0, 0],
      color: "#5a7780",
    },
    {
      shape: "box",
      size: [0.35, 0.38, 0.06],
      localPosition: [0.55, 1.45, 1.03],
      localRotation: [0, 0, 0],
      color: "#5a7780",
    },
  ],
  colliders: [
    {
      type: "cuboid",
      halfExtents: [1, 1.3, 1],
      localPosition: [0, 1.3, 0],
      localRotation: [0, 0, 0],
    },
    {
      type: "cuboid",
      halfExtents: [1.1, 0.45, 1.1],
      localPosition: [0, 3.05, 0],
      localRotation: [0, 0, 0],
    },
  ],
};

const ROCK: BuiltinEntityDefinition = {
  kind: "rock",
  visual: [
    {
      shape: "icosahedron",
      radius: 0.8,
      localPosition: [0, 0.5, 0],
      localRotation: [0, 0, 0],
      color: "#8b9790",
    },
  ],
  colliders: [
    {
      type: "ball",
      radius: 0.8,
      localPosition: [0, 0.5, 0],
      localRotation: [0, 0, 0],
    },
  ],
};

const DEFINITIONS: Record<BuiltinEntityKind, BuiltinEntityDefinition> = {
  tree: TREE,
  building: BUILDING,
  rock: ROCK,
};

export function isBuiltinEntityKind(kind: string): kind is BuiltinEntityKind {
  return kind === "tree" || kind === "building" || kind === "rock";
}

export function builtinEntityDefinition(
  kind: BuiltinEntityKind,
): BuiltinEntityDefinition {
  return DEFINITIONS[kind];
}

function quaternion(e: Vec3): Quat {
  const [x, y, z] = e.map((n) => n / 2),
    a = Math.cos(x),
    b = Math.sin(x),
    c = Math.cos(y),
    d = Math.sin(y),
    f = Math.cos(z),
    g = Math.sin(z);
  return [
    b * c * f + a * d * g,
    a * d * f - b * c * g,
    a * c * g + b * d * f,
    a * c * f - b * d * g,
  ];
}

function multiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function rotate(v: Vec3, q: Quat): Vec3 {
  const r = multiply(multiply(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
}

function scaledLocal(local: Vec3, scale: Vec3): Vec3 {
  return [local[0] * scale[0], local[1] * scale[1], local[2] * scale[2]];
}

export function worldColliderPose(
  collider: BuiltinColliderPart,
  transform: EntityTransform,
): WorldColliderPose {
  const entityRotation = quaternion(transform.rotation);
  const rotation = multiply(entityRotation, quaternion(collider.localRotation));
  const offset = rotate(
    scaledLocal(collider.localPosition, transform.scale),
    entityRotation,
  );
  const translation: Vec3 = [
    transform.position[0] + offset[0],
    transform.position[1] + offset[1],
    transform.position[2] + offset[2],
  ];
  const sx = Math.abs(transform.scale[0]),
    sy = Math.abs(transform.scale[1]),
    sz = Math.abs(transform.scale[2]);
  if (collider.type === "cylinder")
    return {
      type: "cylinder",
      radius: collider.radius * Math.max(sx, sz),
      halfHeight: collider.halfHeight * sy,
      translation,
      rotation,
    };
  if (collider.type === "ball")
    return {
      type: "ball",
      radius: collider.radius * Math.max(sx, sy, sz),
      translation,
      rotation,
    };
  return {
    type: "cuboid",
    halfExtents: [
      collider.halfExtents[0] * sx,
      collider.halfExtents[1] * sy,
      collider.halfExtents[2] * sz,
    ],
    translation,
    rotation,
  };
}

export function worldCollidersForEntity(
  kind: BuiltinEntityKind,
  transform: EntityTransform,
): WorldColliderPose[] {
  return builtinEntityDefinition(kind).colliders.map((collider) =>
    worldColliderPose(collider, transform),
  );
}

export function generatedEntityColliders(entity: GeneratedEntity) {
  return worldCollidersForEntity(entity.kind, {
    position: entity.position,
    rotation: entity.rotation,
    scale: entity.scale,
  });
}
