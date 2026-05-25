export type Cull = "back" | "front" | "none";

export const state: { cull: Cull; depthWrite: boolean } = $state({
  cull: "none",
  depthWrite: false,
});
