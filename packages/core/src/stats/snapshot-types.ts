export type Snapshot = Readonly<{
  frame: {
    fps: number;
    ms: { last: number; mean: number; p99: number; min: number; max: number };
  };
  gpu: {
    drawCalls: number;
    triangles: number;
    pipelineSwitches: number;
    bindGroupSwitches: number;
    uncapturedErrors: number;
    renderMs: number | null;
    computeMs: number | null;
  };
  resources: { meshes: number; materials: number; geometries: number };
  events: { perEmitter: Record<string, number> };
  memory: { bufferBytes: number; textureBytes: number; total: number };
  custom: Record<string, number>;
}>;
