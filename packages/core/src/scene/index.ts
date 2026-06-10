// Built-ins register at module init — the same import-side-effect path
// consumer extensions use (epic Branch A: import before loadScene).
import { registerBuiltins } from "./builtins.ts";

registerBuiltins();

/**
 * The zod instance `@furnace/core/scene` validates with. Extension authors
 * MUST build param schemas from this re-export (not their own zod install) —
 * schema objects cross the registry boundary, and mixing zod instances/versions
 * breaks `instanceof`-based introspection.
 */
export { z } from "zod";
export type {
  CameraParams,
  SceneSettings,
  TransformParams,
} from "./builtins.ts";
export { loadScene } from "./loader.ts";
export type {
  BuildContext,
  ComponentDefinition,
  OutSinks,
  ResourceBuildContext,
  ResourceDefinition,
} from "./registry.ts";
export { defineComponent, defineResource } from "./registry.ts";
export type { ResolvedParamsOf } from "./schema.ts";
export type { FurnaceMeta, TableName } from "./t.ts";
/**
 * Schema helpers for component/resource params: vectors, quaternions,
 * resource refs, entity refs. See each helper's TSDoc.
 */
export * as t from "./t.ts";
export type { EntityDoc, LoadedScene, SceneDocument } from "./types.ts";
export { CURRENT_SCENE_VERSION, validateDocument } from "./validate.ts";
