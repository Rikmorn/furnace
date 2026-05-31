import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as shader from "../../src/shader/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.create + destroy: tracks materials count, no bytes (normalColor has no owned buffers)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    const m = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const after = snapshot(ctx);
    expect(after.resources.materials - before.resources.materials).toBe(1);
    expect(after.memory.bufferBytes).toBe(before.memory.bufferBytes);
    material.destroy(ctx, m);
    const final = snapshot(ctx);
    expect(final.resources.materials).toBe(before.resources.materials);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "unlit bridge: shader.unlit + binding + material registers material/binding/16-byte buffer; the binding owns the buffer",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);

    // Bridge composition: shared unlit shader + colour binding + material.
    const s = await shader.unlit(ctx);
    const b = binding.create(ctx, s);
    binding.set(ctx, b, { color: vec4.fromValues(1, 0, 0, 1) });
    const m = await material.create(ctx, { shader: s, binding: b });

    const after = snapshot(ctx);
    expect(after.resources.materials - before.resources.materials).toBe(1);
    // The colour buffer now lives on the binding, not the material slot.
    expect(after.resources.bindings - before.resources.bindings).toBe(1);
    expect(after.memory.bufferBytes - before.memory.bufferBytes).toBe(16);

    // material.destroy frees the material slot but NOT the buffer — the binding
    // owns it, so the byte total is unchanged.
    material.destroy(ctx, m);
    const afterMat = snapshot(ctx);
    expect(afterMat.resources.materials).toBe(before.resources.materials);
    expect(afterMat.resources.bindings - before.resources.bindings).toBe(1);
    expect(afterMat.memory.bufferBytes - before.memory.bufferBytes).toBe(16);

    // binding.destroy frees the binding slot and its 16-byte buffer.
    binding.destroy(ctx, b);
    const final = snapshot(ctx);
    expect(final.resources.bindings).toBe(before.resources.bindings);
    expect(final.memory.bufferBytes).toBe(before.memory.bufferBytes);
    gpu.dispose(ctx);
  },
);
