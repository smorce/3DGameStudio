import type { CommandBus, Command } from "../../command-system/src/index";
export interface StudioPlugin {
  id: string;
  activate(context: { execute: (command: Command) => void }): () => void;
}
export function installPlugin(plugin: StudioPlugin, bus: CommandBus) {
  return plugin.activate({ execute: (c) => bus.execute(c) });
}
