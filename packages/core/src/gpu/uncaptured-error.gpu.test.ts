import { afterEach, expect, test } from "bun:test";
import { consoleSink, setSink } from "@furnace/core/log";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { snapshot } from "../stats/public.ts";
import { FurnaceGpuError } from "./errors.ts";
import * as gpu from "./index.ts";

await ensureBunWebGpu();

afterEach(() => setSink(consoleSink));

test.skipIf(!bunWebGpuAvailable())(
  "onUncapturedError emitter fires when uncapturederror dispatches",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const received: GPUError[] = [];
    const unsub = gpu.onUncapturedError(ctx, (err) => received.push(err));

    // Silence the log noise so test output stays clean (the engine still
    // calls error(..) on uncapturederror, which we don't need here).
    setSink(() => undefined);

    try {
      ctx.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: ctx.device.createShaderModule({ code: "INVALID WGSL" }),
          entryPoint: "vs_main",
        },
        fragment: {
          module: ctx.device.createShaderModule({ code: "INVALID WGSL" }),
          entryPoint: "fs_main",
          targets: [{ format: ctx.format }],
        },
      });
    } catch {
      // some backends throw sync; either path is acceptable
    }
    await new Promise((r) => setTimeout(r, 30));

    if (snapshot(ctx).gpu.uncapturedErrors > 0) {
      expect(received.length).toBeGreaterThan(0);
      // The payload should be a GPUError (the .error field of the event).
      // We can't assert on a specific message string since it's backend-dependent,
      // but verify the payload is truthy + has a message property.
      const first = received[0];
      if (!first) throw new Error("unreachable: received.length checked above");
      expect(typeof first.message).toBe("string");
    }

    unsub();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "onUncapturedError unsubscribe is idempotent",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const unsub = gpu.onUncapturedError(ctx, () => undefined);
    expect(() => {
      unsub();
      unsub();
    }).not.toThrow();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "onUncapturedError lazy emitter init — no allocation without subscriber",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    // Boundary cast: verify _internal doesn't have the emitter field installed
    // before any onUncapturedError call. This mirrors the resize.ts lazy pattern.
    const internal = ctx._internal as unknown as {
      uncapturedErrorEmitter?: unknown;
    };
    expect(internal.uncapturedErrorEmitter).toBeUndefined();

    gpu.onUncapturedError(ctx, () => undefined);
    expect(internal.uncapturedErrorEmitter).toBeDefined();

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "onUncapturedError on disposed ctx throws FurnaceGpuError",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    gpu.dispose(ctx);
    expect(() => gpu.onUncapturedError(ctx, () => undefined)).toThrow(
      FurnaceGpuError,
    );
  },
);
