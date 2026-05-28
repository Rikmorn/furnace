import { beforeEach, expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import * as gpu from "../../src/gpu/index.ts";
import {
  _allocGeometry,
  _allocMaterial,
  _allocMesh,
  _countLive,
} from "../../src/resources/internal.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

type TestSlot = {
  _teardown: () => void;
  torn: boolean;
};

beforeEach(() => {
  setSink(consoleSink);
});

test.skipIf(!bunWebGpuAvailable())(
  "dispose cascade runs _teardown on every live slot in every pool",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const slots: TestSlot[] = [];
    const makeSlot = (): TestSlot => {
      const slot: TestSlot = {
        torn: false,
        _teardown: () => {
          slot.torn = true;
        },
      };
      slots.push(slot);
      return slot;
    };
    _allocMesh(ctx, makeSlot());
    _allocMesh(ctx, makeSlot());
    _allocMaterial(ctx, makeSlot());
    _allocGeometry(ctx, makeSlot());
    expect(_countLive(ctx, "mesh")).toBe(2);
    expect(_countLive(ctx, "material")).toBe(1);
    expect(_countLive(ctx, "geometry")).toBe(1);
    gpu.dispose(ctx);
    for (const slot of slots) {
      expect(slot.torn).toBe(true);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dispose cascade emits an informational warn when handles are live",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const noop = (): void => {
      /* intentional no-op */
    };
    _allocMesh(ctx, { _teardown: noop });
    _allocMaterial(ctx, { _teardown: noop });
    const entries: LogEntry[] = [];
    setSink((e) => entries.push(e));
    try {
      gpu.dispose(ctx);
      const cleanupEntries = entries.filter(
        (e) => e.module === "resources" && e.message.includes("auto-cleaned"),
      );
      expect(cleanupEntries.length).toBe(1);
      expect(cleanupEntries[0]?.message).toContain("2 live handles");
    } finally {
      setSink(consoleSink);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dispose cascade emits no informational warn when no handles are live",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const entries: LogEntry[] = [];
    setSink((e) => entries.push(e));
    try {
      gpu.dispose(ctx);
      const cleanupEntries = entries.filter(
        (e) => e.module === "resources" && e.message.includes("auto-cleaned"),
      );
      expect(cleanupEntries.length).toBe(0);
    } finally {
      setSink(consoleSink);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "cascade order is meshes → effects → materials → geometries",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const order: string[] = [];
    _allocGeometry(ctx, { _teardown: () => order.push("geometry") });
    _allocMaterial(ctx, { _teardown: () => order.push("material") });
    _allocMesh(ctx, { _teardown: () => order.push("mesh") });
    gpu.dispose(ctx);
    expect(order).toEqual(["mesh", "material", "geometry"]);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a throwing teardown does not abort the cascade",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    let secondMeshTorn = false;
    _allocMesh(ctx, {
      _teardown: () => {
        throw new Error("boom");
      },
    });
    _allocMesh(ctx, {
      _teardown: () => {
        secondMeshTorn = true;
      },
    });
    expect(() => gpu.dispose(ctx)).not.toThrow();
    expect(secondMeshTorn).toBe(true);
  },
);
