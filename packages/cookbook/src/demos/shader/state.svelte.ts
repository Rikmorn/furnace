export const state: {
  stripes: number;
  hue: number;
  softness: number;
  plasmaScale: number;
  plasmaPhase: number;
  angle: number;
  time: number;
} = $state({
  stripes: 8, // count along U axis — small enough that aliasing is invisible at softness=0
  hue: 0.55, // teal — distinct from plasma's default first-frame palette
  softness: 0.02, // visibly smoother than step(), still clearly striped
  plasmaScale: 8.0, // ~four full pattern blobs across the backdrop width
  plasmaPhase: 0.0, // no hue offset — pattern starts in plasma's natural palette
  angle: 0,
  time: 0,
});
