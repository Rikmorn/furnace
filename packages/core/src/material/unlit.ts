import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { unlit as unlitShader } from "../shader/index.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import type { Vec4 } from "../transform/types.ts";
import { _resolveMaterial } from "./internal.ts";
import { _flatRenderState, create } from "./material.ts";
import type { Material } from "./types.ts";

const COLOR_BUFFER_SIZE_BYTES = 16;

/**
 * Options accepted by {@link unlit}.
 *
 * `color` is required — linear-space RGBA `Vec4` written into the material's
 * uniform buffer (see `engine-conventions.md` §"Color space"; sRGB encoding
 * happens on swap-chain write via the view format).
 *
 * Pipeline-state fields are optional with defaults matching
 * {@link MaterialDescriptor} (`topology: "triangle-list"`, `cullMode: "back"`,
 * `depthEnabled: true`, `depthWrite: true`, `depthCompare: "less"`, no blend).
 * When `depthEnabled` is `false` the pipeline is built without a depth-stencil
 * attachment; `depthWrite` and `depthCompare` are ignored in that case.
 */
export type UnlitOptions = {
  color: Vec4;
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
  depthEnabled?: boolean;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  blend?: GPUBlendState;
};

/**
 * Stock unlit material — outputs `opts.color` directly from the fragment
 * shader. Allocates a 16-byte uniform buffer (one `vec4<f32>`) for the
 * color, owned by the material's slot and freed when the material's
 * teardown runs (on `destroy`, or via the dispose cascade).
 *
 * Delegates to {@link create}, so its failure policy and pipeline-cache
 * behaviour apply.
 *
 * @throws FurnaceError - if `opts.color` is null or contains a
 *   non-finite component.
 */
export async function unlit(
  ctx: Context,
  opts: UnlitOptions,
): Promise<Material> {
  if (
    opts.color == null ||
    !Number.isFinite(opts.color[0]) ||
    !Number.isFinite(opts.color[1]) ||
    !Number.isFinite(opts.color[2]) ||
    !Number.isFinite(opts.color[3])
  ) {
    throw new FurnaceError("material.unlit: color must be a finite Vec4");
  }
  const colorBuffer = ctx.device.createBuffer({
    size: COLOR_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(colorBuffer, 0, opts.color);
  _recordAlloc(ctx, "buffer", COLOR_BUFFER_SIZE_BYTES);
  try {
    const handle = await create(ctx, {
      shader: await unlitShader(ctx),
      bindings: [{ binding: 0, resource: { buffer: colorBuffer } }],
      ..._flatRenderState(opts),
      blend: opts.blend,
    });
    const slot = _resolveMaterial(ctx, handle);
    slot.ownedBuffers.push(colorBuffer);
    slot.ownedBufferBytes.push(COLOR_BUFFER_SIZE_BYTES);
    return handle;
  } catch (err) {
    // Setup-loud leak window: if create() or _resolveMaterial throws after
    // we've recorded the alloc, the colorBuffer has no slot to own it and
    // no teardown attached. Free it and roll back the byte accounting
    // before rethrowing.
    colorBuffer.destroy();
    _recordDestroy(ctx, "buffer", COLOR_BUFFER_SIZE_BYTES);
    throw err;
  }
}
