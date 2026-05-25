import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import type { Material, MaterialDescriptor } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import { vec3 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { Cull } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

const CAMERA_Z = 4;
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];
const TINT_BYTES = 16;
const QUAD_SIZE = 1;
const QUAD_X_OFFSET = 1.2;
const QUAD_Z_STEP = 0.2;
const ALPHA = 0.5;
const PREMULT_GREEN = 0.5;

const SHADER = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Tint { rgba: vec4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var<uniform> tint: Tint;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
struct VsOut { @builtin(position) clip_pos: vec4<f32> };

@vertex
fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.clip_pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  return out;
}

@fragment
fn fs_main(_in: VsOut) -> @location(0) vec4<f32> {
  return tint.rgba;
}
`;

type QuadSpec = {
  tint: [number, number, number, number];
  position: [number, number, number];
  blend?: GPUBlendState;
};

// Three quads: opaque red on the left, premultiplied-alpha green in the
// middle (rgb pre-attenuated by alpha), additive blue on the right.
const QUADS: readonly QuadSpec[] = [
  {
    tint: [1, 0, 0, ALPHA],
    position: [-QUAD_X_OFFSET, 0, 0],
  },
  {
    tint: [0, PREMULT_GREEN, 0, ALPHA],
    position: [0, 0, QUAD_Z_STEP],
    blend: material.PREMULTIPLIED_ALPHA_BLEND,
  },
  {
    tint: [0, 0, 1, ALPHA],
    position: [QUAD_X_OFFSET, 0, QUAD_Z_STEP * 2],
    blend: material.ADDITIVE_BLEND,
  },
];

function createTintBuffer(
  ctx: Context,
  rgba: [number, number, number, number],
): GPUBuffer {
  const buf = ctx.device.createBuffer({
    size: TINT_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(buf, 0, new Float32Array(rgba));
  return buf;
}

function materialDescriptorFor(
  tintBuf: GPUBuffer,
  cull: Cull,
  depthWrite: boolean,
  blend: GPUBlendState | undefined,
): MaterialDescriptor {
  return {
    vertex: SHADER,
    fragment: SHADER,
    bindings: [{ binding: 0, resource: { buffer: tintBuf } }],
    cullMode: cull,
    depthWrite,
    blend,
  };
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get cull() {
      return state.cull;
    },
    get depthWrite() {
      return state.depthWrite;
    },
    onCullChange: (v: Cull) => {
      state.cull = v;
    },
    onDepthWriteChange: (v: boolean) => {
      state.depthWrite = v;
    },
  },
  setup: async (ctx) => {
    const tintBufs: GPUBuffer[] = [];
    const mats: Material[] = [];
    const quads: Mesh[] = [];

    try {
      // Sequential await: each material.create allocates a pipeline; running
      // them in parallel would risk duplicate-pipeline creation under the
      // material module's cache. See Task 12 leak-prevention notes.
      for (const spec of QUADS) {
        const tintBuf = createTintBuffer(ctx, spec.tint);
        tintBufs.push(tintBuf);
        const mat = await material.create(
          ctx,
          materialDescriptorFor(
            tintBuf,
            state.cull,
            state.depthWrite,
            spec.blend,
          ),
        );
        mats.push(mat);
        const quad = mesh.plane(ctx, { material: mat, size: QUAD_SIZE });
        mesh.setPosition(quad, new Float32Array(spec.position));
        quads.push(quad);
      }

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });

      const sceneQuads = quads;
      const sceneMats = mats;
      const sceneTintBufs = tintBufs;

      return {
        scene: { quads: sceneQuads, cam },
        dispose: () => {
          for (const q of sceneQuads) mesh.destroy(q);
          for (const m of sceneMats) material.destroy(m);
          for (const b of sceneTintBufs) b.destroy();
        },
      };
    } catch (e) {
      // Iterate the partials. Empty arrays no-op, so no guards needed.
      for (const q of quads) mesh.destroy(q);
      for (const m of mats) material.destroy(m);
      for (const b of tintBufs) b.destroy();
      throw e;
    }
  },
  frame: ({ ctx, scene }) => {
    frame.render(ctx, {
      draw: scene.quads,
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
