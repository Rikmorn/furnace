// Bowling DX controls. Mirrors the charge-meter $state pattern. `timeScale`
// drives slow-mo (1 = real time, <1 = slower); `paused` freezes the sim while
// render continues; `stepRequested` is a one-shot single-tick step (consumed by
// the scene on the next frame while paused). `showColliders` toggles the
// collider wireframe overlay.
export const debugControls = $state<{
  showColliders: boolean;
  timeScale: number;
  paused: boolean;
  stepRequested: boolean;
}>({
  showColliders: false,
  timeScale: 1,
  paused: false,
  stepRequested: false,
});
