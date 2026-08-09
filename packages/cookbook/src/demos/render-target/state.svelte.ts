export type PipAngle = "overhead" | "side" | "front";
export type PipResolution = "256" | "512" | "1024";

export const state: {
  angle: number;
  autoRotate: boolean;
  pipAngle: PipAngle;
  pipResolution: PipResolution;
  pipDepth: boolean;
  pipLit: boolean;
  yaw: number;
} = $state({
  angle: 0,
  autoRotate: true,
  pipAngle: "front",
  pipResolution: "512",
  pipDepth: true,
  pipLit: true,
  yaw: 0,
});
