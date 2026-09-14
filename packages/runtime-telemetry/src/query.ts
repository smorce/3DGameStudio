import type { TelemetryEvent, TelemetryEventType } from "./schema";

export interface ObservationQueryFilter {
  source?: string;
  name?: string;
  type?: TelemetryEventType | string;
  frame?: number;
  entityId?: string;
  chunkKey?: string;
  beforeMs?: number;
  afterMs?: number;
  /** name 一致イベント周辺に before/after を広げる基準。 */
  aroundName?: string;
  limit?: number;
}

/**
 * JSONL / メモリ上の TelemetryEvent をフィルタする。
 * 巨大ログを丸ごと読まず、必要部分だけ取り出すためのクエリ層。
 */
export function queryEvents(
  events: readonly TelemetryEvent[],
  filter: ObservationQueryFilter = {},
): TelemetryEvent[] {
  let base = [...events];

  if (
    filter.aroundName ||
    (filter.name && (filter.beforeMs || filter.afterMs))
  ) {
    const centerName = filter.aroundName ?? filter.name!;
    const centers = events.filter((event) => event.name === centerName);
    if (centers.length === 0) return [];
    const beforeMs = filter.beforeMs ?? 0;
    const afterMs = filter.afterMs ?? 0;
    const ranges = centers.map((center) => ({
      from: center.timestampMs - beforeMs,
      to: center.timestampMs + afterMs,
    }));
    base = events.filter((event) =>
      ranges.some(
        (range) =>
          event.timestampMs >= range.from && event.timestampMs <= range.to,
      ),
    );
  }

  const matched = base.filter((event) => {
    if (filter.source && event.source !== filter.source) return false;
    if (filter.name && !filter.aroundName && event.name !== filter.name) {
      if (!(filter.beforeMs || filter.afterMs)) return false;
    }
    if (filter.type && event.type !== filter.type) return false;
    if (filter.frame !== undefined && event.frame !== filter.frame)
      return false;
    if (filter.entityId && event.entityId !== filter.entityId) return false;
    if (filter.chunkKey && event.chunkKey !== filter.chunkKey) return false;
    return true;
  });

  if (filter.limit !== undefined && filter.limit >= 0)
    return matched.slice(0, filter.limit);
  return matched;
}

export function parseJsonlEvents(text: string): TelemetryEvent[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelemetryEvent);
}
