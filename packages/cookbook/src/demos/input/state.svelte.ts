export const state: {
  keys: string[];
  pointer: { x: number; y: number; buttons: string[] };
  wheelDeltaY: number;
  cubePos: [number, number, number];
  cameraZ: number;
  colorIdx: number;
} = $state({
  keys: [],
  pointer: { x: 0, y: 0, buttons: [] },
  wheelDeltaY: 0,
  cubePos: [0, 0, 0],
  cameraZ: 3,
  colorIdx: 0,
});
