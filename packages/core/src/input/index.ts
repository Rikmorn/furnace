// packages/core/src/input/index.ts

export { attach, detach, isAttached } from "./attach.ts";
export { FurnaceInputError } from "./errors.ts";
export {
  isKeyDown,
  onKeyDown,
  onKeyUp,
  wasKeyPressed,
  wasKeyReleased,
} from "./keyboard.ts";
export {
  getPointer,
  isPointerButtonDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  wasPointerButtonPressed,
  wasPointerButtonReleased,
} from "./pointer.ts";
export type {
  KeyCode,
  KeyEvent,
  PointerButton,
  PointerEvent,
  PointerSnapshot,
  PointerType,
  WheelEvent,
} from "./types.ts";
