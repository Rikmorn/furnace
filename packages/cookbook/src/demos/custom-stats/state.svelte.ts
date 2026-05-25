export const FPS_HISTORY_LEN = 60;

export const state: {
  cubeCount: number;
  spawnTotal: number;
  despawnTotal: number;
  heavyLoop: boolean;
  heavyMs: number;
  fpsHistory: number[];
} = $state({
  cubeCount: 0,
  spawnTotal: 0,
  despawnTotal: 0,
  heavyLoop: false,
  heavyMs: 0,
  fpsHistory: [],
});
