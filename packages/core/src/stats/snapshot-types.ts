/**
 * Frozen snapshot of one frame's instrumentation, returned by
 * {@link snapshot} and delivered to {@link onFrame} subscribers.
 *
 * Sub-trees:
 * - `frame.fps` — frames per second over the rolling window.
 * - `frame.ms` — frame-time stats: `last` (most-recent frame), `mean`,
 *   `p99`, `min`, `max` over the same rolling window.
 * - `gpu.drawCalls`, `gpu.triangles`, `gpu.pipelineSwitches`,
 *   `gpu.bindGroupSwitches` — per-frame counters recorded by the engine's
 *   render path.
 * - `gpu.renderMs`, `gpu.computeMs` — reserved for GPU timestamp queries;
 *   currently always `null`.
 * - `gpu.uncapturedErrors`, `gpu.deviceLost` — cumulative terminal-event
 *   flags; see per-field TSDoc for semantics.
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
    renderMs: number | null;
    computeMs: number | null;
    uncapturedErrors: number;
    /**
     * `true` after `device.lost` resolves on a non-disposed context. Device
     * loss is terminal — the underlying `GPUDevice` is non-recoverable and no
     * further frames will render. Consumers observing this flag should either
     * request a fresh context (which means a fresh `gpu.requestContext`) or
     * surface the failure to the user.
     *
     * The reason (`"destroyed" | "unknown"` per the WebGPU spec) is not
     * captured here — `boolean` was chosen for the cumulative snapshot field;
     * consumers needing the reason should subscribe via `gpu.onDeviceLost`
     * (added in Tranche C; receives the full `GPUDeviceLostInfo`).
     */
    deviceLost: boolean;
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
