import { expect, test } from "bun:test";
import * as frame from "../../src/frame/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { loadScene } from "../../src/scene/loader.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import { snapshot } from "../../src/stats/public.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { bowlingSetupDoc } from "./_fixtures/bowling-setup.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

// THE KEYSTONE GATE. Proves the core scene loader reproduces the bowling-demo
// *setup* from a committed data document, headless, via `@furnace/core` alone:
// every registered built-in kind/component/setting instantiates, the scene
// renders one validation-clean frame, and the physics world materialises.
//
// Context config = the fixture's full advisory settings (hdr + msaa 4), proven
// supported headless by tests/frame/render-hdr.gpu.test.ts (hdr + sampleCount 4
// + one effect renders clean under bun-webgpu). `surfaceFormat: "linear"` works
// around the bun-webgpu 0.1.7 swapchain view-format mock bug (see gpu-fixture.ts).
// The fixture's hdr=true REQUIRES a non-empty effect chain to reach the LDR swap
// chain (frame.render throws otherwise — render.ts §hdr); its post chain resolves
// to bloom+tonemap, so `loaded.effects` is non-empty. Visual/shadow correctness
// (vs. mere validation-cleanliness) is Task 14's editor VISUAL gate, not this one
// — a "renders clean" GPU test cannot catch wrong-OUTPUT shadow bugs (see
// docs/learnings/shadow-mapping-stage4-silent-bugs.md).
test.skipIf(!bunWebGpuAvailable())(
  "bowling setup loads + renders headless, GPU-validation-clean",
  async () => {
    const doc = bowlingSetupDoc();
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: doc.settings?.hdr ?? false,
      sampleCount: doc.settings?.msaa === 4 ? 4 : 1,
    });

    ctx.device.pushErrorScope("validation");
    const loaded = await loadScene(ctx, doc);
    const clear = doc.settings?.clearColor;
    frame.render(ctx, {
      meshes: loaded.meshes,
      camera: loaded.camera,
      clearColor: clear
        ? vec4.fromValues(clear[0], clear[1], clear[2], clear[3])
        : undefined,
      lights: loaded.lights,
      ambient: loaded.ambient,
      effects: loaded.effects,
    });
    const err = await ctx.device.popErrorScope();

    expect(err).toBeNull();
    // Every renderable entity drew at least once (lane + ball + pins).
    expect(snapshot(ctx).gpu.drawCalls).toBeGreaterThan(0);
    // Full built-in coverage actually instantiated:
    expect(loaded.world).toBeDefined(); // lazy physics world (rigidBody entities)
    expect(loaded.lights).toHaveLength(3); // directional + point + spot
    expect(loaded.effects).toHaveLength(2); // bloom + tonemap
    expect(loaded.ambient).toBeDefined();
    expect(loaded.meshes.length).toBeGreaterThanOrEqual(5); // lane + ball + 3 pins

    loaded.destroy();
    gpu.dispose(ctx);
  },
);
