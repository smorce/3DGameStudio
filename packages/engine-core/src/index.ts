import {
  parseProject,
  type Project,
  type Vec3,
} from "../../project-schema/src/index";
import { ThreeRenderer } from "../../renderer-three/src/index";
import { RapierPhysics } from "../../physics-rapier/src/index";
import { CourseProgress } from "../../course-system/src/index";
export class Engine {
  readonly renderer: ThreeRenderer;
  readonly physics = new RapierPhysics();
  private project?: Project;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private keys = new Set<string>();
  private disposed = false;
  private ticket = 0;
  mode: "EDIT" | "PLAY" = "EDIT";
  fps = 0;
  course?: CourseProgress;
  input = { throttle: 0, steering: 0 };
  onFrame?: () => void;
  private keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.matches("input,textarea,select")) return;
    if (
      ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
        e.code,
      )
    )
      e.preventDefault();
    this.keys.add(e.code);
    if (e.code === "KeyR") this.physics.respawn(this.course?.respawn);
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => {
    this.keys.clear();
    this.input = { throttle: 0, steering: 0 };
  };
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new ThreeRenderer(canvas);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
    this.frame = requestAnimationFrame(this.tick);
  }
  async load(project: Project) {
    const parsed = parseProject(project);
    this.ticket++;
    this.project = parsed;
    if (this.mode === "PLAY") this.stop();
    this.renderer.load(this.project);
  }
  async play() {
    if (!this.project || this.mode === "PLAY") return;
    const ticket = ++this.ticket;
    await this.physics.load(structuredClone(this.project));
    if (this.disposed || ticket !== this.ticket) {
      this.physics.dispose();
      return;
    }
    this.course = this.project.courses[0]
      ? new CourseProgress(this.project.courses[0])
      : undefined;
    if (this.course) this.physics.respawn(this.course.course.start);
    this.mode = "PLAY";
    this.accumulator = 0;
  }
  stop() {
    this.ticket++;
    this.mode = "EDIT";
    this.blur();
    this.physics.dispose();
    if (this.project) this.renderer.load(this.project);
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min((now - (this.last || now)) / 1000, 0.1);
    this.last = now;
    this.fps = dt ? Math.round(1 / dt) : 60;
    if (this.mode === "PLAY") {
      this.accumulator += dt;
      const pad = navigator.getGamepads?.()[0];
      const action = (name: string, fallback: string) =>
        this.keys.has(
          this.project?.machines[0]?.controlBindings.find(
            (b) => b.action === name,
          )?.key ?? fallback,
        );
      const throttle =
          this.input.throttle +
          (Number(action("forward", "KeyW") || this.keys.has("ArrowUp")) -
            Number(action("backward", "KeyS") || this.keys.has("ArrowDown"))) -
          (pad?.axes[1] ?? 0),
        steering =
          this.input.steering +
          Number(action("left", "KeyA") || this.keys.has("ArrowLeft")) -
          Number(action("right", "KeyD") || this.keys.has("ArrowRight")) -
          (pad?.axes[0] ?? 0);
      while (this.accumulator >= 1 / 60) {
        this.physics.step(
          Math.max(-1, Math.min(1, throttle)),
          Math.max(-1, Math.min(1, steering)),
          this.keys.has("Space"),
        );
        this.accumulator -= 1 / 60;
        const p = this.physics.poses().values().next().value?.position;
        if (p) {
          this.course?.update(p, 1 / 60);
          if (p[1] < -20) this.physics.respawn(this.course?.respawn);
        }
      }
      this.renderer.render(this.physics.poses());
    } else this.renderer.render();
    this.onFrame?.();
    this.frame = requestAnimationFrame(this.tick);
  };
  get position(): Vec3 {
    return this.physics.poses().values().next().value?.position ?? [0, 0, 0];
  }
  get stats() {
    return { fps: this.fps, ...this.renderer.stats, ...this.physics.stats };
  }
  dispose() {
    this.disposed = true;
    this.ticket++;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    this.physics.dispose();
    this.renderer.dispose();
  }
}
