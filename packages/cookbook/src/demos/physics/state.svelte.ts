export const state: {
  interpolate: boolean;
  fixedHz: number;
  resetNonce: number;
} = $state({
  interpolate: true,
  fixedHz: 12,
  resetNonce: 0,
});
