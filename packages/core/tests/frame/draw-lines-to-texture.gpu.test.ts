import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import type { Camera } from "../../src/camera/index.ts";
import * as camera from "../../src/camera/index.ts";
import { drawLinesToTexture } from "../../src/frame/render-lines.ts";
import { renderToTexture } from "../../src/frame/render-to-texture.ts";
import * as geometry from "../../src/geometry/index.ts";
import { FurnaceGpuError } from "../../src/gpu/errors.ts";
import type { Context } from "../../src/gpu/index.ts";
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

const W = 64;
const H = 64;
const BYTES_PER_ROW = 256; // 64 px × 4 B — already 256-aligned

// A horizontal line at z = -3, BEHIND the cube (which spans z ∈ [-0.5, 0.5]),
// spanning the full frame width. y = 0.2 keeps it off the exact pixel-row
// boundary a y = 0 line would straddle, while still crossing the cube.
const LINE_VERTS = new Float32Array([-10, 0.2, -3, 10, 0.2, -3]);
// Pure green, so byte[1] discriminates line pixels in BOTH rgba and bgra
// layouts. The cube is pure red, whose byte[1] is 0 in either layout.
const LINE_COLORS = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);

type Scene = {
  ctx: Context;
  cam: Camera;
  tex: GPUTexture;
  depth: GPUTexture;
  dispose: () => void;
};

async function makeScene(): Promise<Scene> {
  const canvas = await makeOffscreenCanvas(W, H);
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const { material: mat, binding: bind } = await makeUnlitMaterial(
    ctx,
    vec4.fromValues(1, 0, 0, 1), // red cube
  );
  const geo = geometry.cube(ctx, { size: 1 });
  const cube = mesh.create(ctx, { geometry: geo, material: mat });
  const tex = ctx.device.createTexture({
    size: { width: W, height: H },
    format: ctx._internal.workingColorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = ctx.device.createTexture({
    size: { width: W, height: H },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  // Default camera pose is [0,0,3] looking at the origin.
  const cam = camera.perspective({ aspect: 1 });
  // The mesh pass clears colour + depth and STORES both, which is what the
  // line pass then loads.
  renderToTexture(ctx, {
    texture: tex,
    depthTexture: depth,
    meshes: [cube],
    camera: cam,
    clearColor: vec4.fromValues(0, 0, 0, 1),
  });
  return {
    ctx,
    cam,
    tex,
    depth,
    dispose: () => {
      depth.destroy();
      tex.destroy();
      mesh.destroy(ctx, cube);
      geometry.destroy(ctx, geo);
      material.destroy(ctx, mat);
      binding.destroy(ctx, bind);
      gpu.dispose(ctx);
    },
  };
}

async function readback(ctx: Context, tex: GPUTexture): Promise<Uint8Array> {
  const buf = ctx.device.createBuffer({
    size: BYTES_PER_ROW * H,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = ctx.device.createCommandEncoder();
  enc.copyTextureToBuffer(
    { texture: tex },
    { buffer: buf, bytesPerRow: BYTES_PER_ROW, rowsPerImage: H },
    { width: W, height: H },
  );
  ctx.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const data = new Uint8Array(buf.getMappedRange().slice(0));
  buf.unmap();
  return data;
}

/** byte[1] is GREEN in both rgba8unorm and bgra8unorm — the line colour. */
function isLinePixel(d: Uint8Array, o: number): boolean {
  return (d[o + 1] ?? 0) > 128;
}

/** The cube is pure RED, which lands in byte[0] (rgba) or byte[2] (bgra); the
 *  cleared background is black and the line is pure green, so both have
 *  `max(byte0, byte2) === 0`. Layout-agnostic without knowing the swap format. */
function isCubePixel(d: Uint8Array, o: number): boolean {
  return Math.max(d[o] ?? 0, d[o + 2] ?? 0) > 128 && !isLinePixel(d, o);
}

type Counts = { line: number; lineOverCube: number; cube: number };

/** Count line/cube pixels, splitting line pixels by whether they land inside
 *  the cube's silhouette as measured from the pre-line readback (`mask`). The
 *  mask is derived empirically rather than computed from the projection, so the
 *  test does not hard-code a camera/FOV arithmetic it would have to re-derive. */
function classify(after: Uint8Array, mask: Uint8Array): Counts {
  const counts: Counts = { line: 0, lineOverCube: 0, cube: 0 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * BYTES_PER_ROW + x * 4;
      if (isCubePixel(mask, o)) counts.cube++;
      if (!isLinePixel(after, o)) continue;
      counts.line++;
      if (isCubePixel(mask, o)) counts.lineOverCube++;
    }
  }
  return counts;
}

test.skipIf(!bunWebGpuAvailable())(
  "drawLinesToTexture: occlude:true hides the line behind the mesh, occlude:false draws it on top",
  async () => {
    // --- occlude: true (the default) — depth-tested against the mesh pass ---
    const occScene = await makeScene();
    const mask = await readback(occScene.ctx, occScene.tex);
    drawLinesToTexture(occScene.ctx, {
      texture: occScene.tex,
      depthTexture: occScene.depth,
      vertices: LINE_VERTS,
      colors: LINE_COLORS,
      camera: occScene.cam,
      occlude: true,
    });
    const occluded = classify(await readback(occScene.ctx, occScene.tex), mask);
    occScene.dispose();

    // --- occlude: false — always-on-top, same geometry, same depth buffer ---
    const ovlScene = await makeScene();
    const ovlMask = await readback(ovlScene.ctx, ovlScene.tex);
    drawLinesToTexture(ovlScene.ctx, {
      texture: ovlScene.tex,
      depthTexture: ovlScene.depth,
      vertices: LINE_VERTS,
      colors: LINE_COLORS,
      camera: ovlScene.cam,
      occlude: false,
    });
    const overlay = classify(
      await readback(ovlScene.ctx, ovlScene.tex),
      ovlMask,
    );
    ovlScene.dispose();

    // Measured at authoring time (bun-webgpu, 64×64): cube silhouette 900 px
    // (30×30); occluded 34 line px / 0 over the cube; overlay 64 line px / 30
    // over the cube — 34 + 30 = 64, i.e. occlusion removes exactly the span the
    // cube covers. The assertions below are the invariants, not those numbers.
    //
    // The fixture itself has to be real before the modes mean anything: the
    // mesh pass must have drawn a cube, and it must not have drawn any green.
    expect(occluded.cube).toBeGreaterThan(200);
    expect(overlay.cube).toBe(occluded.cube);
    expect(classify(mask, mask).line).toBe(0);

    // Both modes put line pixels in the readback — the headline pin.
    expect(occluded.line).toBeGreaterThan(0);
    expect(overlay.line).toBeGreaterThan(0);

    // …and the modes genuinely DIFFER, which is what the editor's gizmos ride
    // on: depth-tested lines vanish where the mesh is nearer, always-on-top
    // lines do not.
    expect(occluded.lineOverCube).toBe(0);
    expect(overlay.lineOverCube).toBeGreaterThan(0);
    expect(overlay.line).toBeGreaterThan(occluded.line);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLinesToTexture: empty vertices is a no-op and repeated calls compose",
  async () => {
    const scene = await makeScene();
    const mask = await readback(scene.ctx, scene.tex);
    scene.ctx.device.pushErrorScope("validation");
    drawLinesToTexture(scene.ctx, {
      texture: scene.tex,
      depthTexture: scene.depth,
      vertices: new Float32Array(0),
      colors: new Float32Array(0),
      camera: scene.cam,
    });
    expect(classify(await readback(scene.ctx, scene.tex), mask).line).toBe(0);

    // Two passes over the same attachments compose (loadOp:"load" both times):
    // the occluded wireframe first, then the always-on-top overlay.
    drawLinesToTexture(scene.ctx, {
      texture: scene.tex,
      depthTexture: scene.depth,
      vertices: LINE_VERTS,
      colors: LINE_COLORS,
      camera: scene.cam,
    });
    const one = classify(await readback(scene.ctx, scene.tex), mask);
    drawLinesToTexture(scene.ctx, {
      texture: scene.tex,
      depthTexture: scene.depth,
      vertices: LINE_VERTS,
      colors: LINE_COLORS,
      camera: scene.cam,
      occlude: false,
    });
    const both = classify(await readback(scene.ctx, scene.tex), mask);
    expect(await scene.ctx.device.popErrorScope()).toBeNull();
    expect(one.lineOverCube).toBe(0);
    expect(both.lineOverCube).toBeGreaterThan(0);
    expect(both.line).toBeGreaterThan(one.line);
    scene.dispose();
  },
);

// --- The refusals (setup-loud, matching renderToTexture) -------------------

test.skipIf(!bunWebGpuAvailable())(
  "drawLinesToTexture: a multisampled attachment on a single-sample ctx is refused",
  async () => {
    // The ctx guard only proves the PIPELINES are 1x. A consumer's own texture
    // is independent — this is the gap the ctx check does not close.
    const scene = await makeScene();
    expect(scene.ctx._internal.sampleCount).toBe(1);
    const msaaTex = scene.ctx.device.createTexture({
      size: { width: W, height: H },
      format: scene.ctx._internal.workingColorFormat,
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      drawLinesToTexture(scene.ctx, {
        texture: msaaTex,
        depthTexture: scene.depth,
        vertices: LINE_VERTS,
        colors: LINE_COLORS,
        camera: scene.cam,
      }),
    ).toThrow(/attachments must be single-sample/);
    msaaTex.destroy();
    scene.dispose();
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLinesToTexture: an HDR context is refused with the format reason",
  async () => {
    const canvas = await makeOffscreenCanvas(W, H);
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: true,
    });
    // The premise the refusal exists for: the line pipelines write ctx.format,
    // renderToTexture writes workingColorFormat, and on HDR those differ — so
    // no one texture can hold both the meshes and their overlays.
    expect(ctx._internal.workingColorFormat).toBe("rgba16float");
    expect(ctx._internal.workingColorFormat).not.toBe(ctx.format);

    const tex = ctx.device.createTexture({
      size: { width: W, height: H },
      format: ctx._internal.workingColorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depth = ctx.device.createTexture({
      size: { width: W, height: H },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      drawLinesToTexture(ctx, {
        texture: tex,
        depthTexture: depth,
        vertices: LINE_VERTS,
        colors: LINE_COLORS,
        camera: camera.perspective({ aspect: 1 }),
      }),
    ).toThrow(/HDR contexts are not supported/);
    depth.destroy();
    tex.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLinesToTexture: an MSAA context is refused",
  async () => {
    const canvas = await makeOffscreenCanvas(W, H);
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      sampleCount: 4,
    });
    const tex = ctx.device.createTexture({
      size: { width: W, height: H },
      format: ctx._internal.workingColorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depth = ctx.device.createTexture({
      size: { width: W, height: H },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      drawLinesToTexture(ctx, {
        texture: tex,
        depthTexture: depth,
        vertices: LINE_VERTS,
        colors: LINE_COLORS,
        camera: camera.perspective({ aspect: 1 }),
      }),
    ).toThrow(/MSAA contexts are not supported/);
    depth.destroy();
    tex.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLinesToTexture: missing/mis-formatted attachments and bad inputs all throw",
  async () => {
    const scene = await makeScene();
    const base = {
      vertices: LINE_VERTS,
      colors: LINE_COLORS,
      camera: scene.cam,
    };
    // depthTexture is REQUIRED here (renderToTexture's is optional) — both
    // line pipelines declare a depth-stencil state.
    expect(() =>
      drawLinesToTexture(scene.ctx, {
        ...base,
        texture: scene.tex,
        depthTexture: undefined as unknown as GPUTexture,
      }),
    ).toThrow(/depthTexture is required/);
    expect(() =>
      drawLinesToTexture(scene.ctx, {
        ...base,
        texture: undefined as unknown as GPUTexture,
        depthTexture: scene.depth,
      }),
    ).toThrow(/texture is required/);
    expect(() =>
      drawLinesToTexture(scene.ctx, {
        ...base,
        camera: null as unknown as Camera,
        texture: scene.tex,
        depthTexture: scene.depth,
      }),
    ).toThrow("drawLinesToTexture: camera is required");

    const wrongColor = scene.ctx.device.createTexture({
      size: { width: W, height: H },
      format: scene.ctx.format === "rgba8unorm" ? "bgra8unorm" : "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      drawLinesToTexture(scene.ctx, {
        ...base,
        texture: wrongColor,
        depthTexture: scene.depth,
      }),
    ).toThrow(/must equal ctx.format/);

    const wrongDepth = scene.ctx.device.createTexture({
      size: { width: W, height: H },
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      drawLinesToTexture(scene.ctx, {
        ...base,
        texture: scene.tex,
        depthTexture: wrongDepth,
      }),
    ).toThrow(/must be 'depth24plus'/);

    wrongDepth.destroy();
    wrongColor.destroy();
    const { ctx, tex, depth, cam } = scene;
    scene.dispose(); // disposes ctx
    const afterDispose = () =>
      drawLinesToTexture(ctx, {
        ...base,
        camera: cam,
        texture: tex,
        depthTexture: depth,
      });
    // Both halves: the right error CLASS (not an incidental TypeError from
    // touching a torn-down handle) and the right reason.
    expect(afterDispose).toThrow(FurnaceGpuError);
    expect(afterDispose).toThrow(/context disposed/);
  },
);
