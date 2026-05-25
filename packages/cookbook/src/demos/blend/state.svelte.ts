export type Cull = "back" | "front" | "none";
export type DepthCompare = "less" | "less-equal" | "always" | "never";
export type Backdrop = "strips" | "solid-black" | "solid-white";
export type Primitive = "quad" | "cube";

export const state: {
  cull: Cull;
  depthWrite: boolean;
  depthCompare: DepthCompare;
  backdrop: Backdrop;
  primitive: Primitive;
  showReference: boolean;
  spread: number;
  autoRotate: boolean;
  yaw: number;
} = $state({
  cull: "back",
  depthWrite: false,
  depthCompare: "less",
  backdrop: "strips",
  primitive: "quad",
  showReference: true,
  spread: 0.5,
  autoRotate: true,
  yaw: 0,
});
