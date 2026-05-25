import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Effect } from "@furnace/core/post";
import * as post from "@furnace/core/post";
import { quat, vec3 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import bloomShaderUrl from "./bloom.wgsl";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const CAMERA_Z = 3;
const ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;
const PARAMS_BYTES = 16;
const PARAMS_FLOATS = 4;
const BRIGHT_COLOR: [number, number, number, number] = [1.0, 0.8, 1.0, 1.0];
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

async function loadShaderSource(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `[furnace/cookbook] bloom shader load: HTTP ${resp.status}`,
    );
  }
  return resp.text();
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get threshold() {
      return state.threshold;
    },
    get intensity() {
      return state.intensity;
    },
    get radius() {
      return state.radius;
    },
    get bypass() {
      return state.bypass;
    },
    onThresholdChange: (v: number) => {
      state.threshold = v;
    },
    onIntensityChange: (v: number) => {
      state.intensity = v;
    },
    onRadiusChange: (v: number) => {
      state.radius = v;
    },
    onBypassChange: (v: boolean) => {
      state.bypass = v;
    },
  },
  setup: async (ctx) => {
    let paramsBuf: GPUBuffer | undefined;
    let bloom: Effect | undefined;
    let brightMat: Material | undefined;
    let cube: Mesh | undefined;

    try {
      const bloomSource = await loadShaderSource(bloomShaderUrl);

      paramsBuf = ctx.device.createBuffer({
        size: PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      bloom = await post.create(ctx, {
        shader: bloomSource,
        bindings: [{ binding: 0, resource: { buffer: paramsBuf } }],
      });

      brightMat = await material.unlit(ctx, { color: BRIGHT_COLOR });
      cube = mesh.cube(ctx, { material: brightMat });

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });

      const sceneParamsBuf = paramsBuf;
      const sceneBloom = bloom;
      const sceneBrightMat = brightMat;
      const sceneCube = cube;
      const rotBuf = quat.create();
      const paramsScratch = new Float32Array(PARAMS_FLOATS);

      return {
        scene: {
          cube: sceneCube,
          brightMat: sceneBrightMat,
          cam,
          bloom: sceneBloom,
          paramsBuf: sceneParamsBuf,
          rotBuf,
          paramsScratch,
        },
        dispose: () => {
          mesh.destroy(sceneCube);
          material.destroy(sceneBrightMat);
          post.destroy(sceneBloom);
          sceneParamsBuf.destroy();
        },
      };
    } catch (e) {
      if (cube) mesh.destroy(cube);
      if (brightMat) material.destroy(brightMat);
      if (bloom) post.destroy(bloom);
      if (paramsBuf) paramsBuf.destroy();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    state.angle += (info.deltaMs / MS_PER_S) * ROTATION_SPEED_RAD_PER_S;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(scene.cube, scene.rotBuf);

    scene.paramsScratch[0] = state.threshold;
    scene.paramsScratch[1] = state.intensity;
    scene.paramsScratch[2] = state.radius;
    scene.paramsScratch[3] = 0;
    ctx.queue.writeBuffer(scene.paramsBuf, 0, scene.paramsScratch);

    frame.render(ctx, {
      draw: [scene.cube],
      camera: scene.cam,
      effects: state.bypass ? [] : [scene.bloom],
      clearColor: CLEAR_COLOR,
    });
  },
});
