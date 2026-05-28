import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import { _onDispose } from "../../src/gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../../src/gpu/errors.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: registered callback fires on gpu.dispose",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    let called = false;
    _onDispose(ctx, () => {
      called = true;
    });
    gpu.dispose(ctx);
    expect(called).toBe(true);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: callbacks run in LIFO order",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const order: number[] = [];
    _onDispose(ctx, () => order.push(1));
    _onDispose(ctx, () => order.push(2));
    _onDispose(ctx, () => order.push(3));
    gpu.dispose(ctx);
    expect(order).toEqual([3, 2, 1]);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: throwing callback is caught; sibling callbacks still run; error logged",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    let siblingCalled = false;
    // Registered first → runs LAST in LIFO order.
    _onDispose(ctx, () => {
      siblingCalled = true;
    });
    // Registered second → runs FIRST in LIFO order; throws.
    _onDispose(ctx, () => {
      throw new Error("cascade test throw");
    });

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(siblingCalled).toBe(true);
    const errorEntries = entries.filter((e) => e.level === "error");
    expect(errorEntries.length).toBeGreaterThan(0);
    const first = errorEntries[0];
    if (!first) throw new Error("unreachable: filtered length checked above");
    expect(first.module).toBe("gpu");
    expect(first.message).toContain("onDispose callback threw");
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: cascade continues even when log sink throws on the error route",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    let siblingCalled = false;
    _onDispose(ctx, () => {
      siblingCalled = true;
    });
    _onDispose(ctx, () => {
      throw new Error("callback throw");
    });

    setSink(() => {
      throw new Error("sink throw");
    });
    try {
      expect(() => gpu.dispose(ctx)).not.toThrow();
      expect(siblingCalled).toBe(true);
    } finally {
      setSink(consoleSink);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: throws FurnaceGpuError when ctx already disposed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    gpu.dispose(ctx);
    expect(() =>
      _onDispose(ctx, () => {
        /* intentional no-op */
      }),
    ).toThrow(FurnaceGpuError);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: returned unsubscribe removes callback before dispose",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    let called = false;
    const unsub = _onDispose(ctx, () => {
      called = true;
    });
    unsub();
    gpu.dispose(ctx);
    expect(called).toBe(false);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_onDispose: unsubscribe is a no-op after cascade has run",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const unsub = _onDispose(ctx, () => {
      /* intentional no-op */
    });
    gpu.dispose(ctx);
    expect(() => unsub()).not.toThrow();
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: cascade runs before remaining-resources count is read",
  async () => {
    // Manually register a callback that unregisters a fake resource; the
    // leak-warn computation should see the post-cascade state.
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    // Pretend a module recorded a slot-kind alloc and then forgot to clean it
    // up until cascade-time. The cascade callback records the matching destroy,
    // so the leak-warn (which reads slot-kind counts post-cascade) should NOT
    // fire.
    const { _recordAlloc, _recordDestroy } = await import(
      "../../src/stats/internal.ts"
    );
    _recordAlloc(ctx, "mesh", 0);
    _onDispose(ctx, () => _recordDestroy(ctx, "mesh", 0));

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(entries.length).toBe(0);
  },
);
