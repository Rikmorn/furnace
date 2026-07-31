// The package's public host barrel (`@furnace/editor/viewport-host`, see package.json
// exports). It is what the daemon's virtual bundle entry re-exports (daemon/bundle.ts)
// and the ONE module the chrome type-imports host types from — never a value import,
// which tests/frontend-no-engine-leakage.test.ts machine-enforces, because everything
// behind this file value-imports @furnace/core.
//
// The directory name is historical: the scene-editing viewport host that gave it its name
// was deleted with the rest of the scene surface, and `createFieldHost` is now the only
// host here.

// The advisor's presentation types, re-exported beside the host that hands them
// out — a consumer names them without reaching into field-flags.ts.
export type {
  FlagCount,
  FlagFilters,
  FlagRow,
  FlagsSummary,
} from "./field-flags.ts";
export {
  type CameraPose,
  createFieldHost,
  type FieldDriftReport,
  type FieldEntityInfo,
  type FieldGeneratorInfo,
  type FieldHost,
  type FieldHostShading,
  type FieldLayers,
  type FieldMaskChoice,
  type FieldStats,
  type FieldTool,
  type SelectionInfo,
  // `SelectionMode` is deliberately absent: the chrome only names the wider union, which it
  // narrows structurally (`gesture === null || gesture === "segment"` — does LMB still brush).
  type ViewportGesture,
} from "./field-host.ts";
// `FieldEntityInfo.placed`'s element type, re-exported beside it so a consumer
// can NAME the type without reaching into field-placements.ts.
export type { PlacedArchetype } from "./field-placements.ts";
export type {
  StampPhase,
  StampRegion,
  StampSession,
} from "./field-stamp.ts";
export type { NudgeSteps } from "./input-map.ts";
