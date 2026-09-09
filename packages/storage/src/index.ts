import { parseProject, type Project } from "../../project-schema/src/index";
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function saveProject(storage: KeyValueStorage, p: Project) {
  storage.setItem("machine-studio.project", JSON.stringify(parseProject(p)));
}
export function loadProject(storage: KeyValueStorage) {
  const raw = storage.getItem("machine-studio.project");
  return raw ? parseProject(JSON.parse(raw)) : null;
}
export interface AssetStorage {
  save(id: string, data: Uint8Array): Promise<void>;
  load(id: string): Promise<Uint8Array>;
  exists(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  getUrl(id: string): string;
}
