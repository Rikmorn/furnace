/**
 * Frozen snapshot of one frame's instrumentation, returned by
 * {@link snapshot} and delivered to {@link onFrame} subscribers.
 *
 * Sub-trees:
 * - `frame.fps` — frames per second over the rolling window.
 * - `frame.ms` — frame-time stats: `last` (most-recent frame), `mean`,
 *   `p99`, `min`, `max` over the same rolling window.
 * - `gpu.drawCalls`, `gpu.triangles`, `gpu.pipelineSwitches`,
 *   `gpu.bindGroupSwitches`, `gpu.uncapturedErrors` — per-frame counters
 *   recorded by the engine's render path.
 * - `gpu.renderMs`, `gpu.computeMs` — reserved for GPU timestamp queries;
 *   currently always `null`.
 * - `resources` — live counts of `meshes`, `materials`, `geometries`,
 *   `effects` registered with stats (incremented by `_registerResource`,
 *   decremented by `_unregisterResource`).
 * - `events.perEmitter` — emit counts keyed by emitter name (only emitters
 *   created with a `name` contribute).
 * - `memory.bufferBytes`, `memory.textureBytes`, `memory.total` — running
 *   byte totals for buffer- and texture-kind resources.
 * - `custom` — last-written value for each consumer gauge/counter/measure
 *   set via {@link gauge}, {@link increment}, {@link measure}, or
 *   {@link startMeasurement}.
 *
 * The snapshot is built fresh per call; mutating its fields has no effect
 * on engine state and the outer object is frozen.
 */
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
  resources: {
    meshes: number;
    materials: number;
    geometries: number;
    effects: number;
  };
  events: { perEmitter: Record<string, number> };
  memory: { bufferBytes: number; textureBytes: number; total: number };
  custom: Record<string, number>;
}>;
