import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "handle from ctx A cannot resolve in ctx B (uint48 ctxId discrimination)",
  async () => {
    // Two real contexts on different canvases.
    const canvasA = await makeOffscreenCanvas();
    const canvasB = await makeOffscreenCanvas();
    const ctxA = await gpu.requestContext(canvasA, { surfaceFormat: "linear" });
    const ctxB = await gpu.requestContext(canvasB, { surfaceFormat: "linear" });

    // Allocate a mesh in ctx A.
    const { material: matA, binding: bindingA } = await makeUnlitMaterial(
      ctxA,
      vec4.fromValues(1, 0, 0, 1),
    );
    const geoA = geometry.cube(ctxA);
    const meshA = mesh.create(ctxA, { geometry: geoA, material: matA });

    // Setters against ctxB with a ctxA handle must silent no-op.
    expect(() =>
      mesh.setPosition(ctxB, meshA, new Float32Array([1, 0, 0])),
    ).not.toThrow();

    // Destroy against ctxB with a ctxA handle must silent no-op.
    expect(() => mesh.destroy(ctxB, meshA)).not.toThrow();

    // The handle is still live in ctxA — confirms ctxB's calls didn't
    // accidentally affect ctxA's pool.
    mesh.destroy(ctxA, meshA);
    material.destroy(ctxA, matA);
    binding.destroy(ctxA, bindingA);
    geometry.destroy(ctxA, geoA);

    gpu.dispose(ctxA);
    gpu.dispose(ctxB);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render in ctx B with a ctx A handle throws with positional context",
  async () => {
    const canvasA = await makeOffscreenCanvas();
    const canvasB = await makeOffscreenCanvas();
    const ctxA = await gpu.requestContext(canvasA, { surfaceFormat: "linear" });
    const ctxB = await gpu.requestContext(canvasB, { surfaceFormat: "linear" });

    const { material: matA, binding: bindingA } = await makeUnlitMaterial(
      ctxA,
      vec4.fromValues(0, 1, 0, 1),
    );
    const geoA = geometry.cube(ctxA);
    const meshA = mesh.create(ctxA, { geometry: geoA, material: matA });

    const camera = await import("../../src/camera/index.ts");
    const camB = camera.perspective({
      aspect: 1,
      fovYRad: Math.PI / 4,
      near: 0.1,
      far: 100,
    });

    // frame.render throws with `draw[0]:` prefix when meshA's ctxId
    // doesn't match ctxB.
    const frame = await import("../../src/frame/index.ts");
    expect(() => frame.render(ctxB, { meshes: [meshA], camera: camB })).toThrow(
      /meshes\[0\]/,
    );

    // Cleanup.
    mesh.destroy(ctxA, meshA);
    material.destroy(ctxA, matA);
    binding.destroy(ctxA, bindingA);
    geometry.destroy(ctxA, geoA);
    gpu.dispose(ctxA);
    gpu.dispose(ctxB);
  },
);
