export type CameraKind = "perspective" | "orthographic";
export type FitPolicyKind = "stretch" | "preserve-height" | "preserve-width";
export type AnchorPreset =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const state: {
  cameraKind: CameraKind;
  fovDeg: number;
  zoom: number;
  near: number;
  far: number;
  yawDeg: number;
  pitchDeg: number;
  fitPolicyKind: FitPolicyKind;
  anchorPreset: AnchorPreset;
} = $state({
  cameraKind: "perspective",
  fovDeg: 45,
  zoom: 3,
  near: 0.1,
  far: 10,
  yawDeg: 30,
  pitchDeg: 25,
  fitPolicyKind: "preserve-height",
  anchorPreset: "center",
});
