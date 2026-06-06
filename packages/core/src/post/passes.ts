import { _bufferOf } from "../binding/binding.ts";
import type { Binding } from "../binding/types.ts";
import { FurnaceError } from "../errors.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _allocEffect, _lookupShader } from "../resources/internal.ts";
import type { Shader, ShaderSlot } from "../shader/types.ts";
import { _effectTeardown, type Effect, type EffectSlot } from "./effect.ts";

/**
 * Where a {@link PassDescriptor} reads its primary `@group(0)` colour input
 * from, per declared input slot:
 *
 * - `"scene"` — the resolved scene colour target (the post chain's input).
 * - `"prev"` — the output of the immediately preceding pass (the scene target
 *   for the first pass).
 * - `{ intermediate: name }` — a named target produced by an earlier pass's
 *   `output.intermediate`. The name MUST be produced by a strictly earlier pass
 *   (setup-loud — `createPasses` throws otherwise).
 */
export type PassInput = "scene" | "prev" | { intermediate: string };

/**
 * Output target shape for a {@link PassDescriptor}.
 *
 * - `scale` — multiplier on the canvas backing-store size for the pass's render
 *   target (e.g. `0.5` for a half-res blur target). Defaults to `1`. The final
 *   pass always writes the full-size swap chain regardless of `scale`.
 * - `format` — explicit colour format for the pass's render target. Defaults to
 *   the context working colour format (`rgba16float` under HDR, else
 *   `ctx.format`). The final pass always writes `ctx.format`.
 * - `intermediate` — names this pass's output so a later pass can read it via
 *   `{ intermediate: name }`. Anonymous (no name) when omitted.
 */
export type PassOutput = {
  scale?: number;
  format?: GPUTextureFormat;
  intermediate?: string;
};

/**
 * One pass in a {@link createPasses} chain. Mirrors {@link EffectDescriptor}'s
 * `@group(0)` / `@group(1)` binding contract per pass:
 *
 * - `shader` — the compiled {@link Shader} providing the `fs_main` fragment
 *   stage. The shared fullscreen vertex shader is auto-supplied.
 * - `inputs` — the colour inputs bound at `@group(0)`, in declaration order
 *   (binding 0..N-1); the sampler follows at binding N. Supply multiple inputs
 *   (`["scene", { intermediate: "x" }]`) for composite passes.
 * - `output` — the render target shape (see {@link PassOutput}); omit for a
 *   full-size, working-format, anonymous target.
 * - `binding` — typed `@group(1)` data path (a {@link Binding} whose buffer is
 *   bound at `@group(1) @binding(0)`). The binding owns its buffer.
 * - `bindings` — raw `@group(1)` entries (textures, samplers, advanced cases).
 *   Consumer-owned resources.
 * - `blend` — `undefined` clears + writes opaque; a `GPUBlendState` loads the
 *   destination and alpha-blends over it.
 */
export type PassDescriptor = {
  shader: Shader;
  inputs: PassInput[];
  output?: PassOutput;
  binding?: Binding;
  bindings?: GPUBindGroupEntry[];
  blend?: GPUBlendState;
};

/**
 * Engine-private per-pass slot. Holds the fragment module + shader key for lazy
 * per-format pipeline builds (see `_resolvePassPipeline` in `effect.ts`), the
 * resolved input/output wiring the chain evaluator reads, and the `@group(1)`
 * entries + blend captured at create time. `byFormat` caches one pipeline
 * variant per resolved target colour format (mid-chain working format + final
 * swap-chain format), each refcounted in the per-ctx post pipeline cache.
 */
export type PassSlot = {
  fsModule: GPUShaderModule;
  shaderKey: string;
  inputs: PassInput[];
  scale: number;
  outFormat: GPUTextureFormat | null;
  outName: string | null;
  group1Entries: GPUBindGroupEntry[] | null;
  blend: GPUBlendState | undefined;
  byFormat: Map<
    GPUTextureFormat,
    {
      pipeline: GPURenderPipeline;
      pipelineKey: string;
      group1: GPUBindGroup | null;
    }
  >;
};

/** Descriptor accepted by {@link createPasses}. */
export type PassesDescriptor = {
  /** The ordered passes. Must contain at least one (setup-loud). */
  passes: PassDescriptor[];
};

/**
 * Resolve the `@group(1)` bind-group entries for a pass: the typed binding path
 * takes precedence over raw bindings. Returns `null` when the pass declares no
 * `@group(1)` data. Setup-loud on a stale/destroyed binding.
 */
function resolveGroup1Entries(
  ctx: Context,
  desc: PassDescriptor,
  index: number,
): GPUBindGroupEntry[] | null {
  if (desc.binding != null) {
    const buf = _bufferOf(ctx, desc.binding);
    if (buf === null) {
      throw new FurnaceError(
        `createPasses: passes[${index}].binding is invalid or destroyed`,
      );
    }
    return [{ binding: 0, resource: { buffer: buf } }];
  }
  const hasRawBindings = desc.bindings != null && desc.bindings.length > 0;
  if (hasRawBindings && desc.bindings != null) {
    return desc.bindings;
  }
  return null;
}

/** Resolve one {@link PassDescriptor} into a {@link PassSlot}. No pipeline is
 *  built here — pipelines build lazily per resolved target format at render
 *  time. Setup-loud on a stale/destroyed shader or binding. */
function resolvePassSlot(
  ctx: Context,
  desc: PassDescriptor,
  index: number,
): PassSlot {
  if (desc.shader == null) {
    throw new FurnaceError(`createPasses: passes[${index}].shader is required`);
  }
  const shaderSlot = _lookupShader<ShaderSlot>(ctx, desc.shader);
  if (shaderSlot === null) {
    throw new FurnaceError(
      `createPasses: passes[${index}].shader is invalid or destroyed`,
    );
  }
  return {
    fsModule: shaderSlot.module,
    shaderKey: String(desc.shader),
    inputs: desc.inputs,
    scale: desc.output?.scale ?? 1,
    outFormat: desc.output?.format ?? null,
    outName: desc.output?.intermediate ?? null,
    group1Entries: resolveGroup1Entries(ctx, desc, index),
    blend: desc.blend,
    byFormat: new Map(),
  };
}

/**
 * Validate that every `{ intermediate: name }` input references a name produced
 * by a strictly earlier pass. Setup-loud — a forward/self reference cannot be
 * satisfied by the linear evaluator and is almost certainly a wiring mistake.
 */
function validateIntermediateRefs(passes: PassDescriptor[]): void {
  const produced = new Set<string>();
  for (const desc of passes) {
    for (const input of desc.inputs) {
      if (typeof input === "object" && !produced.has(input.intermediate)) {
        throw new FurnaceError(
          `createPasses: input references intermediate "${input.intermediate}" that is not produced by any earlier pass`,
        );
      }
    }
    const name = desc.output?.intermediate;
    if (name != null) produced.add(name);
  }
}

/**
 * Register a declarative multi-pass post chain and return an opaque
 * {@link Effect} handle. Each {@link PassDescriptor} becomes one fullscreen
 * draw whose `@group(0)` colour inputs are wired from `"scene"` / `"prev"` /
 * named earlier-pass outputs, and whose render target is a pool-backed
 * transient (mid-chain) or the swap chain (final pass). The chain evaluator in
 * `frame.render` flattens every effect's passes into one linear sequence.
 *
 * Like `post.create`, no `GPURenderPipeline` is built at create time —
 * pipelines build lazily per resolved target colour format on first render and
 * are shared (per ctx) across passes with the same shader + format + blend.
 *
 * Setup-loud (see `engine-conventions.md` §"Failure policy"): validates the
 * shape up front before any GPU work.
 *
 * @throws FurnaceGpuError - `ctx` is disposed.
 * @throws FurnaceError - `desc.passes` is empty.
 * @throws FurnaceError - a pass's `shader` is missing, invalid, or destroyed.
 * @throws FurnaceError - a pass's `binding` is invalid or destroyed.
 * @throws FurnaceError - an `{ intermediate: name }` input references a name not
 *   produced by any strictly earlier pass.
 */
// biome-ignore lint/suspicious/useAwait: public post.createPasses returns Promise<Effect> by contract (mirrors post.create / post.tonemap; body is await-free only because pipelines build lazily at render time)
export async function createPasses(
  ctx: Context,
  desc: PassesDescriptor,
): Promise<Effect> {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("createPasses: context is disposed");
  }
  if (desc.passes == null || desc.passes.length === 0) {
    throw new FurnaceError("createPasses: needs at least one pass");
  }
  validateIntermediateRefs(desc.passes);
  const passes = desc.passes.map((d, i) => resolvePassSlot(ctx, d, i));
  const slot: EffectSlot = {
    passes,
    // Consumer-authored effects own no engine-internal bindings: the consumer's
    // binding/bindings stay consumer-owned. Built-in factories (post.bloom)
    // register their internal bindings as owned via _setOwnedBindings afterward.
    ownedBindings: [],
    _teardown: () => _effectTeardown(ctx, slot),
  };
  // Boundary cast: _allocEffect returns EffectHandle which is structurally
  // identical to Effect at runtime (Effect is an EffectHandle alias).
  return _allocEffect(ctx, slot) as Effect;
}
