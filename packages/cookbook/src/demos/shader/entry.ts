import * as binding from "@furnace/core/binding";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

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
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

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
    const stripedShader = await shader.load(ctx, stripedShaderUrl, {
      layout: { stripes: "f32", hue: "f32", softness: "f32" },
    });
    const plasmaShader = await shader.load(ctx, plasmaShaderUrl, {
      layout: { time: "f32", scale: "f32", colorPhase: "f32" },
    });

    const stripedBinding = binding.create(ctx, stripedShader);
    binding.set(ctx, stripedBinding, {
      stripes: state.stripes,
      hue: state.hue,
      softness: state.softness,
    });

    const plasmaBinding = binding.create(ctx, plasmaShader);
    binding.set(ctx, plasmaBinding, {
      time: state.time,
      scale: state.plasmaScale,
      colorPhase: state.plasmaPhase,
    });

    const stripedMat = await material.create(ctx, {
      shader: stripedShader,
      binding: stripedBinding,
    });
    const plasmaMat = await material.create(ctx, {
      shader: plasmaShader,
      binding: plasmaBinding,
    });

    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, {
      geometry: cubeGeo,
      material: stripedMat,
    });
    const backdropGeo = geometry.plane(ctx, { size: BACKDROP_SIZE });
    const backdrop = mesh.create(ctx, {
      geometry: backdropGeo,
      material: plasmaMat,
    });
    mesh.setPosition(ctx, backdrop, vec3.fromValues(0, 0, BACKDROP_Z));

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, CAMERA_Z),
    });
    camera.bindToCanvas(ctx, cam);

    const rotBuf = quat.create();

    return {
      scene: {
        cube,
        backdrop,
        cam,
        stripedBinding,
        plasmaBinding,
        rotBuf,
      },
      dispose: () => {
        // gpu.dispose cascades the meshes/materials/geometries and
        // auto-disconnects the resize binding. Bindings own their GPUBuffers —
        // destroy them explicitly here to match the per-resource teardown discipline.
        binding.destroy(ctx, plasmaBinding);
        binding.destroy(ctx, stripedBinding);
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    const dt = info.deltaMs / MS_PER_S;
    state.angle += dt * ROTATION_SPEED_RAD_PER_S;
    state.time += dt;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(ctx, scene.cube, scene.rotBuf);

    // Striped: all three fields are user-controllable sliders — write each frame.
    binding.setUniform(ctx, scene.stripedBinding, "stripes", state.stripes);
    binding.setUniform(ctx, scene.stripedBinding, "hue", state.hue);
    binding.setUniform(ctx, scene.stripedBinding, "softness", state.softness);

    // Plasma: time advances every frame; scale and phase are user-controllable.
    binding.setUniform(ctx, scene.plasmaBinding, "time", state.time);
    binding.setUniform(ctx, scene.plasmaBinding, "scale", state.plasmaScale);
    binding.setUniform(
      ctx,
      scene.plasmaBinding,
      "colorPhase",
      state.plasmaPhase,
    );

    frame.render(ctx, {
      meshes: [scene.backdrop, scene.cube],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
