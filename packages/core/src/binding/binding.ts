import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { _allocBinding, _destroyBinding } from "../resources/internal.ts";
import { _layoutOf } from "../shader/shader.ts";
import type { Shader } from "../shader/types.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { computeLayout } from "./layout.ts";
import type {
  AddressSpace,
  Binding,
  BindingSlot,
  LayoutSchema,
  ResolvedLayout,
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
 * buffer on any failure after creation (mirrors the `material/unlit.ts`
 * create-leak-window discipline).
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
