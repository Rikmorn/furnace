import type { Snapshot } from "./snapshot-types.ts";

export const ZERO_SNAPSHOT: Snapshot = Object.freeze({
  frame: { fps: 0, ms: { last: 0, mean: 0, p99: 0, min: 0, max: 0 } },
  gpu: {
    drawCalls: 0,
    triangles: 0,
    pipelineSwitches: 0,
    bindGroupSwitches: 0,
    renderMs: null,
    computeMs: null,
    uncapturedErrors: 0,
    deviceLost: false,
  },
  resources: { meshes: 0, materials: 0, geometries: 0, effects: 0, shaders: 0 },
  events: { perEmitter: {} },
  memory: { bufferBytes: 0, textureBytes: 0, total: 0 },
  custom: {},
});
