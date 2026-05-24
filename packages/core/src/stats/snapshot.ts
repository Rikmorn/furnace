import { computeP99, getMean } from "./frame-window.ts";
import type { Snapshot } from "./snapshot-types.ts";
import type { StatsState } from "./state.ts";

export type { Snapshot } from "./snapshot-types.ts";

export function buildSnapshot(state: StatsState): Snapshot {
  const lastIdx =
    state.window.filled === 0
      ? -1
      : (state.window.writeIndex + state.window.ring.length - 1) %
        state.window.ring.length;
  const last = lastIdx < 0 ? 0 : (state.window.ring[lastIdx] ?? 0);

  // Empty window surfaces as 0 (not Infinity) for consumer ergonomics.
  const min = state.window.filled === 0 ? 0 : state.window.min;
  const max = state.window.filled === 0 ? 0 : state.window.max;

  return Object.freeze({
    frame: {
      fps: state.fps.current,
      ms: {
        last,
        mean: getMean(state.window),
        p99: computeP99(state.window),
        min,
        max,
      },
    },
    gpu: {
      drawCalls: state.drawCalls,
      triangles: state.triangles,
      pipelineSwitches: state.pipelineSwitches,
      bindGroupSwitches: state.bindGroupSwitches,
      uncapturedErrors: state.uncapturedErrors,
      renderMs: null,
      computeMs: null,
    },
    resources: {
      meshes: state.resources.counts.meshes,
      materials: state.resources.counts.materials,
      geometries: state.resources.counts.geometries,
      effects: state.resources.counts.effects,
    },
    events: {
      perEmitter: Object.fromEntries(state.emissions),
    },
    memory: {
      bufferBytes: state.resources.memory.bufferBytes,
      textureBytes: state.resources.memory.textureBytes,
      total:
        state.resources.memory.bufferBytes +
        state.resources.memory.textureBytes,
    },
    custom: {
      ...Object.fromEntries(state.gauges),
      ...Object.fromEntries(state.counters),
      ...Object.fromEntries(state.measures),
    },
  });
}
