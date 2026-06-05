import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import * as texture from "@furnace/core/texture";
import type { Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { SamplerPreset } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";
import texturedUrl from "./textured.wgsl";

const PLANE_SIZE = 8;
// Tilt the plane so the far edge recedes sharply toward the horizon — this is
// the grazing angle where nearest / linear / AF16 are most visibly different.
// At 70° the texels near the top of the screen are extremely compressed, making
// anisotropic filtering the only option that still looks sharp.
const TILT_DEG = 70;
const CAMERA_POS = vec3.fromValues(0, 0.8, 3.5);
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.06, 0.06, 0.08, 1);

// All-linear filter params, reused by both the "linear" and "linear-af16"
// presets — AF rule: maxAnisotropy > 1 requires all three filters linear.
const LINEAR_FILTERS = {
  magFilter: "linear",
  minFilter: "linear",
  mipmapFilter: "linear",
} as const;

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get preset() {
      return state.preset;
    },
    onPresetChange: (v: SamplerPreset) => {
      state.preset = v;
    },
  },
  setup: async (ctx) => {
    // Load the consumer-authored textured shader against the public @group(1)
    // contract. textureBinding: true tells the engine that @group(1) is the
    // sampler+texture pair — material.create will require a texture descriptor.
    const texturedShader = await shader.load(ctx, texturedUrl, {
      textureBinding: true,
    });

    // Procedural checkerboard: mipmaps: true builds the full mip chain so that
    // mipmapFilter: "linear" and maxAnisotropy have real data to work from.
    // Without mipmaps, minification just samples the base level — you get
    // shimmering instead of smooth far-field filtering.
    const checkerTex = await texture.create(ctx, {
      ...texture.checkerboard({ size: 256, cells: 8 }),
      mipmaps: true,
    });

    // Build one Material per sampler preset. Sampler params are baked into the
    // Material at create time (GPUSampler is created once and cached). Swapping
    // the active preset is a mesh.setMaterial call — no GPU work per frame.

    // nearest: blocky pixellation, no smoothing. The classic "retro" look.
    // Also the baseline that shows just how much filtering buys you.
    const nearestMat = await material.create(ctx, {
      shader: texturedShader,
      texture: {
        texture: checkerTex,
        sampler: {
          magFilter: "nearest",
          minFilter: "nearest",
          mipmapFilter: "nearest",
          maxAnisotropy: 1,
        },
      },
    });

    // linear: smooth across texels and across mip levels, but no extra samples
    // at grazing angles — the far-field rows blur into grey.
    const linearMat = await material.create(ctx, {
      shader: texturedShader,
      texture: {
        texture: checkerTex,
        sampler: { ...LINEAR_FILTERS, maxAnisotropy: 1 },
      },
    });

    // linear + AF×16: same filtering as linear plus 16 anisotropic samples
    // along the axis of maximum compression. At grazing angles this is the
    // only option that keeps the checkerboard sharp all the way to the horizon.
    // AF rule: ALL THREE filters must be "linear" when maxAnisotropy > 1.
    const linearAf16Mat = await material.create(ctx, {
      shader: texturedShader,
      texture: {
        texture: checkerTex,
        sampler: { ...LINEAR_FILTERS, maxAnisotropy: 16 },
      },
    });

    const materials: Record<SamplerPreset, Material> = {
      nearest: nearestMat,
      linear: linearMat,
      "linear-af16": linearAf16Mat,
    };

    // Plane faces +Z by default. Rotate ~70° around X so it lies nearly flat
    // and recedes toward the horizon — this is the grazing-angle view that
    // makes AF differences visible.
    const rotBuf = quat.create();
    quat.fromEuler(rotBuf, -TILT_DEG, 0, 0);

    const planeGeo = geometry.plane(ctx, { size: PLANE_SIZE });
    const floor = mesh.create(ctx, {
      geometry: planeGeo,
      material: nearestMat,
    });
    mesh.setRotation(ctx, floor, rotBuf);
    mesh.setPosition(ctx, floor, vec3.fromValues(0, -0.5, 0));

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: CAMERA_POS,
      target: vec3.fromValues(0, 0, 0),
    });
    camera.bindToCanvas(ctx, cam);

    return {
      scene: { floor, cam, materials },
      dispose: () => {
        // Consumer-owned resources: shader and texture must be explicitly
        // destroyed. Meshes, materials, and geometry are cascade-freed by
        // gpu.dispose (called by mountDemo's cleanup path) — mirror the
        // discipline from the shader demo.
        shader.destroy(ctx, texturedShader);
        texture.destroy(ctx, checkerTex);
      },
    };
  },
  frame: ({ ctx, scene }) => {
    // Apply the active sampler preset by swapping the mesh's material. This is
    // O(1) — the material slots already exist; no GPU pipeline rebuild happens.
    mesh.setMaterial(ctx, scene.floor, scene.materials[state.preset]);

    frame.render(ctx, {
      draw: [scene.floor],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
