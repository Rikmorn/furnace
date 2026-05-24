// Internal-only — re-exported so other core modules can import as
// `import * as stats from "../stats/index.ts"` and call hooks consistently.
export {
  _frameEnd,
  _frameStart,
  _recordBindGroupSwitch,
  _recordDraw,
  _recordEmission,
  _recordPipelineSwitch,
  _recordUncapturedError,
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
  type ResourceInfo,
} from "./internal.ts";

// Public surface
export {
  frameBoundary,
  gauge,
  get,
  increment,
  type Measurement,
  measure,
  onFrame,
  type Path,
  type PathValue,
  recordDraw,
  type Snapshot,
  snapshot,
  startMeasurement,
} from "./public.ts";
