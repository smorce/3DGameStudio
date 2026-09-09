import { uid, type Course, type Vec3 } from "../../project-schema/src/index";
export function createCourse(name = "はじめてのコース"): Course {
  return {
    id: uid(),
    name,
    path: [
      [0, 0.06, 0],
      [0, 0.06, 15],
      [10, 0.06, 30],
    ],
    checkpoints: [{ id: uid(), position: [0, 1, 15] }],
    start: [0, 1, 0],
    goal: [10, 1, 30],
    obstacles: [],
    respawnPoints: [[0, 2, 0]],
    metadata: {},
  };
}
export class CourseProgress {
  next = 0;
  finished = false;
  elapsed = 0;
  started = false;
  constructor(readonly course: Course) {}
  update(position: Vec3, dt: number) {
    const near = (p: Vec3) =>
      Math.hypot(position[0] - p[0], position[2] - p[2]) < 3;
    if (!this.started && near(this.course.start)) this.started = true;
    if (!this.started || this.finished) return;
    this.elapsed += dt;
    const c = this.course.checkpoints[this.next];
    if (c && near(c.position)) this.next++;
    if (this.next === this.course.checkpoints.length && near(this.course.goal))
      this.finished = true;
  }
  get respawn() {
    return this.next > 0
      ? this.course.checkpoints[this.next - 1].position
      : this.course.start;
  }
}
export function courseTemplate(
  kind: "straight" | "circuit" | "offroad" | "island" | "air",
): Course {
  const c = createCourse(
    {
      straight: "一本道",
      circuit: "サーキット",
      offroad: "オフロード",
      island: "島一周",
      air: "空中コース",
    }[kind],
  );
  if (kind === "circuit" || kind === "island")
    c.path = Array.from({ length: 25 }, (_, i) => {
      const angle = (i / 24) * Math.PI * 2;
      return [Math.sin(angle) * 20, 0.1, 20 - Math.cos(angle) * 20] as Vec3;
    });
  else if (kind === "air")
    c.path = [
      [0, 2, 0],
      [0, 5, 15],
      [8, 7, 30],
      [0, 3, 45],
    ];
  else if (kind === "offroad")
    c.path = [
      [0, 0.1, 0],
      [5, 0.1, 12],
      [-5, 0.1, 24],
      [0, 0.1, 36],
    ];
  c.start = c.path[0];
  c.goal = c.path[c.path.length - 1];
  c.checkpoints = [
    { id: uid(), position: c.path[Math.floor(c.path.length / 2)] },
  ];
  return c;
}
