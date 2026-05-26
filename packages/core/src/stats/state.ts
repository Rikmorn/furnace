import { createFpsCounter, type FpsCounter } from "./fps-counter.ts";
import { createFrameWindow, type FrameWindow } from "./frame-window.ts";
import { createResourceRegistry, type ResourceRegistry } from "./resources.ts";
import type { Snapshot } from "./snapshot-types.ts";

export type StatsState = {
  // Frame timing
  frameStartTime: number | null;
  window: FrameWindow;
  fps: FpsCounter;

  // Per-frame GPU counters (reset at _frameStart)
  drawCalls: number;
  triangles: number;
  pipelineSwitches: number;
  bindGroupSwitches: number;

  // Cumulative
  deviceLost: boolean;
  uncapturedErrors: number;

  // Resources & memory
  resources: ResourceRegistry;

  // Events (per-frame, reset at _frameStart)
  emissions: Map<string, number>;

  // Custom (never reset)
  gauges: Map<string, number>;
  counters: Map<string, number>;
  measures: Map<string, number>;

  // Subscribers
  onFrameSubscribers: Set<(snap: Snapshot) => void>;
};

export function createStatsState(now: number): StatsState {
  return {
    frameStartTime: null,
    window: createFrameWindow(),
    fps: createFpsCounter(now),

    drawCalls: 0,
    triangles: 0,
    pipelineSwitches: 0,
    bindGroupSwitches: 0,

    deviceLost: false,
    uncapturedErrors: 0,

    resources: createResourceRegistry(),

    emissions: new Map(),

    gauges: new Map(),
    counters: new Map(),
    measures: new Map(),

    onFrameSubscribers: new Set(),
  };
}
