export const state: {
  interpolate: boolean;
  fixedHz: number;
  resetNonce: number;
  showColliders: boolean;
} = $state({
  interpolate: true,
  fixedHz: 12,
  resetNonce: 0,
  showColliders: false,
});
