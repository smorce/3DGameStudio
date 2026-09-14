import {
  parseProject,
  activeCourse,
  type ControlBinding,
  type Project,
  type Vec3,
} from "../../project-schema/src/index";
import { ThreeRenderer } from "../../renderer-three/src/index";
import {
  RapierPhysics,
  type PhysicsRenderState,
} from "../../physics-rapier/src/index";
import { CourseProgress } from "../../course-system/src/index";
import { WorldRuntime } from "../../world-system/src/index";
import type {
  MachineTelemetrySample,
  RuntimeTelemetry,
} from "../../runtime-telemetry/src/index";
import { FrameProfiler } from "./frame-profiler";
import { shiftPhysicsRenderState } from "./interpolation";
import { commitWorldOriginShift } from "./rebase";
export type ControlValues = Record<string, number>;
export { commitWorldOriginShift } from "./rebase";
export { shiftPhysicsRenderState, shiftPose } from "./interpolation";
export { FrameProfiler } from "./frame-profiler";
export type { FrameTimingSnapshot } from "./frame-profiler";

export interface FrameSpikeSample {
  timeMs: number;
  positionZ: number;
  frameTimeMs: number;
  physicsStepMs: number;
  renderMs: number;
  chunksCreated: number;
  renderCommitMs: number;
  physicsCommitMs: number;
  normalsMs: number;
  syncGenDelta: number;
}

const SPIKE_RING = 32;
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
  worldRuntime?: WorldRuntime;
  private project?: Project;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private previousRenderState?: PhysicsRenderState;
  private currentRenderState?: PhysicsRenderState;
  private interpolationAlpha = 1;
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
  private frameTimeMs = 0;
  private physicsStepMs = 0;
  private renderMs = 0;
  private spikeCount20ms = 0;
  private spikeCount33ms = 0;
  private readonly spikeRing: FrameSpikeSample[] = [];
  private lastSyncGen = 0;
  readonly frameProfiler = new FrameProfiler(900);
  private keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.matches("input,textarea,select")) return;
    if (
      ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
        e.code,
      )
    )
      e.preventDefault();
    this.keys.add(e.code);
    if (e.code === "KeyR") void this.respawnWithPhysicsReady();
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
    this.frameProfiler.startLongFrameObserver();
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
    this.previousRenderState = undefined;
    this.currentRenderState = undefined;
    this.physics.dispose();
    this.worldRuntime?.dispose();
    this.worldRuntime = new WorldRuntime(this.project.world, {
      forceSyncWorkers: typeof Worker === "undefined",
    });
    this.worldRuntime.setPlayHotPath(false);
    this.renderer.load(this.project, { world: this.worldRuntime });
    this.resolveDropWaiter();
  }
  async play(options: { courseId?: string | null } = {}) {
    if (!this.project || this.mode !== "EDIT") return;
    const ticket = ++this.ticket;
    const course = activeCourse(this.project, options.courseId);
    this.worldRuntime?.reload(this.project.world);
    const world = this.worldRuntime ?? new WorldRuntime(this.project.world);
    this.worldRuntime = world;
    world.setPlayHotPath(false);
    const start = course?.start ??
      this.project.world.spawnPoints[0] ?? [0, 2, 0];
    await world.ensurePhysicsReady(start, 1);
    if (this.disposed || ticket !== this.ticket) return;
    await this.physics.load(structuredClone(this.project), {
      courseId: course?.id ?? null,
      world,
    });
    if (this.disposed || ticket !== this.ticket) return;
    this.course = course ? new CourseProgress(course) : undefined;
    this.renderer.load(this.project, {
      courseId: course?.id ?? null,
      world,
    });
    this.renderer.setEditMachineLift(false);
    if (this.course) this.physics.respawn(this.course.course.start);
    world.setPlayHotPath(true);
    this.mode = "PLAY";
    this.accumulator = 0;
    this.previousRenderState = undefined;
    this.currentRenderState = undefined;
    this.interpolationAlpha = 1;
    this.frameProfiler.reset();
  }
  private async respawnWithPhysicsReady() {
    const point = this.course?.respawn;
    if (point && this.worldRuntime) {
      this.worldRuntime.setPlayHotPath(false);
      await this.worldRuntime.ensurePhysicsReady(point, 1);
      this.worldRuntime.setPlayHotPath(true);
    }
    this.physics.respawn(point);
  }
  stop(): Promise<void> {
    if (this.mode === "DROP") return this.dropPromise ?? Promise.resolve();
    if (this.mode === "EDIT") return Promise.resolve();
    this.ticket++;
    this.blur();
    this.worldRuntime?.setPlayHotPath(false);
    if (!this.project) {
      this.mode = "EDIT";
      this.physics.dispose();
      return Promise.resolve();
    }
    const target = this.renderer.viewTarget;
    this.course = undefined;
    this.worldRuntime?.reload(this.project.world);
    this.renderer.load(this.project, { world: this.worldRuntime });
    this.renderer.setEditMachineLift(false);
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
    const frameStarted = performance.now();
    const dt = Math.min((now - (this.last || now)) / 1000, 0.1);
    this.last = now;
    this.fps = dt ? Math.round(1 / dt) : 60;
    if (this.mode !== "EDIT" && !this.physics.world) this.mode = "EDIT";
    let velocity: Vec3 | undefined;
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
      const physicsStarted = performance.now();
      while (this.accumulator >= 1 / 60) {
        // Physics Critical Ready は Fixed Step 境界で Commit する。
        this.worldRuntime?.commitPhysicsCriticalReady();
        // P0 は Rapier Collider まで Step 前に入れる。
        this.physics.commitCriticalColliders();
        this.physics.step(controls);
        this.worldRuntime?.commitPhysicsCriticalReady();
        this.physics.commitCriticalColliders();
        const next = this.physics.renderState();
        this.previousRenderState = this.currentRenderState ?? next;
        this.currentRenderState = next;
        const simulation = next.poses.values().next().value?.position;
        const global = simulation
          ? (this.worldRuntime?.toGlobal(simulation) ?? simulation)
          : undefined;
        if (global && this.worldRuntime) {
          const plan = commitWorldOriginShift(
            this.worldRuntime,
            this.physics,
            this.renderer,
            global,
          );
          if (plan) {
            this.currentRenderState = this.physics.renderState();
            if (this.previousRenderState)
              this.previousRenderState = shiftPhysicsRenderState(
                this.previousRenderState,
                plan.delta,
              );
          }
        }
        if (global && !dropping) {
          this.course?.update(global, 1 / 60);
          if (global[1] < -20) void this.respawnWithPhysicsReady();
        }
        this.accumulator -= 1 / 60;
      }
      this.physics.flushStreaming();
      this.physicsStepMs = performance.now() - physicsStarted;
      const body = this.physics.vehicles[0]?.body;
      const linvel = body?.linvel();
      if (linvel) velocity = [linvel.x, linvel.y, linvel.z];
      this.interpolationAlpha = this.accumulator / (1 / 60);
      const renderStarted = performance.now();
      this.renderer.render(
        this.currentRenderState ?? this.physics.renderState(),
        dropping ? 0 : (controls.throttle ?? 0),
        {
          previous: this.previousRenderState,
          alpha: this.interpolationAlpha,
          dt,
          velocity,
        },
      );
      this.renderMs = performance.now() - renderStarted;
      if (dropping && now >= this.dropUntil) {
        this.physics.dispose();
        if (this.project) this.renderer.restoreEditTransforms(this.project);
        this.mode = "EDIT";
        this.accumulator = 0;
        this.resolveDropWaiter();
      }
    } else {
      this.physicsStepMs = 0;
      const renderStarted = performance.now();
      this.renderer.render();
      this.renderMs = performance.now() - renderStarted;
    }
    this.worldRuntime?.pumpGeneration(2, 2);
    this.frameTimeMs = performance.now() - frameStarted;
    this.frameProfiler.record(this.frameTimeMs);
    this.recordFrameSpike(now);
    this.onFrame?.();
    this.frame = requestAnimationFrame(this.tick);
  };

  private recordFrameSpike(now: number) {
    const world = this.worldRuntime?.stats(this.position);
    const syncGen = world?.syncGenerationCount ?? 0;
    const syncGenDelta = Math.max(0, syncGen - this.lastSyncGen);
    this.lastSyncGen = syncGen;
    // 毎Frame の root.traverse を避ける（Studio UI はフル stats を 250ms 間隔で取得）。
    const renderStats = this.renderer.fastStats;
    const physicsStats = this.physics.stats;
    const chunksCreated =
      (renderStats.renderChunksCreated ?? 0) +
      (physicsStats.physicsChunksCreated ?? 0);
    if (this.frameTimeMs > 20) this.spikeCount20ms++;
    if (this.frameTimeMs > 33) this.spikeCount33ms++;
    if (this.frameTimeMs > 20) {
      this.spikeRing.push({
        timeMs: now,
        positionZ: this.position[2],
        frameTimeMs: this.frameTimeMs,
        physicsStepMs: this.physicsStepMs,
        renderMs: this.renderMs,
        chunksCreated,
        renderCommitMs: renderStats.renderCommitMs ?? 0,
        physicsCommitMs: physicsStats.physicsCommitMs ?? 0,
        normalsMs: renderStats.normalsMs ?? 0,
        syncGenDelta,
      });
      if (this.spikeRing.length > SPIKE_RING) this.spikeRing.shift();
    }
  }
  get recentSpikes(): readonly FrameSpikeSample[] {
    return this.spikeRing;
  }
  get position(): Vec3 {
    const sim = this.physics.poses().values().next().value?.position ?? [
      0, 0, 0,
    ];
    return this.worldRuntime?.toGlobal(sim) ?? sim;
  }
  get telemetry(): RuntimeTelemetry {
    return this.physics.telemetry;
  }
  get currentTelemetry(): MachineTelemetrySample | undefined {
    return this.telemetry.current(this.project?.machines[0]?.id);
  }
  get stats() {
    const world = this.worldRuntime?.stats(this.position);
    const sample = this.currentTelemetry;
    const chunk = world?.currentChunk?.split(",").map(Number) ?? [0, 0];
    const frameTiming = this.frameProfiler.snapshot(this.frameTimeMs);
    return {
      fps: this.fps,
      ...this.renderer.stats,
      ...this.physics.stats,
      cachedChunks: world?.cachedChunks ?? 0,
      preparedChunks: world?.preparedChunks ?? 0,
      loadedRenderChunks: world?.loadedRenderChunks ?? 0,
      loadedPhysicsChunks: world?.loadedPhysicsChunks ?? 0,
      pendingGenerationCount: world?.pendingGenerationCount ?? 0,
      pendingQueueCount: world?.pendingQueueCount ?? 0,
      readyRenderCount: world?.readyRenderCount ?? 0,
      readyPhysicsCount: world?.readyPhysicsCount ?? 0,
      workerQueued: world?.workerQueued ?? 0,
      workerInFlight: world?.workerInFlight ?? 0,
      workerCount: world?.workerCount ?? 0,
      generationLatencyMs: world?.generationLatencyMs ?? 0,
      maxGenerationLatencyMs: world?.maxGenerationLatencyMs ?? 0,
      lastCommitBatchMs: world?.lastCommitBatchMs ?? 0,
      streamingRequestMs: world?.streamingRequestMs ?? 0,
      streamingCommitMs: world?.streamingCommitMs ?? 0,
      renderChunkCommitMs: world?.renderChunkCommitMs ?? 0,
      physicsChunkCommitMs: world?.physicsChunkCommitMs ?? 0,
      workerGenerationMs: world?.workerGenerationMs ?? 0,
      cacheHitRate: world?.cacheHitRate ?? 1,
      rebaseCount: world?.rebaseCount ?? 0,
      syncGenerationCount: world?.syncGenerationCount ?? 0,
      syncFallbackCount: world?.syncFallbackCount ?? 0,
      syncGenerationFallbackCount: world?.syncGenerationFallbackCount ?? 0,
      prefetchGenerationCount: world?.prefetchGenerationCount ?? 0,
      cancelledJobs: world?.cancelledJobs ?? 0,
      frameTimeMs: this.frameTimeMs,
      physicsStepMs: this.physicsStepMs,
      renderMs: this.renderMs,
      spikeCount20ms: this.spikeCount20ms,
      spikeCount33ms: this.spikeCount33ms,
      frameP50Ms: frameTiming.p50Ms,
      frameP95Ms: frameTiming.p95Ms,
      frameP99Ms: frameTiming.p99Ms,
      frameMaxMs: frameTiming.maxMs,
      frameOver16_7: frameTiming.over16_7,
      frameOver33_3: frameTiming.over33_3,
      frameOver50: frameTiming.over50,
      worldOriginX: world?.worldOrigin[0] ?? 0,
      worldOriginY: world?.worldOrigin[1] ?? 0,
      worldOriginZ: world?.worldOrigin[2] ?? 0,
      simulationX: sample?.simulationPosition?.[0] ?? 0,
      simulationY: sample?.simulationPosition?.[1] ?? 0,
      simulationZ: sample?.simulationPosition?.[2] ?? 0,
      chunkX: chunk[0] ?? 0,
      chunkZ: chunk[1] ?? 0,
      worldSpeedMps: sample?.worldSpeedMps ?? 0,
      maxJointAnchorErrorM: this.physics.maxJointAnchorErrorM,
      interpolationAlpha: this.interpolationAlpha,
      shadowTargetX: this.renderer.shadowState.target[0],
      shadowTargetY: this.renderer.shadowState.target[1],
      shadowTargetZ: this.renderer.shadowState.target[2],
      shadowLightX: this.renderer.shadowState.light[0],
      shadowLightY: this.renderer.shadowState.light[1],
      shadowLightZ: this.renderer.shadowState.light[2],
    };
  }
  dispose() {
    this.disposed = true;
    this.ticket++;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    this.frameProfiler.dispose();
    this.physics.dispose();
    this.renderer.dispose();
    this.worldRuntime?.dispose();
    this.resolveDropWaiter();
  }
}
