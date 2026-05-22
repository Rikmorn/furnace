import { state } from "./state.ts";
import type { KeyCode, KeyEvent } from "./types.ts";

export function normalizeKey(e: KeyboardEvent): KeyEvent {
  return Object.freeze({
    code: e.code,
    key: e.key,
    repeat: e.repeat,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    meta: e.metaKey,
    timestampMs: e.timeStamp,
  });
}

export function handleKeyDownDomEvent(e: KeyboardEvent): void {
  state.keysDown.add(e.code);
  state.emitters.keyDown.emit(normalizeKey(e));
}

export function handleKeyUpDomEvent(e: KeyboardEvent): void {
  state.keysDown.delete(e.code);
  state.emitters.keyUp.emit(normalizeKey(e));
}

export function handleBlur(): void {
  // Stuck-key recovery: clear held state without synthesizing keyup events.
  // See docs/backlog/engine-architecture/input-stuck-key-recovery.md for the
  // future onBlur event that closes the symmetric-streams gap.
  state.keysDown.clear();
  state.pointer.buttons = 0;
}

export function onKeyDown(cb: (e: KeyEvent) => void): () => void {
  return state.emitters.keyDown.on(cb);
}

export function onKeyUp(cb: (e: KeyEvent) => void): () => void {
  return state.emitters.keyUp.on(cb);
}

export function isKeyDown(code: KeyCode): boolean {
  return state.keysDown.has(code);
}
