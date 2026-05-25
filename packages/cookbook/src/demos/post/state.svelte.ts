export const state: {
  threshold: number;
  intensity: number;
  radius: number;
  bypass: boolean;
  angle: number;
} = $state({
  threshold: 0.7,
  intensity: 4.0,
  radius: 0.012,
  bypass: false,
  angle: 0,
});
