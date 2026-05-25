import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import { quat, vec3 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const PIP_TEX_WIDTH = 512;
const PIP_TEX_HEIGHT = 512;
const MAIN_CAMERA_Z = 3;
const PIP_CAMERA_X = 3;
const PIP_CAMERA_Y = 2;
const PIP_CAMERA_Z = 3;
const PIP_QUAD_BASE_SCALE = 1.2;
const PIP_QUAD_BASE_OFFSET = 1.5;
const PIP_QUAD_TOP_OFFSET = 1.0;
const PIP_QUAD_Z_DEPTH = 1.5;
const PIP_QUAD_SIZE = 1;
const ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;
const CLEAR_COLOR_MAIN: [number, number, number, number] = [
  0.05, 0.05, 0.07, 1,
];
const CLEAR_COLOR_PIP: [number, number, number, number] = [0.1, 0.05, 0.05, 1];

const PIP_SHADER = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var pipTex: texture_2d<f32>;
@group(1) @binding(1) var pipSamp: sampler;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.clip_pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  out.uv = v.uv;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(pipTex, pipSamp, in.uv);
}
`;

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get pipSize() {
      return state.pipSize;
    },
    onPipSizeChange: (v: number) => {
      state.pipSize = v;
    },
  },
  setup: async (ctx) => {
    let cubeMat: Material | undefined;
    let cube: Mesh | undefined;
    let pipTex: GPUTexture | undefined;
    let pipDepth: GPUTexture | undefined;
    let pipMat: Material | undefined;
    let pipQuad: Mesh | undefined;

    try {
      cubeMat = await material.normalColor(ctx);
      cube = mesh.cube(ctx, { material: cubeMat });

      pipTex = ctx.device.createTexture({
        size: { width: PIP_TEX_WIDTH, height: PIP_TEX_HEIGHT },
        format: ctx.format,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      pipDepth = ctx.device.createTexture({
        size: { width: PIP_TEX_WIDTH, height: PIP_TEX_HEIGHT },
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const pipSampler = ctx.device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });

      // The texture view bound here is captured by the material's group1 at
      // creation time. If pipTex were ever recreated (e.g. on canvas resize,
      // which this demo doesn't do), this view would become stale and the
      // material would need to be rebuilt.
      pipMat = await material.create(ctx, {
        vertex: PIP_SHADER,
        fragment: PIP_SHADER,
        bindings: [
          { binding: 0, resource: pipTex.createView() },
          { binding: 1, resource: pipSampler },
        ],
      });
      pipQuad = mesh.plane(ctx, { material: pipMat, size: PIP_QUAD_SIZE });

      const mainCam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, MAIN_CAMERA_Z),
      });
      const pipCam = camera.perspective({
        aspect: 1,
        position: vec3.fromValues(PIP_CAMERA_X, PIP_CAMERA_Y, PIP_CAMERA_Z),
        target: vec3.fromValues(0, 0, 0),
      });

      const sceneCubeMat = cubeMat;
      const sceneCube = cube;
      const scenePipTex = pipTex;
      const scenePipDepth = pipDepth;
      const scenePipMat = pipMat;
      const scenePipQuad = pipQuad;
      const rotBuf = quat.create();
      const scaleBuf = vec3.create();
      const positionBuf = vec3.create();

      return {
        scene: {
          cube: sceneCube,
          mainCam,
          pipCam,
          pipTex: scenePipTex,
          pipDepth: scenePipDepth,
          pipQuad: scenePipQuad,
          rotBuf,
          scaleBuf,
          positionBuf,
        },
        dispose: () => {
          mesh.destroy(sceneCube);
          mesh.destroy(scenePipQuad);
          material.destroy(sceneCubeMat);
          material.destroy(scenePipMat);
          scenePipTex.destroy();
          scenePipDepth.destroy();
        },
      };
    } catch (e) {
      if (cube) mesh.destroy(cube);
      if (pipQuad) mesh.destroy(pipQuad);
      if (cubeMat) material.destroy(cubeMat);
      if (pipMat) material.destroy(pipMat);
      if (pipTex) pipTex.destroy();
      if (pipDepth) pipDepth.destroy();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    state.angle += (info.deltaMs / MS_PER_S) * ROTATION_SPEED_RAD_PER_S;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(scene.cube, scene.rotBuf);

    // Pass 1: render the rotating cube into the PiP texture from the PiP camera.
    frame.renderToTexture(ctx, {
      texture: scene.pipTex,
      depthTexture: scene.pipDepth,
      draw: [scene.cube],
      camera: scene.pipCam,
      clearColor: CLEAR_COLOR_PIP,
    });

    // Approximate a screen-space corner overlay in world space — the PiP quad
    // sits in front of the main camera, scaled by the slider. Honest about the
    // simplification: see gaps[] in help.ts.
    const pipScale = state.pipSize * PIP_QUAD_BASE_SCALE;
    vec3.set(scene.scaleBuf, pipScale, pipScale, 1);
    mesh.setScale(scene.pipQuad, scene.scaleBuf);

    const pipX = PIP_QUAD_BASE_OFFSET - state.pipSize;
    const pipY = PIP_QUAD_TOP_OFFSET - state.pipSize;
    vec3.set(scene.positionBuf, pipX, pipY, PIP_QUAD_Z_DEPTH);
    mesh.setPosition(scene.pipQuad, scene.positionBuf);

    // Pass 2: main scene + PiP overlay to the swapchain.
    frame.render(ctx, {
      draw: [scene.cube, scene.pipQuad],
      camera: scene.mainCam,
      clearColor: CLEAR_COLOR_MAIN,
    });
  },
});
