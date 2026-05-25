export type CameraKind = "perspective" | "orthographic";
export type MaterialKind = "unlit" | "normalColor";

export const controlsState: {
  cameraKind: CameraKind;
  materialKind: MaterialKind;
} = $state({
  cameraKind: "perspective",
  materialKind: "unlit",
});

export const orbit: { yawDeg: number; pitchDeg: number } = $state({
  yawDeg: 30,
  pitchDeg: 25,
});
