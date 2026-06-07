export const state: {
  directional: boolean;
  point: boolean;
  spot: boolean;
  shininess: number;
} = $state({
  directional: true,
  point: true,
  spot: false,
  shininess: 48,
});
