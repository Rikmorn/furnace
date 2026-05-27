import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Geometry, Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Vec3, Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { CameraKind } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

const PLANE_BACKDROP_SIZE = 6;
const PLANE_Z = -2;
const CAMERA_RADIUS = 4;
const ORBIT_SPEED_DEG_PER_PX = 0.4;
const PITCH_LIMIT_DEG = 89;
const NEAR_FAR_MIN_GAP = 0.05;
const DEG_TO_RAD = Math.PI / 180;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

function writeOrbitEye(out: Vec3): void {
  const yaw = state.yawDeg * DEG_TO_RAD;
  const pitch = state.pitchDeg * DEG_TO_RAD;
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
      return state.cameraKind;
    },
    get fovDeg() {
      return state.fovDeg;
    },
    get zoom() {
      return state.zoom;
    },
    get near() {
      return state.near;
    },
    get far() {
      return state.far;
    },
    onCameraKindChange: (v: CameraKind) => {
      state.cameraKind = v;
    },
    onFovDegChange: (v: number) => {
      state.fovDeg = v;
    },
    onZoomChange: (v: number) => {
      state.zoom = v;
    },
    onNearChange: (v: number) => {
      // camera.setNearFar throws if near >= far (and if near <= 0 for
      // perspective). Clamp so the user can't drive the engine into an
      // invalid state from the slider.
      state.near = Math.min(v, state.far - NEAR_FAR_MIN_GAP);
    },
    onFarChange: (v: number) => {
      state.far = Math.max(v, state.near + NEAR_FAR_MIN_GAP);
    },
  },
  setup: async (ctx) => {
    input.attach(ctx.canvas);

    let normalMat: Material | undefined;
    let planeMat: Material | undefined;
    let cube: Mesh | undefined;
    let plane: Mesh | undefined;
    let cubeGeo: Geometry | undefined;
    let planeGeo: Geometry | undefined;
    let unsubResize: (() => void) | undefined;

    try {
      normalMat = await material.normalColor(ctx);
      planeMat = await material.unlit(ctx, {
        color: vec4.fromValues(0.1, 0.1, 0.12, 1),
      });

      cubeGeo = mesh.cubeGeometry(ctx);
      cube = mesh.create(ctx, { geometry: cubeGeo, material: normalMat });
      planeGeo = mesh.planeGeometry(ctx, { size: PLANE_BACKDROP_SIZE });
      plane = mesh.create(ctx, { geometry: planeGeo, material: planeMat });
      mesh.setPosition(plane, vec3.fromValues(0, 0, PLANE_Z));

      const initialAspect = ctx.canvas.width / ctx.canvas.height;
      const perspectiveCam = camera.perspective({
        aspect: initialAspect,
        position: vec3.fromValues(0, 0, CAMERA_RADIUS),
      });
      const orthographicCam = camera.orthographic({
        left: -state.zoom * initialAspect,
        right: state.zoom * initialAspect,
        bottom: -state.zoom,
        top: state.zoom,
        near: state.near,
        far: state.far,
        position: vec3.fromValues(0, 0, CAMERA_RADIUS),
      });

      unsubResize = camera.bindToCanvas(perspectiveCam, ctx);
      // Orthographic aspect is handled per-frame via setBounds below — bindToCanvas
      // is a no-op for orthographic cameras in this tranche (Tranche A-2 will
      // introduce a configurable fitPolicy).

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
        state.yawDeg += (e.x - lastX) * ORBIT_SPEED_DEG_PER_PX;
        state.pitchDeg = clampPitchDeg(
          state.pitchDeg - (e.y - lastY) * ORBIT_SPEED_DEG_PER_PX,
        );
        lastX = e.x;
        lastY = e.y;
      });

      const eyeBuf = vec3.create();
      const targetBuf = vec3.fromValues(0, 0, 0);

      const sceneCube = cube;
      const scenePlane = plane;
      const sceneCubeGeo = cubeGeo;
      const scenePlaneGeo = planeGeo;
      const sceneNormalMat = normalMat;
      const scenePlaneMat = planeMat;
      const sceneUnsubResize = unsubResize;
      return {
        scene: {
          cube: sceneCube,
          plane: scenePlane,
          perspectiveCam,
          orthographicCam,
          normalMat: sceneNormalMat,
          planeMat: scenePlaneMat,
          eyeBuf,
          targetBuf,
        },
        dispose: () => {
          sceneUnsubResize();
          mesh.destroy(sceneCube);
          mesh.destroy(scenePlane);
          mesh.destroyGeometry(sceneCubeGeo);
          mesh.destroyGeometry(scenePlaneGeo);
          material.destroy(sceneNormalMat);
          material.destroy(scenePlaneMat);
          input.detach();
        },
      };
    } catch (e) {
      if (unsubResize) unsubResize();
      if (cube) mesh.destroy(cube);
      if (plane) mesh.destroy(plane);
      if (cubeGeo) mesh.destroyGeometry(cubeGeo);
      if (planeGeo) mesh.destroyGeometry(planeGeo);
      if (normalMat) material.destroy(normalMat);
      if (planeMat) material.destroy(planeMat);
      input.detach();
      throw e;
    }
  },
  frame: ({ ctx, scene }) => {
    writeOrbitEye(scene.eyeBuf);
    const activeCam: Camera =
      state.cameraKind === "perspective"
        ? scene.perspectiveCam
        : scene.orthographicCam;

    camera.setPosition(activeCam, scene.eyeBuf);
    camera.setTarget(activeCam, scene.targetBuf);

    if (state.cameraKind === "perspective") {
      camera.setFov(scene.perspectiveCam, state.fovDeg * DEG_TO_RAD);
    } else {
      const aspect = ctx.canvas.width / ctx.canvas.height;
      camera.setBounds(scene.orthographicCam, {
        left: -state.zoom * aspect,
        right: state.zoom * aspect,
        bottom: -state.zoom,
        top: state.zoom,
      });
    }
    camera.setNearFar(activeCam, state.near, state.far);

    frame.render(ctx, {
      draw: [scene.plane, scene.cube],
      camera: activeCam,
      clearColor: CLEAR_COLOR,
    });
  },
});
