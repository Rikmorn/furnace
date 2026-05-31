export type { BindingCreateOpts } from "./binding.ts";
// Internal — re-exported so engine tests can reach them via
// `import * as binding from ".../binding/index.ts"`. Not part of the
// consumer-facing API.
export {
  _bufferOf,
  _flushDirtyBindings,
  _isDirty,
  _scratchOf,
  create,
  destroy,
  set,
  setUniform,
} from "./binding.ts";
export type {
  AddressSpace,
  Binding,
  LayoutSchema,
  ResolvedField,
  ResolvedLayout,
  Token,
  TokenValue,
  Values,
} from "./types.ts";
