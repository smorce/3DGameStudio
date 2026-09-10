import * as THREE from "three";
import type { Part } from "../../project-schema/src/index";

export interface PartVisualOptions {
  ghost?: boolean;
  opacity?: number;
}

const visualOptions = (options: PartVisualOptions) => ({
  transparent: options.ghost === true,
  opacity: options.ghost ? (options.opacity ?? 0.35) : 1,
  depthWrite: !options.ghost,
});

function material(
  color: string,
  options: PartVisualOptions,
  extras: { emissive?: string; emissiveIntensity?: number } = {},
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    ...extras,
    ...visualOptions(options),
  });
}

function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  color: string,
  options: PartVisualOptions,
  name: string,
  extras?: { emissive?: string; emissiveIntensity?: number },
) {
  const mesh = new THREE.Mesh(geometry, material(color, options, extras));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createWheelVisual(part: Part, options: PartVisualOptions) {
  const group = new THREE.Group();
  group.name = "wheel-visual";
  const [width, radius] = part.physics.size;
  const wheel = addMesh(
    group,
    new THREE.CylinderGeometry(radius, radius, width, 24),
    part.visual.color,
    options,
    "wheel-body",
  );
  wheel.rotation.z = Math.PI / 2;
  const hub = addMesh(
    group,
    new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.03, 16),
    "#d6dde0",
    options,
    "wheel-hub",
  );
  hub.rotation.z = Math.PI / 2;
  return group;
}

function createBasicVisual(part: Part, options: PartVisualOptions) {
  const group = new THREE.Group();
  group.name = `${part.definitionId.toLowerCase()}-visual`;
  addMesh(
    group,
    new THREE.BoxGeometry(...part.physics.size),
    part.visual.color,
    options,
    `${part.definitionId.toLowerCase()}-body`,
  );
  if (part.definitionId === "Panel") {
    const seat = addMesh(
      group,
      new THREE.BoxGeometry(0.65, 0.5, 0.8),
      "#3f6570",
      options,
      "panel-seat",
    );
    seat.position.y = 0.4;
  }
  return group;
}

function createHingeVisual(part: Part, options: PartVisualOptions) {
  const group = new THREE.Group();
  group.name = "hinge-visual";
  group.userData.jointAxis = [1, 0, 0];

  const [sx, sy, sz] = part.physics.size;
  const radialSize = Math.min(sy, sz);
  const pinLength = sx * 0.92;
  const pinRadius = radialSize * 0.18;
  const bracketWidth = sx * 0.18;
  const bracketHeight = sy * 0.72;
  const bracketDepth = sz * 0.82;
  const bracketOffset = sx * 0.32;
  const darkMetal = "#35414a";
  const lightMetal = "#c3cdd1";

  for (const [name, x] of [
    ["hinge-bracket-left", -bracketOffset],
    ["hinge-bracket-right", bracketOffset],
  ] as const) {
    const bracket = addMesh(
      group,
      new THREE.BoxGeometry(bracketWidth, bracketHeight, bracketDepth),
      part.visual.color,
      options,
      name,
    );
    bracket.position.x = x;
  }

  const pin = addMesh(
    group,
    new THREE.CylinderGeometry(pinRadius, pinRadius, pinLength, 16),
    darkMetal,
    options,
    "hinge-pin",
  );
  pin.rotation.z = Math.PI / 2;

  const capDepth = sx * 0.08;
  for (const [name, x] of [
    ["hinge-cap-left", -pinLength / 2 + capDepth / 2],
    ["hinge-cap-right", pinLength / 2 - capDepth / 2],
  ] as const) {
    const cap = addMesh(
      group,
      new THREE.CylinderGeometry(pinRadius * 1.12, pinRadius * 1.12, capDepth, 16),
      lightMetal,
      options,
      name,
    );
    cap.position.x = x;
    cap.rotation.z = Math.PI / 2;
  }

  return group;
}

function createThrusterVisual(part: Part, options: PartVisualOptions) {
  const group = new THREE.Group();
  group.name = "thruster-visual";
  // Physicsの推進力はローカル+Z、排気口は反対のローカル-Zに固定する。
  group.userData.forceAxis = [0, 0, 1];
  group.userData.exhaustAxis = [0, 0, -1];

  const [sx, sy, sz] = part.physics.size;
  const radialSize = Math.min(sx, sy);
  const bodyRadius = radialSize * 0.38;
  const bodyLength = sz * 0.52;
  const body = addMesh(
    group,
    new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyLength, 16),
    part.visual.color,
    options,
    "thruster-body",
  );
  body.position.z = sz * 0.16;
  body.rotation.x = Math.PI / 2;

  const frontCapLength = sz * 0.08;
  const frontCap = addMesh(
    group,
    new THREE.CylinderGeometry(
      bodyRadius * 1.08,
      bodyRadius * 1.08,
      frontCapLength,
      16,
    ),
    part.visual.color,
    options,
    "thruster-front-cap",
  );
  frontCap.position.z = sz * 0.46;
  frontCap.rotation.x = Math.PI / 2;

  const nozzleLength = sz * 0.32;
  const nozzleFrontZ = -sz * 0.1;
  const nozzleExitZ = nozzleFrontZ - nozzleLength;
  const nozzleExitRadius = radialSize * 0.44;
  const nozzle = addMesh(
    group,
    new THREE.CylinderGeometry(
      bodyRadius * 0.72,
      nozzleExitRadius,
      nozzleLength,
      16,
    ),
    "#3a4249",
    options,
    "thruster-nozzle",
  );
  nozzle.position.z = nozzleFrontZ - nozzleLength / 2;
  nozzle.rotation.x = Math.PI / 2;

  const rim = addMesh(
    group,
    new THREE.TorusGeometry(
      nozzleExitRadius * 0.88,
      radialSize * 0.055,
      8,
      16,
    ),
    "#c3cdd1",
    options,
    "thruster-nozzle-rim",
  );
  rim.position.z = nozzleExitZ;

  const emitterDepth = sz * 0.035;
  const emitter = addMesh(
    group,
    new THREE.CylinderGeometry(
      nozzleExitRadius * 0.58,
      nozzleExitRadius * 0.58,
      emitterDepth,
      12,
    ),
    "#ffb347",
    options,
    "thruster-emitter",
    { emissive: "#ff6f32", emissiveIntensity: 1.2 },
  );
  emitter.position.z = nozzleExitZ + emitterDepth / 2;
  emitter.rotation.x = Math.PI / 2;

  return group;
}

export function createPartVisual(
  part: Part,
  options: PartVisualOptions = {},
): THREE.Group {
  switch (part.definitionId) {
    case "Hinge":
      return createHingeVisual(part, options);
    case "Thruster":
      return createThrusterVisual(part, options);
    case "Wheel":
      return createWheelVisual(part, options);
    case "Panel":
    case "Block":
    case "Motor":
    case "Steering":
    case "Wing":
      return createBasicVisual(part, options);
  }
}
