import { expect, test } from "bun:test";
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

    const origWarn = console.warn;
    let warned = "";
    console.warn = (...a: unknown[]) => {
      warned = String(a[0]);
    };
    gpu.dispose(ctx);
    console.warn = origWarn;

    expect(warned).toContain("[furnace/gpu]");
    expect(warned.toLowerCase()).toContain("leak");
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
    const origWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    gpu.dispose(ctx);
    console.warn = origWarn;

    expect(warned).toBe(false);
  },
);
