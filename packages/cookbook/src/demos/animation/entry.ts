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
import { type LoopKind, state } from "./state.svelte.ts";

const CAMERA_Z = 3;
const FIXED_DT_S = 1 / 60;
const MS_PER_S = 1000;
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get rate() {
      return state.rate;
    },
    get scale() {
      return state.scale;
    },
    get loopKind() {
      return state.loopKind;
    },
    onRateChange: (v: number) => {
      state.rate = v;
    },
    onScaleChange: (v: number) => {
      state.scale = v;
    },
    onLoopChange: (v: LoopKind) => {
      state.loopKind = v;
    },
  },
  setup: async (ctx) => {
    let mat: Material | undefined;
    let cube: Mesh | undefined;
    try {
      mat = await material.normalColor(ctx);
      cube = mesh.cube(ctx, { material: mat });
      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });

      // Pre-allocated per-frame scratch buffers — mutated in frame(),
      // never re-allocated. Establishes the no-per-frame-allocation pattern.
      const rotBuf = quat.create();
      const scaleBuf = vec3.create();

      const sceneMat = mat;
      const sceneCube = cube;
      return {
        scene: { mat: sceneMat, cube: sceneCube, cam, rotBuf, scaleBuf },
        dispose: () => {
          mesh.destroy(sceneCube);
          material.destroy(sceneMat);
        },
      };
    } catch (e) {
      if (cube) mesh.destroy(cube);
      if (mat) material.destroy(mat);
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    const dt = state.loopKind === "loop" ? info.deltaMs / MS_PER_S : FIXED_DT_S;
    state.angle += dt * state.rate;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(scene.cube, scene.rotBuf);
    vec3.set(scene.scaleBuf, state.scale, state.scale, state.scale);
    mesh.setScale(scene.cube, scene.scaleBuf);

    frame.render(ctx, {
      draw: [scene.cube],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
