import * as binding from "@furnace/core/binding";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as post from "@furnace/core/post";
import * as shader from "@furnace/core/shader";
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
// @group(1) param schemas — field order + tokens match the WGSL structs.
const BLOOM_LAYOUT = {
  threshold: "f32",
  intensity: "f32",
  radius: "f32",
  haloMaskStart: "f32",
} as const;
const VIGNETTE_LAYOUT = { strength: "f32", falloff: "f32" } as const;
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
    const bloomSource = await loadShaderSource(bloomShaderUrl);
    const vignetteSource = await loadShaderSource(vignetteShaderUrl);

    // Compile each post shader with its @group(1) param schema, then pair a
    // typed Binding to it. The bridge sizes the uniform buffer from the schema
    // (no hand-counted byte sizes, no _pad fields) and lazily flushes the
    // per-frame writes at the render boundary.
    const bloomShader = await shader.create(ctx, bloomSource, {
      layout: BLOOM_LAYOUT,
    });
    const vignetteShader = await shader.create(ctx, vignetteSource, {
      layout: VIGNETTE_LAYOUT,
    });
    const bloomBinding = binding.create(ctx, bloomShader);
    const vignetteBinding = binding.create(ctx, vignetteShader);

    const bloom = await post.create(ctx, {
      shader: bloomShader,
      binding: bloomBinding,
    });
    const vignette = await post.create(ctx, {
      shader: vignetteShader,
      binding: vignetteBinding,
    });

    const normalMat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: normalMat });

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, CAMERA_Z),
    });
    camera.bindToCanvas(ctx, cam);

    const rotBuf = quat.create();

    return {
      scene: {
        cube,
        cam,
        bloom,
        vignette,
        bloomBinding,
        vignetteBinding,
        rotBuf,
      },
      // gpu.dispose cascades the mesh/material/geometry/effects/bindings and
      // auto-disconnects the resize binding. The typed Bindings are managed
      // pool slots, so the cascade frees their buffers — no manual teardown.
    };
  },
  frame: ({ ctx, scene, info }) => {
    state.angle += (info.deltaMs / MS_PER_S) * ROTATION_SPEED_RAD_PER_S;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(ctx, scene.cube, scene.rotBuf);

    // Both bindings are written every frame, even when their effect is off or
    // the slider hasn't moved. binding.set is lazy — it stages the CPU scratch
    // and flushes once at the render boundary. Real consumers can gate on dirty
    // state; here we keep it simple.
    binding.set(ctx, scene.bloomBinding, {
      threshold: state.threshold,
      intensity: state.intensity,
      radius: state.radius,
      haloMaskStart: state.haloMaskStart,
    });
    binding.set(ctx, scene.vignetteBinding, {
      strength: state.vignetteStrength,
      falloff: state.vignetteFalloff,
    });

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
      meshes: [scene.cube],
      camera: scene.cam,
      effects,
      clearColor: CLEAR_COLOR,
    });
  },
});
