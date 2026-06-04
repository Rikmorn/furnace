import { state } from "./state.ts";

/**
 * Clear per-frame edge flags. Called by `frame.loop` after each frame's
 * callback (the `frame → input` per-frame heartbeat coupling). ctx-less
 * because the input module is a global singleton, not ctx-scoped.
 */
export function _inputEndFrame(): void {
  state.keysPressed.clear();
  state.keysReleased.clear();
  state.buttonsPressed = 0;
  state.buttonsReleased = 0;
}
