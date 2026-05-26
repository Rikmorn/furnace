import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _recordDeviceLost } from "../../src/stats/internal.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "_recordDeviceLost flips snap.gpu.deviceLost to true",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(snapshot(ctx).gpu.deviceLost).toBe(false);
    _recordDeviceLost(ctx);
    expect(snapshot(ctx).gpu.deviceLost).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_recordDeviceLost is idempotent",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    _recordDeviceLost(ctx);
    expect(() => _recordDeviceLost(ctx)).not.toThrow();
    expect(ctx._internal.stats.deviceLost).toBe(true); // direct state check
    expect(snapshot(ctx).gpu.deviceLost).toBe(true); // public projection still holds
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_recordDeviceLost on a disposed ctx is a silent no-op",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    gpu.dispose(ctx);
    expect(() => _recordDeviceLost(ctx)).not.toThrow();
    // Disposed snapshot returns ZERO_SNAPSHOT (deviceLost: false).
    expect(snapshot(ctx).gpu.deviceLost).toBe(false);
  },
);
