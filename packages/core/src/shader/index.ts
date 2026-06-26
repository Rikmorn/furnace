// Layout schema types — re-exported so consumers declaring a layout at
// shader.create time can name the schema types without reaching into
// the binding sub-module directly.
export type {
  AddressSpace,
  LayoutSchema,
  ResolvedLayout,
} from "../binding/types.ts";
export {
  lit,
  litInstanced,
  normalColor,
  textured,
  texturedLit,
  unlit,
  unlitInstanced,
} from "./builtins.ts";
export { lightingHelpers, sceneBinding } from "./lighting.ts";
export type { ShaderCreateOpts } from "./shader.ts";
// Internal — re-exported so the binding subsystem (Task 3+) can import
// `import * as shader from "@furnace/core/shader"` and call the accessor.
// Not part of the consumer-facing API.
export {
  _instancedOf,
  _layoutOf,
  _textureBindingOf,
  _usesSceneOf,
  _usesShadowsOf,
  create,
  destroy,
  load,
} from "./shader.ts";
export { shadowHelpers } from "./shadows.ts";
export type { ShaderSource } from "./source.ts";
export { source, toWgsl } from "./source.ts";
export type { Shader } from "./types.ts";
