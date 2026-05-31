import type { BindingHandle } from "../resources/handle.ts";

/**
 * Opaque binding handle — a `@group(1)` data instance owning a `GPUBuffer`,
 * its CPU scratch, the offset map, and (Task 4) the typed setters. Phantom `L`
 * carries the layout shape at compile time; the runtime layout lives in the
 * slot. Type-alias of {@link BindingHandle}. Managed pool kind; dispose via
 * `binding.destroy` (or let the dispose cascade free it).
 */
export type Binding<L extends LayoutSchema = LayoutSchema> = BindingHandle & {
  readonly __layout?: L;
};

/**
 * Engine-private slot backing a {@link Binding}. `scratch` is the persistent
 * CPU staging buffer; `views` are cached typed-array views over it (so Task 4's
 * set/setUniform write without allocating).
 */
export type BindingSlot = {
  buffer: GPUBuffer;
  byteSize: number;
  scratch: ArrayBuffer;
  views: { f32: Float32Array; i32: Int32Array; u32: Uint32Array };
  layout: ResolvedLayout;
  dirty: boolean;
  _teardown: () => void;
};

/** WGSL scalar/vector/matrix tokens the layout calculator understands.
 * Extensible to nested structs / arrays / `@align`/`@size` / atomics / `f16`
 * later (the design language admits them; E-B implements this subset). */
export type Token =
  | "f32"
  | "i32"
  | "u32"
  | "vec2f"
  | "vec3f"
  | "vec4f"
  | "mat2x2f"
  | "mat3x3f"
  | "mat4x4f";

/** A consumer-declared uniform-buffer schema (e.g. a `@group(1)` params
 * buffer): field name → WGSL token, in declaration order (order defines
 * offsets). The layout math is group-agnostic; the group is a usage detail. */
export type LayoutSchema = Record<string, Token>;

/** Address space of a binding's buffer. Only `"uniform"` is implemented in
 * E-B; storage variants are admitted (the type carries them) but throw at
 * materialization until the compute/storage tranche implements them. */
export type AddressSpace = "uniform" | "storage-read" | "storage-readwrite";

/** One resolved field: byte offset from buffer start + byte size + token. */
export type ResolvedField = { offset: number; size: number; token: Token };

/** The calculator's output: per-field offsets + the total buffer byte size. */
export type ResolvedLayout = {
  fields: Record<string, ResolvedField>;
  byteSize: number;
  addressSpace: AddressSpace;
};

/** TS value type a token accepts in `set`/`setUniform`. */
// biome-ignore format: alignment aids scanning the token→value map
export type TokenValue<T extends Token> =
  T extends "f32" | "i32" | "u32" ? number :
  T extends "vec2f" | "vec3f" | "vec4f" ? number[] | Float32Array :
  T extends "mat2x2f" | "mat3x3f" | "mat4x4f" ? Float32Array :
  never;

/** Map a schema to its setter value-object shape. */
export type Values<L extends LayoutSchema> = {
  [K in keyof L]: TokenValue<L[K]>;
};
