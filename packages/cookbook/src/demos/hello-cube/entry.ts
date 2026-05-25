import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Vec3 } from "@furnace/core/transform";
import { vec3 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import {
  type CameraKind,
  controlsState,
  type MaterialKind,
  orbit,
} from "./state.svelte.ts";

const PLANE_BACKDROP_SIZE = 6;
const PLANE_Z = -2;
const CAMERA_RADIUS = 4;
const ORBIT_SPEED_DEG_PER_PX = 0.4;
const PITCH_LIMIT_DEG = 89;
const ORTHO_HALF_EXTENT = 3;
const ORTHO_NEAR = 0.1;
const ORTHO_FAR = 100;
const DEG_TO_RAD = Math.PI / 180;
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

function writeOrbitEye(out: Vec3): void {
  const yaw = orbit.yawDeg * DEG_TO_RAD;
  const pitch = orbit.pitchDeg * DEG_TO_RAD;
  vec3.set(
    out,
    CAMERA_RADIUS * Math.cos(pitch) * Math.sin(yaw),
    CAMERA_RADIUS * Math.sin(pitch),
    CAMERA_RADIUS * Math.cos(pitch) * Math.cos(yaw),
  );
}

function clampPitchDeg(deg: number): number {
  return Math.max(-PITCH_LIMIT_DEG, Math.min(PITCH_LIMIT_DEG, deg));
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get cameraKind() {
      return controlsState.cameraKind;
    },
    get materialKind() {
      return controlsState.materialKind;
    },
    onCameraChange: (next: CameraKind) => {
      controlsState.cameraKind = next;
    },
    onMaterialChange: (next: MaterialKind) => {
      controlsState.materialKind = next;
    },
  },
  setup: async (ctx) => {
    input.attach(ctx.canvas);

    let unlitMat: Material | undefined;
    let normalMat: Material | undefined;
    let planeMat: Material | undefined;
    let cube: Mesh | undefined;
    let plane: Mesh | undefined;
    let unsubResize: (() => void) | undefined;

    try {
      unlitMat = await material.unlit(ctx, { color: [0.85, 0.4, 0.2, 1] });
      normalMat = await material.normalColor(ctx);
      planeMat = await material.unlit(ctx, { color: [0.1, 0.1, 0.12, 1] });

      cube = mesh.create(ctx, {
        geometry: mesh.cubeGeometry(ctx),
        material: unlitMat,
      });
      plane = mesh.plane(ctx, {
        material: planeMat,
        size: PLANE_BACKDROP_SIZE,
      });
      mesh.setPosition(plane, vec3.fromValues(0, 0, PLANE_Z));

      const perspectiveCam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_RADIUS),
      });
      const orthographicCam = camera.orthographic({
        left: -ORTHO_HALF_EXTENT,
        right: ORTHO_HALF_EXTENT,
        bottom: -ORTHO_HALF_EXTENT,
        top: ORTHO_HALF_EXTENT,
        near: ORTHO_NEAR,
        far: ORTHO_FAR,
        position: vec3.fromValues(0, 0, CAMERA_RADIUS),
      });

      unsubResize = gpu.onResize(ctx, ({ width, height }) => {
        camera.setAspect(perspectiveCam, width / height);
        camera.setAspect(orthographicCam, width / height);
      });

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      input.onPointerDown((e) => {
        dragging = true;
        lastX = e.x;
        lastY = e.y;
      });
      input.onPointerUp(() => {
        dragging = false;
      });
      input.onPointerMove((e) => {
        if (!dragging) return;
        orbit.yawDeg += (e.x - lastX) * ORBIT_SPEED_DEG_PER_PX;
        orbit.pitchDeg = clampPitchDeg(
          orbit.pitchDeg - (e.y - lastY) * ORBIT_SPEED_DEG_PER_PX,
        );
        lastX = e.x;
        lastY = e.y;
      });

      // Pre-allocate per-frame vec3 scratch buffers so frame() mutates them
      // via vec3.set instead of allocating two Float32Array(3) every frame.
      const eyeBuf = vec3.create();
      const targetBuf = vec3.fromValues(0, 0, 0);

      const sceneCube = cube;
      const scenePlane = plane;
      const sceneUnlitMat = unlitMat;
      const sceneNormalMat = normalMat;
      const scenePlaneMat = planeMat;
      const sceneUnsubResize = unsubResize;
      return {
        scene: {
          cube: sceneCube,
          plane: scenePlane,
          perspectiveCam,
          orthographicCam,
          unlitMat: sceneUnlitMat,
          normalMat: sceneNormalMat,
          planeMat: scenePlaneMat,
          eyeBuf,
          targetBuf,
        },
        dispose: () => {
          sceneUnsubResize();
          mesh.destroy(sceneCube);
          mesh.destroy(scenePlane);
          material.destroy(sceneUnlitMat);
          material.destroy(sceneNormalMat);
          material.destroy(scenePlaneMat);
          input.detach();
        },
      };
    } catch (e) {
      if (unsubResize) unsubResize();
      if (cube) mesh.destroy(cube);
      if (plane) mesh.destroy(plane);
      if (unlitMat) material.destroy(unlitMat);
      if (normalMat) material.destroy(normalMat);
      if (planeMat) material.destroy(planeMat);
      input.detach();
      throw e;
    }
  },
  frame: ({ ctx, scene }) => {
    writeOrbitEye(scene.eyeBuf);
    const activeCam =
      controlsState.cameraKind === "perspective"
        ? scene.perspectiveCam
        : scene.orthographicCam;
    camera.setPosition(activeCam, scene.eyeBuf);
    camera.setTarget(activeCam, scene.targetBuf);

    scene.cube.material =
      controlsState.materialKind === "unlit" ? scene.unlitMat : scene.normalMat;

    frame.render(ctx, {
      draw: [scene.plane, scene.cube],
      camera: activeCam,
      clearColor: CLEAR_COLOR,
    });
  },
});
