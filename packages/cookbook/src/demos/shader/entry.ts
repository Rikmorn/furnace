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
import plasmaShaderUrl from "./plasma.wgsl";
import { state } from "./state.svelte.ts";
import stripedShaderUrl from "./striped.wgsl";

const CAMERA_Z = 3;
const BACKDROP_Z = -2;
const BACKDROP_SIZE = 12; // covers ultrawide viewports — see spec
const ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;
const STRIPED_PARAMS_SIZE = 16; // 4 floats — see Params in striped.wgsl
const PLASMA_PARAMS_SIZE = 16; // 4 floats — see Params in plasma.wgsl
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
    get softness() {
      return state.softness;
    },
    get plasmaScale() {
      return state.plasmaScale;
    },
    get plasmaPhase() {
      return state.plasmaPhase;
    },
    onStripesChange: (v: number) => {
      state.stripes = v;
    },
    onHueChange: (v: number) => {
      state.hue = v;
    },
    onSoftnessChange: (v: number) => {
      state.softness = v;
    },
    onPlasmaScaleChange: (v: number) => {
      state.plasmaScale = v;
    },
    onPlasmaPhaseChange: (v: number) => {
      state.plasmaPhase = v;
    },
  },
  setup: async (ctx) => {
    let paramsBufStriped: GPUBuffer | undefined;
    let paramsBufPlasma: GPUBuffer | undefined;
    let stripedMat: Material | undefined;
    let plasmaMat: Material | undefined;
    let cube: Mesh | undefined;
    let backdrop: Mesh | undefined;

    try {
      const stripedSource = await loadShaderSource(stripedShaderUrl);
      const plasmaSource = await loadShaderSource(plasmaShaderUrl);

      paramsBufStriped = ctx.device.createBuffer({
        size: STRIPED_PARAMS_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      paramsBufPlasma = ctx.device.createBuffer({
        size: PLASMA_PARAMS_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      stripedMat = await material.create(ctx, {
        vertex: stripedSource,
        fragment: stripedSource,
        bindings: [{ binding: 0, resource: { buffer: paramsBufStriped } }],
      });
      plasmaMat = await material.create(ctx, {
        vertex: plasmaSource,
        fragment: plasmaSource,
        bindings: [{ binding: 0, resource: { buffer: paramsBufPlasma } }],
      });

      cube = mesh.cube(ctx, { material: stripedMat });
      backdrop = mesh.plane(ctx, {
        material: plasmaMat,
        size: BACKDROP_SIZE,
      });
      mesh.setPosition(backdrop, vec3.fromValues(0, 0, BACKDROP_Z));

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });

      const sceneParamsBufStriped = paramsBufStriped;
      const sceneParamsBufPlasma = paramsBufPlasma;
      const sceneStripedMat = stripedMat;
      const scenePlasmaMat = plasmaMat;
      const sceneCube = cube;
      const sceneBackdrop = backdrop;
      const rotBuf = quat.create();
      const paramsScratchStriped = new Float32Array(4);
      const paramsScratchPlasma = new Float32Array(4);

      return {
        scene: {
          cube: sceneCube,
          backdrop: sceneBackdrop,
          stripedMat: sceneStripedMat,
          plasmaMat: scenePlasmaMat,
          cam,
          paramsBufStriped: sceneParamsBufStriped,
          paramsBufPlasma: sceneParamsBufPlasma,
          rotBuf,
          paramsScratchStriped,
          paramsScratchPlasma,
        },
        dispose: () => {
          mesh.destroy(sceneBackdrop);
          mesh.destroy(sceneCube);
          material.destroy(scenePlasmaMat);
          material.destroy(sceneStripedMat);
          sceneParamsBufPlasma.destroy();
          sceneParamsBufStriped.destroy();
        },
      };
    } catch (e) {
      if (backdrop) mesh.destroy(backdrop);
      if (cube) mesh.destroy(cube);
      if (plasmaMat) material.destroy(plasmaMat);
      if (stripedMat) material.destroy(stripedMat);
      if (paramsBufPlasma) paramsBufPlasma.destroy();
      if (paramsBufStriped) paramsBufStriped.destroy();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    const dt = info.deltaMs / MS_PER_S;
    state.angle += dt * ROTATION_SPEED_RAD_PER_S;
    state.time += dt;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(scene.cube, scene.rotBuf);

    // Both uniform buffers written every frame. Cheap at 16 bytes; real
    // consumers can gate on dirty state.
    scene.paramsScratchStriped[0] = state.stripes;
    scene.paramsScratchStriped[1] = state.hue;
    scene.paramsScratchStriped[2] = state.softness;
    scene.paramsScratchStriped[3] = 0;
    ctx.queue.writeBuffer(
      scene.paramsBufStriped,
      0,
      scene.paramsScratchStriped,
    );

    scene.paramsScratchPlasma[0] = state.time;
    scene.paramsScratchPlasma[1] = state.plasmaScale;
    scene.paramsScratchPlasma[2] = state.plasmaPhase;
    scene.paramsScratchPlasma[3] = 0;
    ctx.queue.writeBuffer(scene.paramsBufPlasma, 0, scene.paramsScratchPlasma);

    frame.render(ctx, {
      draw: [scene.backdrop, scene.cube],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
