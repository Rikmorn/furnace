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
import shaderUrl from "./striped.wgsl";

const CAMERA_Z = 3;
const ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;
const PARAMS_BYTES = 16;
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

async function loadShaderSource(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`[furnace/cookbook] shader load: HTTP ${resp.status}`);
  }
  return resp.text();
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get stripes() {
      return state.stripes;
    },
    get hue() {
      return state.hue;
    },
    onStripesChange: (v: number) => {
      state.stripes = v;
    },
    onHueChange: (v: number) => {
      state.hue = v;
    },
  },
  setup: async (ctx) => {
    let paramsBuf: GPUBuffer | undefined;
    let mat: Material | undefined;
    let cube: Mesh | undefined;
    try {
      const source = await loadShaderSource(shaderUrl);

      paramsBuf = ctx.device.createBuffer({
        size: PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      mat = await material.create(ctx, {
        vertex: source,
        fragment: source,
        bindings: [{ binding: 0, resource: { buffer: paramsBuf } }],
      });

      cube = mesh.cube(ctx, { material: mat });

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });

      const sceneMat = mat;
      const sceneCube = cube;
      const sceneParamsBuf = paramsBuf;
      const rotBuf = quat.create();
      const paramsScratch = new Float32Array(4);

      return {
        scene: {
          mat: sceneMat,
          cube: sceneCube,
          cam,
          paramsBuf: sceneParamsBuf,
          rotBuf,
          paramsScratch,
        },
        dispose: () => {
          mesh.destroy(sceneCube);
          material.destroy(sceneMat);
          sceneParamsBuf.destroy();
        },
      };
    } catch (e) {
      if (cube) mesh.destroy(cube);
      if (mat) material.destroy(mat);
      if (paramsBuf) paramsBuf.destroy();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    state.angle += (info.deltaMs / MS_PER_S) * ROTATION_SPEED_RAD_PER_S;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(scene.cube, scene.rotBuf);

    scene.paramsScratch[0] = state.stripes;
    scene.paramsScratch[1] = state.hue;
    scene.paramsScratch[2] = 0;
    scene.paramsScratch[3] = 0;
    ctx.queue.writeBuffer(scene.paramsBuf, 0, scene.paramsScratch);

    frame.render(ctx, {
      draw: [scene.cube],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
