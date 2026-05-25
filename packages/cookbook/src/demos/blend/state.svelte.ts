export type Cull = "back" | "front" | "none";
export type DepthCompare = "less" | "less-equal" | "always" | "never";
export type Backdrop = "strips" | "solid-black" | "solid-white";

export const state: {
  cull: Cull;
  depthWrite: boolean;
  depthCompare: DepthCompare;
  backdrop: Backdrop;
  spread: number;
  autoRotate: boolean;
  yaw: number;
} = $state({
  cull: "back",
  depthWrite: false,
  depthCompare: "less",
  backdrop: "strips",
  spread: 0.5,
  autoRotate: true,
  yaw: 0,
});
