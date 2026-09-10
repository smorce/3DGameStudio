import * as THREE from "three";
import type { Part } from "../../project-schema/src/index";

export interface PartVisualOptions {
  ghost?: boolean;
  opacity?: number;
  thrust?: number;
  motorPower?: number;
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

export function updateThrusterFlame(visual: THREE.Object3D, thrust: number) {
  const amount = Math.min(1, Math.abs(thrust));
  const visible = visual.userData.ghost !== true && amount > 0.01;
  visual.traverse((object) => {
    if (!object.userData.thrusterFlame) return;
    const baseLength = object.userData.baseLength as number,
      exhaustZ = object.userData.exhaustZ as number,
      lengthScale = 0.15 + amount * 0.85;
    object.visible = visible;
    object.scale.set(1, lengthScale, 1);
    object.position.z = exhaustZ - (baseLength * lengthScale) / 2;
  });
}

export function updateMotorActivity(visual: THREE.Object3D, power: number) {
  const amount = Math.min(1, Math.abs(power));
  const active = visual.userData.ghost !== true && amount > 0.01;
  visual.traverse((object) => {
    if (!object.userData.motorIndicator) return;
    object.visible = active;
    if (active) object.rotation.z += 0.12 + amount * 0.18;
    object.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        child.material.emissive.set(active ? "#ffd04a" : "#000000");
        child.material.emissiveIntensity = active ? 0.7 + amount * 1.3 : 0;
      }
    });
  });
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

function createMotorVisual(part: Part, options: PartVisualOptions) {
  const group = new THREE.Group();
  group.name = "motor-visual";
  group.userData.ghost = options.ghost === true;
  group.userData.outputAxis = [0, 0, 1];

  const [sx, sy, sz] = part.physics.size;
  const radialSize = Math.min(sx, sy);
  const bodyRadius = radialSize * 0.42;
  const bodyLength = sz * 0.58;
  const body = addMesh(
    group,
    new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyLength, 16),
    part.visual.color,
    options,
    "motor-body",
  );
  const bodyCenterZ = -sz * 0.08;
  body.position.z = bodyCenterZ;
  body.rotation.x = Math.PI / 2;

  const capDepth = sz * 0.08;
  const bodyFrontZ = bodyCenterZ + bodyLength / 2;
  const bodyRearZ = bodyCenterZ - bodyLength / 2;
  for (const [name, z, color] of [
    ["motor-rear-cap", bodyRearZ - capDepth / 2, "#35414a"],
    ["motor-front-cap", bodyFrontZ + capDepth / 2, "#35414a"],
  ] as const) {
    const cap = addMesh(
      group,
      new THREE.CylinderGeometry(
        bodyRadius * 1.06,
        bodyRadius * 1.06,
        capDepth,
        16,
      ),
      color,
      options,
      name,
    );
    cap.position.z = z;
    cap.rotation.x = Math.PI / 2;
  }

  const shaftRadius = radialSize * 0.12;
  const shaftLength = sz * 0.34;
  const shaftStart = bodyFrontZ + capDepth;
  const shaft = addMesh(
    group,
    new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12),
    "#c3cdd1",
    options,
    "motor-output-shaft",
  );
  shaft.position.z = shaftStart + shaftLength / 2;
  shaft.rotation.x = Math.PI / 2;

  const tipDepth = sz * 0.07;
  const tip = addMesh(
    group,
    new THREE.CylinderGeometry(
      shaftRadius * 1.35,
      shaftRadius * 1.35,
      tipDepth,
      12,
    ),
    "#eef4f2",
    options,
    "motor-output-tip",
  );
  tip.position.z = shaftStart + shaftLength + tipDepth / 2;
  tip.rotation.x = Math.PI / 2;

  for (const x of [-sx * 0.23, sx * 0.23]) {
    const mount = addMesh(
      group,
      new THREE.BoxGeometry(sx * 0.16, sy * 0.12, sz * 0.34),
      "#35414a",
      options,
      x < 0 ? "motor-mount-left" : "motor-mount-right",
    );
    mount.position.set(x, -sy * 0.43, -sz * 0.08);
  }

  const indicator = new THREE.Group();
  indicator.name = "motor-rotation-indicator";
  indicator.userData.motorIndicator = true;
  indicator.position.z = tip.position.z + tipDepth / 2 + radialSize * 0.1;
  const ringRadius = shaftRadius * 2.2;
  const ring = addMesh(
    indicator,
    new THREE.TorusGeometry(ringRadius, radialSize * 0.035, 8, 20),
    "#ffd04a",
    options,
    "motor-rotation-ring",
    { emissive: "#000000", emissiveIntensity: 0 },
  );
  ring.rotation.x = Math.PI / 2;
  const marker = addMesh(
    indicator,
    new THREE.BoxGeometry(radialSize * 0.1, radialSize * 0.1, radialSize * 0.1),
    "#fff1a8",
    options,
    "motor-rotation-marker",
    { emissive: "#000000", emissiveIntensity: 0 },
  );
  marker.position.x = ringRadius;
  group.add(indicator);
  updateMotorActivity(group, options.motorPower ?? 0);

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
  return group;
}

function createHingeVisual(part: Part, options: PartVisualOptions) {
  const group = new THREE.Group();
  group.name = "hinge-visual";
  group.userData.jointAxis = [1, 0, 0];
  group.userData.inputConnector = "hinge-input";
  group.userData.outputConnector = "hinge-output";

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

  const rotatingMountLength = sz * 0.42;
  const rotatingMount = addMesh(
    group,
    new THREE.BoxGeometry(sx * 0.52, sy * 0.36, rotatingMountLength),
    part.visual.color,
    options,
    "hinge-rotating-mount",
  );
  rotatingMount.position.z = rotatingMountLength / 2 + pinRadius * 0.65;

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
      new THREE.CylinderGeometry(
        pinRadius * 1.12,
        pinRadius * 1.12,
        capDepth,
        16,
      ),
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
  group.userData.ghost = options.ghost === true;
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
    new THREE.TorusGeometry(nozzleExitRadius * 0.88, radialSize * 0.055, 8, 16),
    "#c3cdd1",
    options,
    "thruster-nozzle-rim",
  );
  rim.position.z = nozzleExitZ;

  const flameLength = sz * 0.62;
  const flame = addMesh(
    group,
    new THREE.ConeGeometry(nozzleExitRadius * 0.72, flameLength, 10),
    "#ff8a32",
    options,
    "thruster-flame",
    { emissive: "#ff5a24", emissiveIntensity: 1.4 },
  );
  flame.rotation.x = -Math.PI / 2;
  flame.userData.thrusterFlame = true;
  flame.userData.baseLength = flameLength;
  flame.userData.exhaustZ = nozzleExitZ;

  const flameCoreLength = sz * 0.44;
  const flameCore = addMesh(
    group,
    new THREE.ConeGeometry(nozzleExitRadius * 0.38, flameCoreLength, 8),
    "#ffe08a",
    options,
    "thruster-flame-core",
    { emissive: "#ffd04a", emissiveIntensity: 1.8 },
  );
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.userData.thrusterFlame = true;
  flameCore.userData.baseLength = flameCoreLength;
  flameCore.userData.exhaustZ = nozzleExitZ;
  updateThrusterFlame(group, options.thrust ?? 0);

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
    case "Motor":
      return createMotorVisual(part, options);
    case "Wheel":
      return createWheelVisual(part, options);
    case "Panel":
    case "Block":
    case "Steering":
      return createBasicVisual(part, options);
  }
}
