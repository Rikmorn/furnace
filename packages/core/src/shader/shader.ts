import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocShader,
  _destroyShader,
  _lookupShader,
} from "../resources/internal.ts";
import type { Shader, ShaderSlot } from "./types.ts";

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
 */
export async function _createShader(
  ctx: Context,
  wgsl: string,
  engineOwned: boolean,
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
    // GPUShaderModule has no .destroy(); GC reclaims it when the slot clears.
    _teardown: () => {
      /* intentional no-op */
    },
  };
  return _allocShader(ctx, slot);
}

/**
 * Compile a {@link Shader} from WGSL source. One module may declare
 * `@vertex`/`@fragment` (and, in future, `@compute`) entry points. Setup-loud.
 *
 * @throws FurnaceError - if `wgsl` is empty.
 * @throws FurnaceError - if WGSL compilation reports an error.
 */
export function create(ctx: Context, wgsl: string): Promise<Shader> {
  return _createShader(ctx, wgsl, false);
}

/**
 * Fetch WGSL from `url` and compile it. Does **not** resolve `// @include`
 * (deferred — see `shader-preprocessor.md`) and does not cache by URL (the
 * browser HTTP-caches the bytes; reuse the returned handle to dedup). Setup-loud.
 *
 * @throws FurnaceError - on a non-OK HTTP response.
 * @throws FurnaceError - if the fetched WGSL fails to compile.
 */
export async function load(ctx: Context, url: string): Promise<Shader> {
  const resp = await fetch(url);
  if (!resp.ok)
    throw new FurnaceError(`shader.load: HTTP ${resp.status} for ${url}`);
  return create(ctx, await resp.text());
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
