import { computeLayout } from "../binding/layout.ts";
import type {
  AddressSpace,
  LayoutSchema,
  ResolvedLayout,
} from "../binding/types.ts";
import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocShader,
  _destroyShader,
  _lookupShader,
} from "../resources/internal.ts";
import type { ShaderSource } from "./source.ts";
import { toWgsl } from "./source.ts";
import type { Shader, ShaderSlot } from "./types.ts";

/** Options for declaring the shader's `@group(1)` uniform-buffer layout. */
export type ShaderCreateOpts<L extends LayoutSchema = LayoutSchema> = {
  /** Declared `@group(1)` uniform schema. When present, the layout is resolved
   * via `computeLayout` and stored on the slot; accessible via `_layoutOf`. */
  layout?: L;
  /** Address space for the layout buffer. Defaults to `"uniform"`. */
  addressSpace?: AddressSpace;
  /** When `true`, declares the shader samples a texture at `@group(1)`
   * (sampler at binding 0, texture-view at binding 1); `material.create`
   * then requires a `texture` to be supplied. Defaults to `false`. */
  textureBinding?: boolean;
  /** When `true`, declares the shader reads the engine Scene UBO at `@group(0)
   *  @binding(1)` (lights + ambient). The render path then binds the Scene
   *  buffer for this pipeline. Defaults to `false`. Set it when composing the
   *  public `shader.lighting` fragments into a custom lit shader. */
  usesScene?: boolean;
};

/**
 * Read WGSL compile errors via `getCompilationInfo` — the spec's portable
 * compile-error channel. Returns the joined `error`-type messages, or `null`
 * if the module compiled cleanly OR the runtime does not implement the call.
 *
 * bun-webgpu 0.1.7 (the Dawn-based test runtime) throws "getCompilationInfo
 * not implemented" for every module, so we feature-detect by catching that and
 * returning `null`; `_createShader` then relies on the validation error scope
 * (which Dawn does populate for bad WGSL). Real browsers — notably Safari —
 * surface compile errors here, so this is the belt-and-braces second check the
 * engine relies on cross-runtime.
 */
async function compilationError(
  module: GPUShaderModule,
): Promise<string | null> {
  let info: GPUCompilationInfo;
  try {
    info = await module.getCompilationInfo();
  } catch {
    return null; // getCompilationInfo unimplemented in this runtime
  }
  const errors = info.messages.filter((m) => m.type === "error");
  return errors.length > 0 ? errors.map((m) => m.message).join("; ") : null;
}

/**
 * Internal shared factory. `engineOwned` marks built-in shared shaders so the
 * public {@link destroy} no-ops on them. Validates via BOTH the validation
 * error scope AND `getCompilationInfo` (belt-and-braces across runtimes —
 * see {@link compilationError}); throws setup-loud.
 *
 * `layout` is stored on the slot as-is (already resolved by the caller, or
 * `null` for shaders with no `@group(1)` binding). `textureBinding` is stored
 * as pure metadata; defaults to `false` for engine-owned built-ins.
 */
export async function _createShader(
  ctx: Context,
  wgsl: string,
  engineOwned: boolean,
  layout: ResolvedLayout | null = null,
  textureBinding = false,
  usesScene = false,
): Promise<Shader> {
  if (!wgsl) throw new FurnaceError("shader.create: WGSL source is required");
  ctx.device.pushErrorScope("validation");
  const module = ctx.device.createShaderModule({ code: wgsl });
  const scopeErr = await ctx.device.popErrorScope();
  const compileError = await compilationError(module);
  if (scopeErr || compileError) {
    const detail = compileError ?? scopeErr?.message;
    throw new FurnaceError(`shader.create: WGSL compilation failed: ${detail}`);
  }
  const slot: ShaderSlot = {
    module,
    source: wgsl,
    engineOwned,
    layout,
    textureBinding,
    usesScene,
    // GPUShaderModule has no .destroy(); GC reclaims it when the slot clears.
    _teardown: () => {
      /* intentional no-op */
    },
  };
  return _allocShader(ctx, slot);
}

/**
 * Compile a {@link Shader} from a {@link ShaderSource} or a WGSL string. One
 * module may declare `@vertex`/`@fragment` (and, in future, `@compute`) entry
 * points. Setup-loud.
 *
 * Accepts a `ShaderSource` (flattened via {@link toWgsl}) or a bare WGSL string
 * (compiled unchanged).
 *
 * Pass `opts.layout` to declare the shader's `@group(1)` uniform-buffer schema;
 * the layout is resolved at compile time and stored on the handle — readable via
 * {@link _layoutOf}. `opts.addressSpace` defaults to `"uniform"`. Omit `opts`
 * entirely for shaders with no `@group(1)` binding; existing 2-arg calls are
 * unaffected (the parameter is optional and `L` defaults to `LayoutSchema`).
 *
 * @throws FurnaceError - if the resolved WGSL source is empty.
 * @throws FurnaceError - if WGSL compilation reports an error.
 * @throws FurnaceError - if `opts.layout` is provided with an unsupported token
 *   or an unimplemented address space.
 */
export function create<L extends LayoutSchema = LayoutSchema>(
  ctx: Context,
  src: ShaderSource | string,
  opts?: ShaderCreateOpts<L>,
): Promise<Shader<L>> {
  const wgsl = typeof src === "string" ? src : toWgsl(src);
  const layout =
    opts?.layout != null ? computeLayout(opts.layout, opts.addressSpace) : null;
  return _createShader(
    ctx,
    wgsl,
    false,
    layout,
    opts?.textureBinding ?? false,
    opts?.usesScene ?? false,
  ) as Promise<Shader<L>>;
}

/**
 * Fetch WGSL from `url` and compile it. Does **not** resolve `// @include`
 * (deferred — see `shader-preprocessor.md`) and does not cache by URL (the
 * browser HTTP-caches the bytes; reuse the returned handle to dedup). Setup-loud.
 *
 * Pass `opts.layout` to declare the shader's `@group(1)` uniform-buffer schema
 * (same semantics as {@link create}).
 *
 * @throws FurnaceError - on a non-OK HTTP response.
 * @throws FurnaceError - if the fetched WGSL fails to compile.
 * @throws FurnaceError - if `opts.layout` is provided with an unsupported token
 *   or an unimplemented address space.
 */
export async function load<L extends LayoutSchema = LayoutSchema>(
  ctx: Context,
  url: string,
  opts?: ShaderCreateOpts<L>,
): Promise<Shader<L>> {
  const resp = await fetch(url);
  if (!resp.ok)
    throw new FurnaceError(`shader.load: HTTP ${resp.status} for ${url}`);
  return create(ctx, await resp.text(), opts);
}

/**
 * Destroy a {@link Shader}, dropping the engine's reference to its
 * `GPUShaderModule` (GC reclaims it; no GPU-timeline free). Pipelines already
 * built from it are unaffected (WebGPU captures the module at creation). No-op
 * on engine-owned built-in shaders. Idempotent on stale/destroyed handles.
 */
export function destroy(ctx: Context, shader: Shader): void {
  const slot = _lookupShader<ShaderSlot>(ctx, shader);
  if (slot === null) return;
  if (slot.engineOwned) return;
  _destroyShader<ShaderSlot>(ctx, shader, (s) => s._teardown());
}

/**
 * Engine-internal: read the resolved `@group(1)` {@link ResolvedLayout} stored
 * on a shader slot, or `null` if no layout was declared at compile time.
 *
 * Used by the binding subsystem (Task 3+) to validate that a `Binding` matches
 * its paired shader's declared schema. Not part of the consumer surface.
 */
export function _layoutOf(ctx: Context, shader: Shader): ResolvedLayout | null {
  return _lookupShader<ShaderSlot>(ctx, shader)?.layout ?? null;
}

/**
 * Engine-internal: read the `textureBinding` flag stored on a shader slot.
 * Returns `true` when the shader was compiled with `textureBinding: true`
 * (declares a texture+sampler at `@group(1)`, bindings 0 and 1); `false`
 * otherwise (default for all built-ins and shaders created without the flag).
 *
 * Used by `material.create` (Task 8) to enforce that a `texture` is supplied
 * when the shader samples one. Not part of the consumer surface.
 */
export function _textureBindingOf(ctx: Context, shader: Shader): boolean {
  return _lookupShader<ShaderSlot>(ctx, shader)?.textureBinding ?? false;
}

/**
 * Engine-internal: read the `usesScene` flag stored on a shader slot. `true`
 * when the shader reads the Scene UBO at `@group(0) @binding(1)`. Read by
 * `material.create` to record it on the material slot for the render path.
 */
export function _usesSceneOf(ctx: Context, shader: Shader): boolean {
  return _lookupShader<ShaderSlot>(ctx, shader)?.usesScene ?? false;
}
