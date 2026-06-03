export const state: {
  rate: number;
  fixedHz: number;
  angle: number;
  fixedCurrAngle: number;
  fixedPrevAngle: number;
} = $state({
  rate: 1.0,
  fixedHz: 10,
  angle: 0,
  fixedCurrAngle: 0,
  fixedPrevAngle: 0,
});
