// Bowling DX controls. Mirrors the charge-meter $state pattern. `timeScale`
// drives slow-mo (1 = real time, <1 = slower); `paused` freezes the sim while
// render continues; `stepRequested` is a one-shot single-tick step (consumed by
// the scene on the next frame while paused). `showColliders` toggles the
// collider wireframe overlay. `anisotropy` toggles anisotropic filtering on the
// lane texture (AF on = maxAnisotropy 16, off = maxAnisotropy 1) — the lane
// uses two pre-built materials and swaps between them each frame.
export const debugControls = $state<{
  showColliders: boolean;
  timeScale: number;
  paused: boolean;
  stepRequested: boolean;
  anisotropy: boolean;
}>({
  showColliders: false,
  timeScale: 1,
  paused: false,
  stepRequested: false,
  anisotropy: true,
});
