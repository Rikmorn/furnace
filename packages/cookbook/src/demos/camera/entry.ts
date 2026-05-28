import type { Anchor, Camera } from "@furnace/core/camera";
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
import type {
  AnchorPreset,
  CameraKind,
  FitPolicyKind,
} from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

const PLANE_BACKDROP_SIZE = 6;
const PLANE_Z = -2;
const CAMERA_RADIUS = 4;
const ORBIT_SPEED_DEG_PER_PX = 0.4;
const PITCH_LIMIT_DEG = 89;
const NEAR_FAR_MIN_GAP = 0.05;
const DEG_TO_RAD = Math.PI / 180;
const REFERENCE_EXTENT = 2;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

const ANCHOR_PRESETS: Record<AnchorPreset, Anchor> = {
  center: { x: 0.5, y: 0.5 },
  "top-left": { x: 0, y: 1 },
  "top-right": { x: 1, y: 1 },
  "bottom-left": { x: 0, y: 0 },
  "bottom-right": { x: 1, y: 0 },
};

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
    get fitPolicyKind() {
      return state.fitPolicyKind;
    },
    get anchorPreset() {
      return state.anchorPreset;
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
    onFitPolicyKindChange: (v: FitPolicyKind) => {
      state.fitPolicyKind = v;
    },
    onAnchorPresetChange: (v: AnchorPreset) => {
      state.anchorPreset = v;
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
      mesh.setPosition(ctx, plane, vec3.fromValues(0, 0, PLANE_Z));

      const initialAspect = ctx.canvas.width / ctx.canvas.height;
      const perspectiveCam = camera.perspective({
        aspect: initialAspect,
        position: vec3.fromValues(0, 0, CAMERA_RADIUS),
      });
      const orthographicCam = camera.orthographic({
        fitPolicy: camera.policy.preserveHeight(
          REFERENCE_EXTENT,
          ANCHOR_PRESETS[state.anchorPreset],
        ),
        scale: state.zoom,
        near: state.near,
        far: state.far,
        position: vec3.fromValues(0, 0, CAMERA_RADIUS),
      });

      const unsubResizeP = camera.bindToCanvas(perspectiveCam, ctx);
      const unsubResizeO = camera.bindToCanvas(orthographicCam, ctx);
      unsubResize = () => {
        unsubResizeP();
        unsubResizeO();
      };

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
      const fitPolicyDirty: {
        lastKind: FitPolicyKind | undefined;
        lastAnchor: AnchorPreset | undefined;
      } = { lastKind: undefined, lastAnchor: undefined };

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
          fitPolicyDirty,
        },
        dispose: () => {
          sceneUnsubResize();
          mesh.destroy(ctx, sceneCube);
          mesh.destroy(ctx, scenePlane);
          mesh.destroyGeometry(ctx, sceneCubeGeo);
          mesh.destroyGeometry(ctx, scenePlaneGeo);
          material.destroy(ctx, sceneNormalMat);
          material.destroy(ctx, scenePlaneMat);
          input.detach();
        },
      };
    } catch (e) {
      if (unsubResize) unsubResize();
      if (cube) mesh.destroy(ctx, cube);
      if (plane) mesh.destroy(ctx, plane);
      if (cubeGeo) mesh.destroyGeometry(ctx, cubeGeo);
      if (planeGeo) mesh.destroyGeometry(ctx, planeGeo);
      if (normalMat) material.destroy(ctx, normalMat);
      if (planeMat) material.destroy(ctx, planeMat);
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
      camera.setScale(scene.orthographicCam, state.zoom);
      const policyChanged =
        state.fitPolicyKind !== scene.fitPolicyDirty.lastKind ||
        state.anchorPreset !== scene.fitPolicyDirty.lastAnchor;
      if (policyChanged) {
        const anchor = ANCHOR_PRESETS[state.anchorPreset];
        if (state.fitPolicyKind === "preserve-height") {
          camera.setFitPolicy(
            scene.orthographicCam,
            camera.policy.preserveHeight(REFERENCE_EXTENT, anchor),
          );
        } else if (state.fitPolicyKind === "preserve-width") {
          camera.setFitPolicy(
            scene.orthographicCam,
            camera.policy.preserveWidth(REFERENCE_EXTENT, anchor),
          );
        } else {
          // stretch: freeze the currently-visible extent into a literal-bounds
          // policy. getBounds returns post-scale bounds; divide by scale so the
          // next _deriveBounds call (which multiplies stretch bounds by scale)
          // restores the same visible extent rather than zooming again.
          const visible = camera.getBounds(scene.orthographicCam);
          const s = state.zoom;
          camera.setFitPolicy(
            scene.orthographicCam,
            camera.policy.stretch({
              left: visible.left / s,
              right: visible.right / s,
              bottom: visible.bottom / s,
              top: visible.top / s,
            }),
          );
        }
        scene.fitPolicyDirty.lastKind = state.fitPolicyKind;
        scene.fitPolicyDirty.lastAnchor = state.anchorPreset;
      }
    }
    camera.setNearFar(activeCam, state.near, state.far);

    frame.render(ctx, {
      draw: [scene.plane, scene.cube],
      camera: activeCam,
      clearColor: CLEAR_COLOR,
    });
  },
});
