import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import {
  _acquirePoolTarget,
  _poolStats,
  _releasePoolTarget,
} from "../../src/post/pool.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "acquire→release→re-acquire reuses the same GPUTexture",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const a = _acquirePoolTarget(ctx, 32, 32, "rgba16float");
    _releasePoolTarget(ctx, a);
    const b = _acquirePoolTarget(ctx, 32, 32, "rgba16float");
    expect(b.tex).toBe(a.tex);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "distinct keys allocate distinct textures; two concurrent acquires of one key don't alias",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const a = _acquirePoolTarget(ctx, 32, 32, "rgba16float");
    const b = _acquirePoolTarget(ctx, 16, 16, "rgba16float");
    const c = _acquirePoolTarget(ctx, 32, 32, "rgba16float");
    expect(b.tex).not.toBe(a.tex);
    expect(c.tex).not.toBe(a.tex);
    expect(_poolStats(ctx)).toEqual({ free: 0, live: 3 });
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dispose frees all pooled targets (textureBytes return to baseline)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const base = stats.snapshot(ctx).memory.textureBytes;
    const a = _acquirePoolTarget(ctx, 32, 32, "rgba16float");
    _acquirePoolTarget(ctx, 16, 16, "rgba16float");
    expect(stats.snapshot(ctx).memory.textureBytes).toBeGreaterThan(base);
    gpu.dispose(ctx);
    expect(a.tex).toBeDefined();
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "release returns a target to the free list (stats reflect free/live split)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const a = _acquirePoolTarget(ctx, 32, 32, "rgba16float");
    expect(_poolStats(ctx)).toEqual({ free: 0, live: 1 });
    _releasePoolTarget(ctx, a);
    expect(_poolStats(ctx)).toEqual({ free: 1, live: 0 });
    gpu.dispose(ctx);
  },
);
