import { Engine } from "../../../packages/engine-core/src/index";
import {
  emptyProject,
  parseProject,
} from "../../../packages/project-schema/src/index";
import { carTemplate } from "../../../packages/machine-system/src/index";
import { speedKphFromMps } from "../../../packages/runtime-telemetry/src/index";
const engine = new Engine(document.querySelector("canvas")!);
const p = emptyProject();
p.machines.push(carTemplate());
const speedHud = document.getElementById("speed-hud")!,
  speedHudValue = document.getElementById("speed-hud-value")!;
engine.onFrame = () => {
  const playing = engine.mode === "PLAY";
  speedHud.hidden = !playing;
  if (playing)
    speedHudValue.textContent = `${Math.round(
      speedKphFromMps(engine.currentTelemetry?.worldSpeedMps ?? 0),
    )} km/h`;
};
await engine.load(p);
document.getElementById("play")!.onclick = () => {
  engine.play().catch((e) => {
    document.getElementById("status")!.textContent = String(e);
  });
};
document.getElementById("file")!.onchange = async (e) => {
  try {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await engine.load(parseProject(JSON.parse(await file.text())));
  } catch (error) {
    document.getElementById("status")!.textContent = String(error);
  }
};
