import { afterEach, expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
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
  "onDeviceLost on disposed ctx throws FurnaceGpuError (setup-loud)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    gpu.dispose(ctx);
    expect(() => gpu.onDeviceLost(ctx, () => undefined)).toThrow(
      FurnaceGpuError,
    );
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "disposed ctx skips device-lost handler (emitter, log, stat all silent)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const received: GPUDeviceLostInfo[] = [];
    gpu.onDeviceLost(ctx, (info) => received.push(info));

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));

    gpu.dispose(ctx);
    // device.destroy() resolves device.lost with reason: "destroyed".
    // Wait for the promise resolution to flush.
    await new Promise((r) => setTimeout(r, 30));

    // Disposed-check filters out the emit / log / stat triple.
    expect(received).toHaveLength(0);
    const deviceLostEntries = entries.filter(
      (e) => e.module === "gpu" && e.message === "device lost",
    );
    expect(deviceLostEntries).toHaveLength(0);

    // snap.gpu.deviceLost on disposed ctx returns ZERO_SNAPSHOT (false).
    expect(snapshot(ctx).gpu.deviceLost).toBe(false);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "onDeviceLost unsubscribe is idempotent",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const unsub = gpu.onDeviceLost(ctx, () => undefined);
    expect(() => {
      unsub();
      unsub();
    }).not.toThrow();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "onDeviceLost lazy emitter init — no allocation without subscriber",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    // Boundary cast: verify _internal doesn't have the emitter field installed
    // before any onDeviceLost call. Mirrors the resize.ts / uncaptured-error.ts
    // lazy pattern.
    const internal = ctx._internal as unknown as {
      deviceLostEmitter?: unknown;
    };
    expect(internal.deviceLostEmitter).toBeUndefined();

    gpu.onDeviceLost(ctx, () => undefined);
    expect(internal.deviceLostEmitter).toBeDefined();

    gpu.dispose(ctx);
  },
);
