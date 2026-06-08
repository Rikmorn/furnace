export const state: {
  lightType: "directional" | "spot";
  normalBias: number;
} = $state({
  lightType: "directional",
  normalBias: 2.0,
});
