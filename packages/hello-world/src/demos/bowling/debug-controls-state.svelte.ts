// Bowling DX controls. Mirrors the charge-meter $state pattern. `timeScale`
// drives slow-mo (1 = real time, <1 = slower); `paused` freezes the sim while
// render continues; `stepRequested` is a one-shot single-tick step (consumed by
// the scene on the next frame while paused). `showColliders` toggles the
// collider wireframe overlay. `anisotropy` toggles anisotropic filtering on the
// lane texture (AF on = maxAnisotropy 16, off = maxAnisotropy 1) — the lane
// uses two pre-built materials and swaps between them each frame.
//
// `msaa` is special: `sampleCount` is frozen at requestContext, so it cannot be
// read per-frame. The UI flips this flag AND calls `onMsaaChange` (wired by the
// scene to a ctx rebuild) — see DebugControls.svelte.
export const debugControls = $state<{
  showColliders: boolean;
  timeScale: number;
  paused: boolean;
  stepRequested: boolean;
  anisotropy: boolean;
  msaa: boolean;
}>({
  showColliders: false,
  timeScale: 1,
  paused: false,
  stepRequested: false,
  anisotropy: true,
  msaa: true,
});

// Scene-provided rebuild hook. The MSAA toggle can't be read per-frame
// (sampleCount is frozen at requestContext), so flipping it must rebuild the
// ctx. The scene installs this on mount and clears it on unmount; the UI calls
// it after updating `debugControls.msaa`. Null when no scene is mounted.
let onMsaaChange: ((msaaOn: boolean) => void) | null = null;

/** Install the scene's MSAA-change handler (called by the scene on mount). */
export function setOnMsaaChange(
  handler: ((msaaOn: boolean) => void) | null,
): void {
  onMsaaChange = handler;
}

/** Invoke the installed MSAA-change handler, if any (called by the UI). */
export function notifyMsaaChange(msaaOn: boolean): void {
  onMsaaChange?.(msaaOn);
}
