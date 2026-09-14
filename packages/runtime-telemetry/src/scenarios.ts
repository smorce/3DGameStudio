/** CLI / Playwright / Agent API 共有の Scenario 定義。実行ロジックは含まない。 */

export interface ScenarioTimelineSegment {
  fromStep: number;
  toStep: number;
  controls: Record<string, number>;
}

export type ScenarioAssertionId =
  | "forward-speed-positive"
  | "world-displacement-forward"
  | "no-large-lateral-drift"
  | "stable-takeoff-detected"
  | "turn-left-yaw"
  | "turn-right-yaw"
  | "chunk-lifecycle-progress"
  | "streaming-under-load"
  | "streaming-during-turn"
  | "rebase-at-least-once"
  | "rebase-global-continuity"
  | "rebase-flight-continuity"
  | "camera-follow-samples"
  | "terrain-entry-safe";

export interface ObservationScenarioDefinition {
  id: string;
  description: string;
  seed: number;
  tags: string[];
  durationSteps: number;
  worldPreset: "airfield" | "grassland";
  enableWorldRuntime: boolean;
  /** Physics step ごとの machine sample を何 step おきに観測イベント化するか。 */
  sampleEverySteps: number;
  timeline: ScenarioTimelineSegment[];
  assertions: ScenarioAssertionId[];
}

const throttle = (value = 1) => ({ throttle: value });
const pitch = (value: number) => ({ pitch: value });
const turn = (value: number) => ({ turn: value, steering: value });

export const OBSERVATION_SCENARIOS: ObservationScenarioDefinition[] = [
  {
    id: "starter-plane-straight",
    description:
      "Starter Plane を前進入力で直進させ、速度・変位・姿勢を観測する",
    seed: 42,
    tags: ["starter-plane", "motion"],
    durationSteps: 360,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 5,
    timeline: [{ fromStep: 0, toStep: 360, controls: throttle(1) }],
    assertions: [
      "forward-speed-positive",
      "world-displacement-forward",
      "no-large-lateral-drift",
    ],
  },
  {
    id: "starter-plane-takeoff",
    description:
      "地上走行から安定離陸までを再現し findStableForwardTakeoff で判定する",
    seed: 42,
    tags: ["starter-plane", "takeoff"],
    durationSteps: 720,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 5,
    timeline: [
      { fromStep: 0, toStep: 300, controls: throttle(1) },
      {
        fromStep: 300,
        toStep: 420,
        controls: { ...throttle(1), ...pitch(1) },
      },
      { fromStep: 420, toStep: 720, controls: throttle(1) },
    ],
    assertions: ["stable-takeoff-detected"],
  },
  {
    id: "starter-plane-turn-left",
    description: "前進後に左旋回し、TurnMotion 相当の姿勢変化を検証する",
    seed: 42,
    tags: ["starter-plane", "turn", "left"],
    durationSteps: 600,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 5,
    timeline: [
      { fromStep: 0, toStep: 240, controls: throttle(1) },
      {
        fromStep: 240,
        toStep: 480,
        controls: { ...throttle(1), ...turn(-1) },
      },
      { fromStep: 480, toStep: 600, controls: throttle(1) },
    ],
    assertions: ["turn-left-yaw"],
  },
  {
    id: "starter-plane-turn-right",
    description: "前進後に右旋回し、左旋回と対称条件で比較可能にする",
    seed: 42,
    tags: ["starter-plane", "turn", "right"],
    durationSteps: 600,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 5,
    timeline: [
      { fromStep: 0, toStep: 240, controls: throttle(1) },
      {
        fromStep: 240,
        toStep: 480,
        controls: { ...throttle(1), ...turn(1) },
      },
      { fromStep: 480, toStep: 600, controls: throttle(1) },
    ],
    assertions: ["turn-right-yaw"],
  },
  {
    id: "world-streaming-forward",
    description: "Procedural World を前進し Chunk lifecycle を観測する",
    seed: 42,
    tags: ["world", "streaming"],
    durationSteps: 900,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 10,
    timeline: [{ fromStep: 0, toStep: 900, controls: throttle(1) }],
    assertions: ["chunk-lifecycle-progress"],
  },
  {
    id: "world-streaming-fast-flight",
    description:
      "高速移動で Worker / Ready / Commit 負荷と frame spike を観測する",
    seed: 42,
    tags: ["world", "streaming", "flight"],
    durationSteps: 1200,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 10,
    timeline: [
      { fromStep: 0, toStep: 240, controls: throttle(1) },
      {
        fromStep: 240,
        toStep: 360,
        controls: { ...throttle(1), ...pitch(1) },
      },
      { fromStep: 360, toStep: 1200, controls: throttle(1) },
    ],
    assertions: ["streaming-under-load"],
  },
  {
    id: "world-streaming-turn",
    description: "Streaming 中に旋回し request 変化と motion を同時観測する",
    seed: 42,
    tags: ["world", "streaming", "turn"],
    durationSteps: 900,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 10,
    timeline: [
      { fromStep: 0, toStep: 300, controls: throttle(1) },
      {
        fromStep: 300,
        toStep: 700,
        controls: { ...throttle(1), ...turn(-0.8) },
      },
      { fromStep: 700, toStep: 900, controls: throttle(1) },
    ],
    assertions: ["streaming-during-turn"],
  },
  {
    id: "origin-rebase-200m",
    description: "約200m以上移動し Origin Rebase を少なくとも1回発生させる",
    seed: 42,
    tags: ["rebase"],
    durationSteps: 1800,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 15,
    timeline: [{ fromStep: 0, toStep: 1800, controls: throttle(1) }],
    assertions: ["rebase-at-least-once", "rebase-global-continuity"],
  },
  {
    id: "origin-rebase-flight",
    description: "飛行中に Origin Rebase を発生させ連続性を検証する",
    seed: 42,
    tags: ["rebase", "flight"],
    durationSteps: 1800,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 15,
    timeline: [
      { fromStep: 0, toStep: 240, controls: throttle(1) },
      {
        fromStep: 240,
        toStep: 360,
        controls: { ...throttle(1), ...pitch(1) },
      },
      { fromStep: 360, toStep: 1800, controls: throttle(1) },
    ],
    assertions: ["rebase-at-least-once", "rebase-flight-continuity"],
  },
  {
    id: "camera-follow-turn",
    description: "旋回中の実Camera Follow probeと姿勢変化を記録する",
    seed: 42,
    tags: ["camera", "turn"],
    durationSteps: 600,
    worldPreset: "airfield",
    enableWorldRuntime: true,
    sampleEverySteps: 5,
    timeline: [
      { fromStep: 0, toStep: 200, controls: throttle(1) },
      {
        fromStep: 200,
        toStep: 500,
        controls: { ...throttle(1), ...turn(-1) },
      },
      { fromStep: 500, toStep: 600, controls: throttle(1) },
    ],
    assertions: ["camera-follow-samples", "turn-left-yaw"],
  },
  {
    id: "terrain-entry",
    description:
      "未準備寄り Terrain へ進入し collider / contact の順序を観測する",
    seed: 7,
    tags: ["terrain", "streaming"],
    durationSteps: 600,
    worldPreset: "grassland",
    enableWorldRuntime: true,
    sampleEverySteps: 5,
    timeline: [{ fromStep: 0, toStep: 600, controls: throttle(1) }],
    assertions: ["terrain-entry-safe"],
  },
];

export function listObservationScenarios() {
  return OBSERVATION_SCENARIOS.map((scenario) => ({
    ...scenario,
    tags: [...scenario.tags],
    timeline: scenario.timeline.map((segment) => ({
      ...segment,
      controls: { ...segment.controls },
    })),
    assertions: [...scenario.assertions],
  }));
}

export function getObservationScenario(id: string) {
  return OBSERVATION_SCENARIOS.find((scenario) => scenario.id === id);
}

export function requireObservationScenario(id: string) {
  const scenario = getObservationScenario(id);
  if (!scenario) throw new Error(`Unknown observation scenario: ${id}`);
  return scenario;
}
