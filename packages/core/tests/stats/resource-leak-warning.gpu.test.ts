import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: warns when resources are still registered",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    mesh.create(ctx, { geometry: geo, material: mat });
    // Deliberately do not call destroy.

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("gpu");
    expect(entry.message).toContain(
      "context disposed with resources still registered",
    );
    expect(entry.rest[0]).toMatchObject({ remaining: expect.any(Number) });
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: no warning when all resources unregistered",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    mesh.destroy(m);
    mesh.destroyGeometry(geo);
    material.destroy(mat);

    // Camera buffer + depth texture only allocate inside frame.render; this
    // test never renders, so the registry is empty before dispose.
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
