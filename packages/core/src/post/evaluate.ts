import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import {
  _recordBindGroupSwitch,
  _recordDraw,
  _recordPipelineSwitch,
} from "../stats/internal.ts";
import { _resolvePassPipeline, type EffectSlot } from "./effect.ts";
import type { PassInput, PassSlot } from "./passes.ts";
import {
  _acquirePoolTarget,
  _releasePoolTarget,
  type PoolTarget,
} from "./pool.ts";

/**
 * Resolve a pass's declared colour inputs into texture views: `"scene"` → the
 * scene target, `"prev"` → the previous pass's output (the scene target for the
 * first pass), `{ intermediate: name }` → the named earlier-pass output.
 * `createPasses` validates intermediate names at create time; a missing name
 * here is defensive (single-pass `post.create` effects only use `"prev"`).
 */
function resolveInputViews(
  inputs: readonly PassInput[],
  sceneTarget: PoolTarget,
  prev: PoolTarget,
  named: Map<string, PoolTarget>,
): GPUTextureView[] {
  return inputs.map((input) => {
    if (input === "scene") return sceneTarget.view;
    if (input === "prev") return prev.view;
    const target = named.get(input.intermediate);
    if (target === undefined) {
      throw new FurnaceGpuError(
        `render: pass input references intermediate "${input.intermediate}" with no live target`,
      );
    }
    return target.view;
  });
}

function recordPassDraw(
  ctx: Context,
  encoder: GPUCommandEncoder,
  pass: PassSlot,
  inputViews: readonly GPUTextureView[],
  sampler: GPUSampler,
  outputView: GPUTextureView,
  outFormat: GPUTextureFormat,
): void {
  const { pipeline, group1 } = _resolvePassPipeline(ctx, pass, outFormat);
  // Colour inputs occupy bindings 0..N-1; the shared sampler follows at N.
  const entries: GPUBindGroupEntry[] = inputViews.map((view, binding) => ({
    binding,
    resource: view,
  }));
  entries.push({ binding: inputViews.length, resource: sampler });
  const group0 = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries,
  });
  const loadOp: GPULoadOp = pass.blend ? "load" : "clear";
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp,
        storeOp: "store",
      },
    ],
  });
  renderPass.setPipeline(pipeline);
  _recordPipelineSwitch(ctx);
  renderPass.setBindGroup(0, group0);
  _recordBindGroupSwitch(ctx);
  if (group1 !== null) {
    renderPass.setBindGroup(1, group1);
    _recordBindGroupSwitch(ctx);
  }
  renderPass.draw(3);
  _recordDraw(ctx, { triangles: 1 });
  renderPass.end();
}

/**
 * Acquire a mid-chain pool target for `pass`: sized `canvas * pass.scale`
 * (clamped to ≥1px), working colour format unless the pass overrides it.
 */
function acquireMidChainTarget(
  ctx: Context,
  pass: PassSlot,
  canvasWidth: number,
  canvasHeight: number,
  workingFormat: GPUTextureFormat,
): PoolTarget {
  const w = Math.max(1, Math.floor(canvasWidth * pass.scale));
  const h = Math.max(1, Math.floor(canvasHeight * pass.scale));
  return _acquirePoolTarget(ctx, w, h, pass.outFormat ?? workingFormat);
}

/**
 * Evaluate the flattened post chain. Every effect's passes are concatenated into
 * one linear sequence; mid-chain passes render into pool-backed transient
 * targets (sized `canvas * pass.scale`, working format unless overridden), the
 * final pass renders into the swap chain (`ctx.format`). Named outputs are
 * routed to later passes via `named`; `prev` always tracks the last output.
 *
 * Lifetime: every acquired pool target (the scene target included) is released
 * back to the pool at the end of the chain — including on throw, so a group1
 * layout mismatch surfacing mid-chain at first render does not leak the
 * already-acquired targets. Mid-chain release is a future optimization — at
 * chain depths of a few passes the pool's free-list reuse across frames already
 * keeps allocation flat.
 *
 * Engine-internal — `frame.render` is the only caller. Not part of the public
 * `@furnace/core/post` surface.
 */
export function _evaluateChain(
  ctx: Context,
  encoder: GPUCommandEncoder,
  effectSlots: readonly EffectSlot[],
  sceneTarget: PoolTarget,
  sampler: GPUSampler,
): void {
  const flat = effectSlots.flatMap((e) => e.passes);
  const workingFormat = ctx._internal.workingColorFormat;
  const { width: canvasWidth, height: canvasHeight } = ctx.canvas;
  const named = new Map<string, PoolTarget>();
  const acquired: PoolTarget[] = [sceneTarget];
  let prev = sceneTarget;

  try {
    for (let i = 0; i < flat.length; i++) {
      const pass = flat[i];
      if (!pass) continue; // unreachable — dense flatMap; satisfies noUncheckedIndexedAccess
      const isLast = i === flat.length - 1;
      const inputViews = resolveInputViews(
        pass.inputs,
        sceneTarget,
        prev,
        named,
      );
      const outTarget = isLast
        ? null
        : acquireMidChainTarget(
            ctx,
            pass,
            canvasWidth,
            canvasHeight,
            workingFormat,
          );
      const outputView = outTarget?.view ?? gpu.getCurrentTextureView(ctx);
      const outFormat = outTarget?.format ?? ctx.format;

      recordPassDraw(
        ctx,
        encoder,
        pass,
        inputViews,
        sampler,
        outputView,
        outFormat,
      );

      if (outTarget !== null) {
        acquired.push(outTarget);
        if (pass.outName !== null) named.set(pass.outName, outTarget);
        prev = outTarget;
      }
    }
  } finally {
    for (const target of acquired) {
      _releasePoolTarget(ctx, target);
    }
  }
}
