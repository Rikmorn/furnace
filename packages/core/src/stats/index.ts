// Internal-only — re-exported so other core modules can import as
// `import * as stats from "../stats/index.ts"` and call hooks consistently.
export {
  _frameEnd,
  _frameStart,
  _recordAlloc,
  _recordBindGroupSwitch,
  _recordDestroy,
  _recordDraw,
  _recordEmission,
  _recordPipelineSwitch,
  _recordUncapturedError,
} from "./internal.ts";

// Public surface
export {
  gauge,
  get,
  increment,
  type Measurement,
  markFrameBoundary,
  measure,
  onFrame,
  type Path,
  type PathValue,
  recordDraw,
  type Snapshot,
  snapshot,
  startMeasurement,
} from "./public.ts";
