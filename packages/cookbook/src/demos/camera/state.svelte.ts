export type CameraKind = "perspective" | "orthographic";

export const state: {
  cameraKind: CameraKind;
  fovDeg: number;
  zoom: number;
  near: number;
  far: number;
  yawDeg: number;
  pitchDeg: number;
} = $state({
  cameraKind: "perspective",
  fovDeg: 45,
  zoom: 3,
  near: 0.1,
  far: 10,
  yawDeg: 30,
  pitchDeg: 25,
});
