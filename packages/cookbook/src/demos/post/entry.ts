import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Geometry, Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Effect } from "@furnace/core/post";
import * as post from "@furnace/core/post";
import type { Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import bloomShaderUrl from "./bloom.wgsl";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";
import vignetteShaderUrl from "./vignette.wgsl";

const CAMERA_Z = 3;
const ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;
const BLOOM_PARAMS_SIZE = 16; // 4 floats — see BloomParams in bloom.wgsl
const VIGNETTE_PARAMS_SIZE = 16; // 4 floats — see VignetteParams in vignette.wgsl
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

async function loadShaderSource(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`[furnace/cookbook] post shader load: HTTP ${resp.status}`);
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
    get haloMaskStart() {
      return state.haloMaskStart;
    },
    get vignetteStrength() {
      return state.vignetteStrength;
    },
    get vignetteFalloff() {
      return state.vignetteFalloff;
    },
    get bloomOn() {
      return state.bloomOn;
    },
    get vignetteOn() {
      return state.vignetteOn;
    },
    get swapOrder() {
      return state.swapOrder;
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
    onHaloMaskStartChange: (v: number) => {
      state.haloMaskStart = v;
    },
    onVignetteStrengthChange: (v: number) => {
      state.vignetteStrength = v;
    },
    onVignetteFalloffChange: (v: number) => {
      state.vignetteFalloff = v;
    },
    onBloomOnChange: (v: boolean) => {
      state.bloomOn = v;
    },
    onVignetteOnChange: (v: boolean) => {
      state.vignetteOn = v;
    },
    onSwapOrderChange: (v: boolean) => {
      state.swapOrder = v;
    },
  },
  setup: async (ctx) => {
    let paramsBufBloom: GPUBuffer | undefined;
    let paramsBufVignette: GPUBuffer | undefined;
    let bloom: Effect | undefined;
    let vignette: Effect | undefined;
    let normalMat: Material | undefined;
    let cube: Mesh | undefined;
    let cubeGeo: Geometry | undefined;
    let unsubResize: (() => void) | undefined;

    try {
      const bloomSource = await loadShaderSource(bloomShaderUrl);
      const vignetteSource = await loadShaderSource(vignetteShaderUrl);

      paramsBufBloom = ctx.device.createBuffer({
        size: BLOOM_PARAMS_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      paramsBufVignette = ctx.device.createBuffer({
        size: VIGNETTE_PARAMS_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      bloom = await post.create(ctx, {
        shader: bloomSource,
        bindings: [{ binding: 0, resource: { buffer: paramsBufBloom } }],
      });
      vignette = await post.create(ctx, {
        shader: vignetteSource,
        bindings: [{ binding: 0, resource: { buffer: paramsBufVignette } }],
      });

      normalMat = await material.normalColor(ctx);
      cubeGeo = mesh.cubeGeometry(ctx);
      cube = mesh.create(ctx, { geometry: cubeGeo, material: normalMat });

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });
      unsubResize = camera.bindToCanvas(cam, ctx);

      const sceneUnsubResize = unsubResize;
      const sceneParamsBufBloom = paramsBufBloom;
      const sceneParamsBufVignette = paramsBufVignette;
      const sceneBloom = bloom;
      const sceneVignette = vignette;
      const sceneNormalMat = normalMat;
      const sceneCube = cube;
      const sceneCubeGeo = cubeGeo;
      const rotBuf = quat.create();
      const paramsScratchBloom = new Float32Array(4);
      const paramsScratchVignette = new Float32Array(4);

      return {
        scene: {
          cube: sceneCube,
          normalMat: sceneNormalMat,
          cam,
          bloom: sceneBloom,
          vignette: sceneVignette,
          paramsBufBloom: sceneParamsBufBloom,
          paramsBufVignette: sceneParamsBufVignette,
          rotBuf,
          paramsScratchBloom,
          paramsScratchVignette,
        },
        dispose: () => {
          sceneUnsubResize();
          mesh.destroy(ctx, sceneCube);
          mesh.destroyGeometry(ctx, sceneCubeGeo);
          material.destroy(ctx, sceneNormalMat);
          post.destroy(ctx, sceneVignette);
          post.destroy(ctx, sceneBloom);
          sceneParamsBufVignette.destroy();
          sceneParamsBufBloom.destroy();
        },
      };
    } catch (e) {
      if (unsubResize) unsubResize();
      if (cube) mesh.destroy(ctx, cube);
      if (cubeGeo) mesh.destroyGeometry(ctx, cubeGeo);
      if (normalMat) material.destroy(ctx, normalMat);
      if (vignette) post.destroy(ctx, vignette);
      if (bloom) post.destroy(ctx, bloom);
      if (paramsBufVignette) paramsBufVignette.destroy();
      if (paramsBufBloom) paramsBufBloom.destroy();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    state.angle += (info.deltaMs / MS_PER_S) * ROTATION_SPEED_RAD_PER_S;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(ctx, scene.cube, scene.rotBuf);

    // Both uniform buffers are written every frame, even when their effect is off
    // or the slider hasn't moved. Cheap at 16 bytes; real consumers can gate on dirty state.
    scene.paramsScratchBloom[0] = state.threshold;
    scene.paramsScratchBloom[1] = state.intensity;
    scene.paramsScratchBloom[2] = state.radius;
    scene.paramsScratchBloom[3] = state.haloMaskStart;
    ctx.queue.writeBuffer(scene.paramsBufBloom, 0, scene.paramsScratchBloom);

    scene.paramsScratchVignette[0] = state.vignetteStrength;
    scene.paramsScratchVignette[1] = state.vignetteFalloff;
    scene.paramsScratchVignette[2] = 0;
    scene.paramsScratchVignette[3] = 0;
    ctx.queue.writeBuffer(
      scene.paramsBufVignette,
      0,
      scene.paramsScratchVignette,
    );

    const base = state.swapOrder
      ? [
          { on: state.vignetteOn, fx: scene.vignette },
          { on: state.bloomOn, fx: scene.bloom },
        ]
      : [
          { on: state.bloomOn, fx: scene.bloom },
          { on: state.vignetteOn, fx: scene.vignette },
        ];
    const effects = base.filter((slot) => slot.on).map((slot) => slot.fx);

    frame.render(ctx, {
      draw: [scene.cube],
      camera: scene.cam,
      effects,
      clearColor: CLEAR_COLOR,
    });
  },
});
