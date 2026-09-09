import { z } from "zod";
import {
  parseProject,
  projectSchema,
  machineSchema,
  partSchema,
  courseSchema,
  worldSchema,
  assetSchema,
  entitySchema,
  connectionSchema,
  vec3,
  uid,
  type Project,
} from "../../project-schema/src/index";
import { attachPart } from "../../machine-system/src/index";
import { quaternion, multiply, rotate } from "../../machine-system/src/math";
import { brushTerrain } from "../../terrain-system/src/index";
const id = z.string();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project.create"), project: projectSchema }),
  z.object({
    type: z.literal("part.connection.update"),
    machineId: id,
    connectionId: id,
    patch: connectionSchema.omit({ id: true }).partial(),
  }),
  z.object({
    type: z.literal("asset.update"),
    entityId: id,
    patch: entitySchema.omit({ id: true }).partial(),
  }),
  z.object({ type: z.literal("machine.create"), machine: machineSchema }),
  z.object({ type: z.literal("machine.delete"), machineId: id }),
  z.object({
    type: z.literal("part.add"),
    machineId: id,
    part: partSchema,
    slot: z.number().int().min(0).max(3).optional(),
  }),
  z.object({ type: z.literal("part.remove"), machineId: id, partId: id }),
  z.object({
    type: z.enum(["part.move", "part.rotate"]),
    machineId: id,
    partId: id,
    value: vec3,
  }),
  z.object({
    type: z.literal("part.update"),
    machineId: id,
    partId: id,
    patch: partSchema.omit({ id: true, definitionId: true }).partial(),
  }),
  z.object({
    type: z.literal("part.connect"),
    machineId: id,
    connection: connectionSchema,
  }),
  z.object({
    type: z.literal("part.disconnect"),
    machineId: id,
    connectionId: id,
  }),
  z.object({ type: z.literal("world.create"), world: worldSchema }),
  z.object({
    type: z.literal("world.update"),
    patch: worldSchema.omit({ id: true }).partial(),
  }),
  z.object({
    type: z.enum([
      "terrain.raise",
      "terrain.lower",
      "terrain.flatten",
      "terrain.paint",
      "terrain.smooth",
      "terrain.noise",
    ]),
    x: z.number().finite(),
    z: z.number().finite(),
    radius: z.number().positive().max(200),
    strength: z.number().positive().max(20),
    color: z.string().optional(),
  }),
  z.object({ type: z.literal("asset.import"), asset: assetSchema }),
  z.object({ type: z.literal("asset.place"), entity: entitySchema }),
  z.object({ type: z.literal("asset.remove"), entityId: id }),
  z.object({ type: z.literal("course.activate"), courseId: id.nullable() }),
  z.object({ type: z.literal("course.create"), course: courseSchema }),
  z.object({
    type: z.literal("course.path.update"),
    courseId: id,
    path: z.array(vec3),
  }),
  z.object({
    type: z.literal("course.checkpoint.add"),
    courseId: id,
    position: vec3,
    checkpointId: id.optional(),
  }),
  z.object({
    type: z.literal("course.checkpoint.remove"),
    courseId: id,
    checkpointId: id,
  }),
  z.object({
    type: z.enum(["course.start.set", "course.goal.set"]),
    courseId: id,
    position: vec3,
  }),
  z.object({
    type: z.literal("course.update"),
    courseId: id,
    patch: courseSchema.omit({ id: true }).partial(),
  }),
  z.object({
    type: z.literal("mission.create"),
    mission: z.object({
      id,
      courseId: id,
      name: z.string(),
      targetSeconds: z.number().positive(),
    }),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
function apply(p: Project, c: Command) {
  const machine = () => {
    const m = p.machines.find((m) => "machineId" in c && m.id === c.machineId);
    if (!m) throw new Error("Machine not found");
    return m;
  };
  const part = () => {
    const a = machine().parts.find((a) => "partId" in c && a.id === c.partId);
    if (!a) throw new Error("Part not found");
    return a;
  };
  const course = () => {
    const a = p.courses.find((a) => "courseId" in c && a.id === c.courseId);
    if (!a) throw new Error("Course not found");
    return a;
  };
  const changeTransform = (value: ReturnType<typeof part>["transform"]) => {
    const root = part(),
      before = structuredClone(root.transform),
      ids = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const connection of machine().connections)
        if (ids.has(connection.a) && !ids.has(connection.b)) {
          ids.add(connection.b);
          changed = true;
        }
    }
    const old = quaternion(before.rotation),
      inverse: [number, number, number, number] = [
        -old[0],
        -old[1],
        -old[2],
        old[3],
      ],
      q = quaternion(value.rotation);
    for (const child of machine().parts) {
      if (child.id === root.id || !ids.has(child.id)) continue;
      const local = rotate(
        child.transform.position.map((n, i) => n - before.position[i]) as [
          number,
          number,
          number,
        ],
        inverse,
      ).map((n, i) => (n / before.scale[i]) * value.scale[i]) as [
        number,
        number,
        number,
      ];
      child.transform.position = rotate(local, q).map(
        (n, i) => n + value.position[i],
      ) as [number, number, number];
      if (value.rotation.some((n, i) => n !== before.rotation[i])) {
        const rot = multiply(
          multiply(q, inverse),
          quaternion(child.transform.rotation),
        );
        const [x, y, z, w] = rot;
        child.transform.rotation = [
          Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)),
          Math.asin(Math.max(-1, Math.min(1, 2 * (x * z + y * w)))),
          Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z)),
        ];
      }
    }
    root.transform = value;
  };
  switch (c.type) {
    case "project.create":
      Object.assign(p, c.project);
      break;
    case "asset.update": {
      const entity = p.world.entities.find((e) => e.id === c.entityId);
      if (!entity) throw new Error("Entity not found");
      Object.assign(entity, c.patch);
      break;
    }
    case "part.connection.update": {
      const connection = machine().connections.find(
        (a) => a.id === c.connectionId,
      );
      if (!connection) throw new Error("Connection not found");
      Object.assign(connection, c.patch);
      break;
    }

    case "machine.create":
      p.machines.push(c.machine);
      break;
    case "machine.delete":
      p.machines = p.machines.filter((m) => m.id !== c.machineId);
      break;
    case "part.add":
      attachPart(machine(), c.part, c.slot);
      break;
    case "part.remove": {
      const m = machine();
      m.parts = m.parts.filter((a) => a.id !== c.partId);
      m.connections = m.connections.filter(
        (a) => a.a !== c.partId && a.b !== c.partId,
      );
      break;
    }
    case "part.move":
      changeTransform({ ...part().transform, position: c.value });
      break;
    case "part.rotate":
      changeTransform({ ...part().transform, rotation: c.value });
      break;
    case "part.update":
      if (c.patch.transform) changeTransform(c.patch.transform);
      Object.assign(part(), c.patch);
      break;
    case "part.connect":
      machine().connections.push(c.connection);
      break;
    case "part.disconnect":
      machine().connections = machine().connections.filter(
        (a) => a.id !== c.connectionId,
      );
      break;
    case "world.create":
      p.world = c.world;
      break;
    case "world.update":
      Object.assign(p.world, c.patch);
      break;
    case "terrain.raise":
    case "terrain.lower":
    case "terrain.flatten":
    case "terrain.paint":
    case "terrain.smooth":
    case "terrain.noise":
      brushTerrain(
        p.world.terrain,
        c.type.split(".")[1] as Parameters<typeof brushTerrain>[1],
        c.x,
        c.z,
        c.radius,
        c.strength,
        c.color,
      );
      break;
    case "asset.import":
      if (!p.assets.some((a) => a.id === c.asset.id)) p.assets.push(c.asset);
      break;
    case "asset.place":
      p.world.entities.push(c.entity);
      break;
    case "asset.remove":
      p.world.entities = p.world.entities.filter((a) => a.id !== c.entityId);
      break;
    case "course.activate":
      if (c.courseId !== null) course();
      p.settings.activeCourseId = c.courseId;
      break;
    case "course.create":
      p.courses.push(c.course);
      p.settings.activeCourseId = c.course.id;
      break;
    case "course.path.update":
      course().path = c.path;
      break;
    case "course.checkpoint.add":
      course().checkpoints.push({
        id: c.checkpointId ?? uid(),
        position: c.position,
      });
      break;
    case "course.checkpoint.remove":
      course().checkpoints = course().checkpoints.filter(
        (a) => a.id !== c.checkpointId,
      );
      break;
    case "course.start.set":
      course().start = c.position;
      break;
    case "course.goal.set":
      course().goal = c.position;
      break;
    case "course.update":
      Object.assign(course(), c.patch);
      break;
    case "mission.create":
      p.missions.push(c.mission);
      break;
  }
}
export class CommandBus {
  private state: Project;
  private past: { before: Project; after: Project; commands: Command[] }[] = [];
  private future: typeof this.past = [];
  private listeners = new Set<() => void>();
  constructor(project: Project) {
    this.state = parseProject(project);
  }
  get project() {
    return structuredClone(this.state);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get history() {
    return this.past.map((h) => structuredClone(h.commands));
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private notify() {
    this.listeners.forEach((fn) => fn());
  }
  execute(command: Command) {
    this.batch([command]);
  }
  batch(commands: Command[]) {
    const parsed = commands.map((c) =>
        commandSchema.parse(
          c.type === "course.checkpoint.add"
            ? { ...c, checkpointId: c.checkpointId ?? uid() }
            : c,
        ),
      ),
      draft = structuredClone(this.state);
    for (const c of parsed) apply(draft, c);
    const after = parseProject(draft);
    this.past.push({ before: this.state, after, commands: parsed });
    if (this.past.length > 100) this.past.shift();
    this.state = after;
    this.future = [];
    this.notify();
  }
  undo() {
    const h = this.past.pop();
    if (h) {
      this.future.push(h);
      this.state = h.before;
      this.notify();
    }
  }
  redo() {
    const h = this.future.pop();
    if (h) {
      this.past.push(h);
      this.state = h.after;
      this.notify();
    }
  }
  load(input: unknown) {
    const p = parseProject(input);
    this.state = p;
    this.past = [];
    this.future = [];
    this.notify();
  }
}
