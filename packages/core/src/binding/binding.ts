import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { warn } from "../log/internal.ts";
import type { BindingHandle } from "../resources/handle.ts";
import {
  _allocBinding,
  _destroyBinding,
  _lookupBinding,
} from "../resources/internal.ts";
import { _layoutOf } from "../shader/internal.ts";
import type { Shader } from "../shader/types.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { computeLayout } from "./layout.ts";
import type {
  AddressSpace,
  Binding,
  BindingSlot,
  LayoutSchema,
  ResolvedLayout,
  Token,
  Values,
} from "./types.ts";

/** Options for creating a binding without a paired shader. */
export type BindingCreateOpts<L extends LayoutSchema = LayoutSchema> = {
  /** The `@group(1)` uniform schema to allocate the buffer from. */
  layout: L;
  /** Address space for the buffer. Defaults to `"uniform"`. */
  addressSpace?: AddressSpace;
};

/**
 * Internal factory: allocate a `GPUBuffer`, a CPU scratch `ArrayBuffer`,
 * cached typed-array views, and register the slot. Throws setup-loud if
 * the layout is empty (a binding needs at least one field). Rolls back the
 * buffer on any failure after creation: once `_recordAlloc` has fired, a
 * later throw would leak the buffer and its byte accounting, so the catch
 * destroys the buffer and emits a matching `_recordDestroy` before rethrowing.
 */
function createFromLayout<L extends LayoutSchema>(
  ctx: Context,
  layout: ResolvedLayout,
): Binding<L> {
  if (Object.keys(layout.fields).length === 0) {
    throw new FurnaceError(
      "binding.create: layout has no fields — a Binding requires at least one @group(1) field",
    );
  }
  const { byteSize } = layout;
  const buffer = ctx.device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  _recordAlloc(ctx, "buffer", byteSize);
  try {
    const scratch = new ArrayBuffer(byteSize);
    const slot: BindingSlot = {
      buffer,
      byteSize,
      scratch,
      views: {
        f32: new Float32Array(scratch),
        i32: new Int32Array(scratch),
        u32: new Uint32Array(scratch),
      },
      layout,
      dirty: false,
      _teardown: () => {
        buffer.destroy();
        _recordDestroy(ctx, "buffer", byteSize);
      },
    };
    // Boundary cast: brand applied at typed wrapper; see _allocMesh pattern.
    return _allocBinding(ctx, slot) as Binding<L>;
  } catch (err) {
    // Rollback: buffer allocated but slot not yet registered — free it.
    buffer.destroy();
    _recordDestroy(ctx, "buffer", byteSize);
    throw err;
  }
}

/**
 * Create a {@link Binding} paired with a compiled {@link Shader}. The
 * shader's declared `@group(1)` layout (stored at `shader.create` time via
 * `opts.layout`) is read via `_layoutOf` and used to size the buffer.
 * Setup-loud: throws `FurnaceError` if the shader declares no layout.
 *
 * @throws FurnaceError - if the shader has no declared `@group(1)` layout.
 * @throws FurnaceError - if the resolved layout has no fields.
 */
export function create<L extends LayoutSchema = LayoutSchema>(
  ctx: Context,
  shaderOrOpts: Shader<L> | BindingCreateOpts<L>,
): Binding<L> {
  // Discriminate: if the argument is an object with a `layout` property it's
  // the options path; otherwise it's a shader handle (which is a plain number
  // at runtime — see resources/handle.ts).
  if (
    typeof shaderOrOpts === "object" &&
    shaderOrOpts !== null &&
    "layout" in shaderOrOpts
  ) {
    const opts = shaderOrOpts as BindingCreateOpts<L>;
    const layout = computeLayout(opts.layout, opts.addressSpace);
    return createFromLayout<L>(ctx, layout);
  }
  // Shader handle path: read the pre-resolved layout stored on the slot.
  const s = shaderOrOpts as Shader<L>;
  const layout = _layoutOf(ctx, s);
  if (layout === null) {
    throw new FurnaceError(
      "binding.create: the shader declares no @group(1) layout — pass opts.layout explicitly or use a shader compiled with opts.layout",
    );
  }
  return createFromLayout<L>(ctx, layout);
}

/**
 * Destroy a {@link Binding}, freeing its `GPUBuffer` and CPU scratch. Stats
 * decrements for both the binding slot count and the buffer bytes are fired
 * via the slot's `_teardown`. Idempotent on stale or already-destroyed handles.
 */
export function destroy(ctx: Context, b: Binding): void {
  _destroyBinding<BindingSlot>(ctx, b, (s) => s._teardown());
}

// ---------------------------------------------------------------------------
// Write path — set / setUniform
// ---------------------------------------------------------------------------

// Lookup table: token → element count (number of 4-byte elements written).
// Scalars write 1 element; vectors/matrices write their component count.
// biome-ignore format: alignment aids scanning the token→count map
const TOKEN_ELEMENT_COUNT: Record<Token, number> = {
  f32:      1,
  i32:      1,
  u32:      1,
  vec2f:    2,
  vec3f:    3,
  vec4f:    4,
  mat2x2f:  4,
  mat3x3f: 12,
  mat4x4f: 16,
};

/**
 * Write one field by name into the binding's CPU scratch buffer. Dispatches
 * on token to select the correct typed-array view. All byte offsets are
 * multiples of 4 (WGSL alignment guarantee), so `offset / 4` is the integer
 * element index into a 4-byte-per-element typed-array view.
 *
 * Unknown field name: warns and returns (defensive — `keyof L` prevents it
 * at compile time; the check catches dynamic/cast call sites).
 */
function writeField(
  slot: BindingSlot,
  name: string,
  value: number | number[] | Float32Array,
): void {
  const field = slot.layout.fields[name];
  if (field === undefined) {
    warn("binding", `set/setUniform: unknown field "${name}" — skipped`);
    return;
  }
  const elementIndex = field.offset / 4;
  const count = TOKEN_ELEMENT_COUNT[field.token];
  if (count === 1) {
    // Scalar path — dispatch on token to the correct integer view.
    if (field.token === "i32") {
      slot.views.i32[elementIndex] = value as number;
    } else if (field.token === "u32") {
      slot.views.u32[elementIndex] = value as number;
    } else {
      slot.views.f32[elementIndex] = value as number;
    }
  } else {
    // Vector / matrix path — write N floats starting at the element index.
    slot.views.f32.set(value as ArrayLike<number>, elementIndex);
  }
}

function markDirty(ctx: Context, b: BindingHandle, slot: BindingSlot): void {
  slot.dirty = true;
  ctx._internal.resources.dirtyBindings.add(b);
}

/**
 * Batch-write multiple fields on a {@link Binding} from a partial values
 * object. Writes each supplied key into the CPU scratch buffer and marks the
 * binding dirty for the next render flush.
 *
 * @remarks
 * Both `set` and {@link setUniform} are **lazy**: they write only the CPU
 * scratch; no GPU buffer upload occurs until `frame.render` (or a future
 * compute dispatch) calls `_flushDirtyBindings`. Silent no-op on a stale or
 * destroyed binding (runtime-quiet — hot-path).
 */
export function set<L extends LayoutSchema>(
  ctx: Context,
  b: Binding<L>,
  values: Partial<Values<L>>,
): void {
  const slot = _lookupBinding<BindingSlot>(ctx, b);
  if (slot === null) return;
  for (const [name, value] of Object.entries(values)) {
    writeField(slot, name, value as number | number[] | Float32Array);
  }
  markDirty(ctx, b, slot);
}

/**
 * Write a single named field on a {@link Binding}. Zero-alloc hot path:
 * no transient object is created; the value is written directly into the
 * cached typed-array view at the pre-computed byte offset.
 *
 * @remarks
 * The field name is constrained to `keyof L` at compile time, so unknown
 * field names are prevented statically. A runtime defensive warn+skip
 * applies to call sites that bypass the type checker (e.g. a cast).
 *
 * Silent no-op on a stale or destroyed binding (runtime-quiet — hot-path).
 */
export function setUniform<L extends LayoutSchema, K extends keyof L>(
  ctx: Context,
  b: Binding<L>,
  name: K,
  value: Values<L>[K],
): void {
  const slot = _lookupBinding<BindingSlot>(ctx, b);
  if (slot === null) return;
  writeField(slot, name as string, value as number | number[] | Float32Array);
  markDirty(ctx, b, slot);
}

// ---------------------------------------------------------------------------
// Internal test accessors. Engine-internal and deliberately absent from both
// index.ts (consumer surface) and internal.ts (the sibling-module door) — only
// this module's own tests deep-import them.
// ---------------------------------------------------------------------------

/** Return the slot's CPU scratch `ArrayBuffer`, or `null` on stale handles. */
export function _scratchOf(ctx: Context, b: BindingHandle): ArrayBuffer | null {
  const slot = _lookupBinding<BindingSlot>(ctx, b);
  return slot !== null ? slot.scratch : null;
}

/** Return whether the binding's dirty flag is set, or `false` on stale handles. */
export function _isDirty(ctx: Context, b: BindingHandle): boolean {
  const slot = _lookupBinding<BindingSlot>(ctx, b);
  return slot !== null ? slot.dirty : false;
}
