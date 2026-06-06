import * as binding from "@furnace/core/binding";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import type { PointerButton } from "@furnace/core/input";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const MOVE_SPEED_PER_SEC = 2.0;
const ZOOM_MIN = 1.5;
const ZOOM_MAX = 8.0;
const ZOOM_SPEED = 0.003;
const MS_PER_S = 1000;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

const COLORS: readonly Vec4[] = [
  vec4.fromValues(0.85, 0.4, 0.2, 1),
  vec4.fromValues(0.3, 0.7, 0.5, 1),
  vec4.fromValues(0.4, 0.5, 0.9, 1),
];

const BUTTON_LABELS: Readonly<Record<PointerButton, string>> = {
  0: "left",
  1: "middle",
  2: "right",
  3: "back",
  4: "forward",
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get keys() {
      return state.keys;
    },
    get pointer() {
      return state.pointer;
    },
    get wheelDeltaY() {
      return state.wheelDeltaY;
    },
  },
  setup: async (ctx) => {
    input.attach(ctx.canvas);

    try {
      // Sequential await so each material is created in order; the dispose
      // cascade frees them all (and their colour bindings) on teardown (no
      // per-handle destroy needed). One shared unlit shader (cached per ctx),
      // one colour binding per material.
      const unlitShader = await shader.unlit(ctx);
      const mats: Material[] = [];
      for (const c of COLORS) {
        const cb = binding.create(ctx, unlitShader);
        binding.set(ctx, cb, { color: c });
        mats.push(
          await material.create(ctx, { shader: unlitShader, binding: cb }),
        );
      }
      const first = mats[0];
      if (!first) throw new Error("[furnace/cookbook] no colors defined");
      const cubeGeo = geometry.cube(ctx);
      const cube = mesh.create(ctx, { geometry: cubeGeo, material: first });

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, state.cameraZ),
      });
      camera.bindToCanvas(ctx, cam);

      input.onKeyDown((e) => {
        if (!state.keys.includes(e.code)) state.keys = [...state.keys, e.code];
      });
      input.onKeyUp((e) => {
        state.keys = state.keys.filter((k) => k !== e.code);
      });
      input.onPointerMove((e) => {
        state.pointer = { ...state.pointer, x: e.x, y: e.y };
      });
      input.onPointerDown((e) => {
        if (e.button === null) return;
        const label = BUTTON_LABELS[e.button];
        if (!state.pointer.buttons.includes(label)) {
          state.pointer = {
            ...state.pointer,
            buttons: [...state.pointer.buttons, label],
          };
        }
        if (e.button === 0) {
          state.colorIdx = (state.colorIdx + 1) % COLORS.length;
          const nextMat = mats[state.colorIdx];
          if (nextMat) mesh.setMaterial(ctx, cube, nextMat);
        }
      });
      input.onPointerUp((e) => {
        if (e.button === null) return;
        const label = BUTTON_LABELS[e.button];
        state.pointer = {
          ...state.pointer,
          buttons: state.pointer.buttons.filter((b) => b !== label),
        };
      });
      input.onWheel((e) => {
        state.wheelDeltaY = e.deltaY;
        state.cameraZ = clamp(
          state.cameraZ + e.deltaY * ZOOM_SPEED,
          ZOOM_MIN,
          ZOOM_MAX,
        );
      });

      const positionBuf = vec3.create();
      const cameraPosBuf = vec3.create();

      // No managed teardown: gpu.dispose cascades the mesh/geometry/materials
      // and auto-disconnects the resize binding. Only input is torn down here.
      return {
        scene: {
          cube,
          cam,
          positionBuf,
          cameraPosBuf,
        },
        dispose: () => {
          input.detach();
        },
      };
    } catch (e) {
      input.detach();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    const dt = info.deltaMs / MS_PER_S;
    let dx = 0;
    let dy = 0;
    if (input.isKeyDown("KeyA") || input.isKeyDown("ArrowLeft")) dx -= 1;
    if (input.isKeyDown("KeyD") || input.isKeyDown("ArrowRight")) dx += 1;
    if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) dy += 1;
    if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) dy -= 1;
    if (dx !== 0 || dy !== 0) {
      const n = Math.hypot(dx, dy);
      const step = MOVE_SPEED_PER_SEC * dt;
      state.cubePos[0] += (dx / n) * step;
      state.cubePos[1] += (dy / n) * step;
      vec3.set(
        scene.positionBuf,
        state.cubePos[0],
        state.cubePos[1],
        state.cubePos[2],
      );
      mesh.setPosition(ctx, scene.cube, scene.positionBuf);
    }

    vec3.set(scene.cameraPosBuf, 0, 0, state.cameraZ);
    camera.setPosition(scene.cam, scene.cameraPosBuf);

    frame.render(ctx, {
      meshes: [scene.cube],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
