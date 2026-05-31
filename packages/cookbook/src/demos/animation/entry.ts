import type { Camera, ScreenProjection } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec3, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const CAMERA_Z = 6;
const CUBE_X_SPACING = 1.8;
const MAX_CATCHUP_TICKS = 8;
const MS_PER_S = 1000;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

type LabelKey = "variable" | "no-interp" | "interp";

function requireLabel(key: LabelKey): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `#labels .cube-label[data-cube="${key}"]`,
  );
  if (!el) {
    throw new Error(
      `[furnace/cookbook] animation: label[data-cube=${key}] not found`,
    );
  }
  return el;
}

// Out-param `out` and `anchorBuf` are mutated to avoid per-frame allocation;
// called for each of three labels. anchorBuf is set to the cube's position
// (read via mesh.getPosition into a scratch buffer) plus (0, 0.6, 0) so the
// label projects above the cube's top face rather than its center.
function positionLabel(
  out: ScreenProjection,
  anchorBuf: Vec3,
  cam: Camera,
  cubePos: Vec3,
  vpW: number,
  vpH: number,
  labelEl: HTMLElement,
): void {
  vec3.set(
    anchorBuf,
    cubePos[0] as number,
    (cubePos[1] as number) + 0.6,
    cubePos[2] as number,
  );
  const visible = camera.projectToScreen(out, cam, anchorBuf, vpW, vpH);
  if (visible) {
    // translate(-50%, -50%) centers the label on the projected screen point;
    // anchor is above the cube so the label sits above the cube top.
    labelEl.style.transform = `translate(${out.x}px, ${out.y}px) translate(-50%, -50%)`;
    labelEl.style.display = "";
  } else {
    labelEl.style.display = "none";
  }
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get rate() {
      return state.rate;
    },
    get fixedHz() {
      return state.fixedHz;
    },
    onRateChange: (v: number) => {
      state.rate = v;
    },
    onFixedHzChange: (v: number) => {
      state.fixedHz = v;
    },
  },
  setup: async (ctx) => {
    // No teardown: gpu.dispose cascades through managed resources (mesh/
    // material/geometry) and auto-disconnects the resize binding. Explicit
    // destroy is an optimization, shown where it's genuinely needed:
    // mid-life churn (geometry, custom-stats) and raw resources (post).
    const mat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const cubeGeo = geometry.cube(ctx);
    const cubeVariable = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    const cubeNoInterp = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    const cubeInterp = mesh.create(ctx, { geometry: cubeGeo, material: mat });

    mesh.setPosition(ctx, cubeVariable, vec3.fromValues(-CUBE_X_SPACING, 0, 0));
    mesh.setPosition(ctx, cubeNoInterp, vec3.fromValues(0, 0, 0));
    mesh.setPosition(ctx, cubeInterp, vec3.fromValues(CUBE_X_SPACING, 0, 0));

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, CAMERA_Z),
    });
    camera.bindToCanvas(ctx, cam);

    // Pre-allocated per-frame scratch buffers. Mutated in frame(), never re-allocated.
    const rotBufVariable = quat.create();
    const rotBufNoInterp = quat.create();
    const rotBufInterp = quat.create();
    const posBufVariable = vec3.create();
    const posBufNoInterp = vec3.create();
    const posBufInterp = vec3.create();
    const projBuf: ScreenProjection = { x: 0, y: 0, w: 1 };
    const labelAnchorBuf = vec3.create();

    const labelVariable = requireLabel("variable");
    const labelNoInterp = requireLabel("no-interp");
    const labelInterp = requireLabel("interp");

    return {
      scene: {
        cubeVariable,
        cubeNoInterp,
        cubeInterp,
        cam,
        rotBufVariable,
        rotBufNoInterp,
        rotBufInterp,
        posBufVariable,
        posBufNoInterp,
        posBufInterp,
        projBuf,
        labelAnchorBuf,
        labelVariable,
        labelNoInterp,
        labelInterp,
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    // 1. Variable-dt advance — uses real elapsed time each RAF.
    state.angle += (info.deltaMs / MS_PER_S) * state.rate;

    // 2. Fixed-step accumulator. Mirrors frame.fixedLoop's algorithm so the
    //    pattern is visible in source; engine ships the packaged version as
    //    frame.fixedLoop.
    const fixedDtMs = MS_PER_S / state.fixedHz;
    const fixedDtSec = fixedDtMs / MS_PER_S;
    state.accumulatorMs += info.deltaMs;
    let ticks = 0;
    while (state.accumulatorMs >= fixedDtMs && ticks < MAX_CATCHUP_TICKS) {
      state.fixedPrevAngle = state.fixedCurrAngle;
      state.fixedCurrAngle += fixedDtSec * state.rate;
      state.accumulatorMs -= fixedDtMs;
      ticks++;
    }
    // Spiral-of-death guard: if the tick cap fired with work still pending,
    // discard the surplus. Naturally-drained sub-tick remainders are preserved.
    if (state.accumulatorMs >= fixedDtMs) {
      state.accumulatorMs = 0;
    }
    const alpha = state.accumulatorMs / fixedDtMs;

    // 3. Compute the alpha-lerped angle for the interp cube.
    const interpDisplayAngle =
      state.fixedPrevAngle +
      (state.fixedCurrAngle - state.fixedPrevAngle) * alpha;

    quat.fromEuler(scene.rotBufVariable, 0, state.angle, 0);
    mesh.setRotation(ctx, scene.cubeVariable, scene.rotBufVariable);
    quat.fromEuler(scene.rotBufNoInterp, 0, state.fixedCurrAngle, 0);
    mesh.setRotation(ctx, scene.cubeNoInterp, scene.rotBufNoInterp);
    quat.fromEuler(scene.rotBufInterp, 0, interpDisplayAngle, 0);
    mesh.setRotation(ctx, scene.cubeInterp, scene.rotBufInterp);

    const vpW = ctx.canvas.clientWidth;
    const vpH = ctx.canvas.clientHeight;
    positionLabel(
      scene.projBuf,
      scene.labelAnchorBuf,
      scene.cam,
      mesh.getPosition(ctx, scene.cubeVariable, scene.posBufVariable),
      vpW,
      vpH,
      scene.labelVariable,
    );
    positionLabel(
      scene.projBuf,
      scene.labelAnchorBuf,
      scene.cam,
      mesh.getPosition(ctx, scene.cubeNoInterp, scene.posBufNoInterp),
      vpW,
      vpH,
      scene.labelNoInterp,
    );
    positionLabel(
      scene.projBuf,
      scene.labelAnchorBuf,
      scene.cam,
      mesh.getPosition(ctx, scene.cubeInterp, scene.posBufInterp),
      vpW,
      vpH,
      scene.labelInterp,
    );

    frame.render(ctx, {
      draw: [scene.cubeVariable, scene.cubeNoInterp, scene.cubeInterp],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
