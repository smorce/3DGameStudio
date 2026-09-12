import {
  parseProject,
  activeCourse,
  type ControlBinding,
  type Project,
  type Vec3,
} from "../../project-schema/src/index";
import { ThreeRenderer } from "../../renderer-three/src/index";
import { RapierPhysics } from "../../physics-rapier/src/index";
import { CourseProgress } from "../../course-system/src/index";
import type {
  MachineTelemetrySample,
  RuntimeTelemetry,
} from "../../runtime-telemetry/src/index";
export type ControlValues = Record<string, number>;
const clampControl = (value: number) =>
  Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
export function aggregateControlChannels(
  bindings: readonly ControlBinding[],
  activeKeys: ReadonlySet<string>,
  analog: Readonly<Record<string, number>> = {},
): ControlValues {
  const values: ControlValues = { ...analog };
  for (const binding of bindings)
    if (activeKeys.has(binding.key))
      values[binding.channel] = (values[binding.channel] ?? 0) + binding.value;
  for (const channel of Object.keys(values))
    values[channel] = clampControl(values[channel]);
  return values;
}
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
  private dropUntil = 0;
  private dropPromise?: Promise<void>;
  private resolveDrop?: () => void;
  mode: "EDIT" | "PLAY" | "DROP" = "EDIT";
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
    // PLAY/DROP中の再読込はドロップ演出を経由せず即Editへ戻す。
    // DROPのまま物理を破棄するとtickが破棄済みWorldをstepして停止するため。
    this.mode = "EDIT";
    this.blur();
    this.course = undefined;
    this.physics.dispose();
    this.renderer.load(this.project);
    this.resolveDropWaiter();
  }
  async play(options: { courseId?: string | null } = {}) {
    if (!this.project || this.mode !== "EDIT") return;
    const ticket = ++this.ticket;
    const course = activeCourse(this.project, options.courseId);
    await this.physics.load(structuredClone(this.project), {
      courseId: course?.id ?? null,
    });
    if (this.disposed || ticket !== this.ticket) return;
    this.course = course ? new CourseProgress(course) : undefined;
    this.renderer.load(this.project, { courseId: course?.id ?? null });
    if (this.course) this.physics.respawn(this.course.course.start);
    this.mode = "PLAY";
    this.accumulator = 0;
  }
  stop(): Promise<void> {
    if (this.mode === "DROP") return this.dropPromise ?? Promise.resolve();
    if (this.mode === "EDIT") return Promise.resolve();
    this.ticket++;
    this.blur();
    if (!this.project) {
      this.mode = "EDIT";
      this.physics.dispose();
      return Promise.resolve();
    }
    const target = this.renderer.viewTarget;
    this.course = undefined;
    this.renderer.load(this.project);
    this.physics.respawn(target);
    this.mode = "DROP";
    this.dropUntil = performance.now() + 1200;
    this.accumulator = 0;
    this.dropPromise = new Promise<void>((resolve) => {
      this.resolveDrop = resolve;
    });
    return this.dropPromise;
  }
  private resolveDropWaiter() {
    const resolve = this.resolveDrop;
    this.resolveDrop = undefined;
    this.dropPromise = undefined;
    resolve?.();
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min((now - (this.last || now)) / 1000, 0.1);
    this.last = now;
    this.fps = dt ? Math.round(1 / dt) : 60;
    if (this.mode !== "EDIT" && !this.physics.world) this.mode = "EDIT";
    if (this.mode === "PLAY" || this.mode === "DROP") {
      const dropping = this.mode === "DROP";
      this.accumulator += dt;
      const pad = navigator.getGamepads?.()[0],
        machine = this.project?.machines[0],
        controls = aggregateControlChannels(
          dropping ? [] : (machine?.controlBindings ?? []),
          this.keys,
          dropping
            ? {}
            : {
                throttle: this.input.throttle - (pad?.axes[1] ?? 0),
                steering: this.input.steering - (pad?.axes[0] ?? 0),
              },
        );
      while (this.accumulator >= 1 / 60) {
        this.physics.step(controls);
        this.accumulator -= 1 / 60;
        const p = this.physics.poses().values().next().value?.position;
        if (p && !dropping) {
          this.course?.update(p, 1 / 60);
          if (p[1] < -20) this.physics.respawn(this.course?.respawn);
        }
      }
      this.renderer.render(
        this.physics.poses(),
        dropping ? 0 : (controls.throttle ?? 0),
      );
      if (dropping && now >= this.dropUntil) {
        this.physics.dispose();
        if (this.project) this.renderer.restoreEditTransforms(this.project);
        this.mode = "EDIT";
        this.accumulator = 0;
        this.resolveDropWaiter();
      }
    } else this.renderer.render();
    this.onFrame?.();
    this.frame = requestAnimationFrame(this.tick);
  };
  get position(): Vec3 {
    return this.physics.poses().values().next().value?.position ?? [0, 0, 0];
  }
  get telemetry(): RuntimeTelemetry {
    return this.physics.telemetry;
  }
  get currentTelemetry(): MachineTelemetrySample | undefined {
    return this.telemetry.current(this.project?.machines[0]?.id);
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
    this.resolveDropWaiter();
  }
}
