import { createEmitter, type Emitter } from "../events/emitter.ts";
import type { KeyCode, KeyEvent, PointerEvent, WheelEvent } from "./types.ts";

export type Emitters = Readonly<{
  keyDown: Emitter<KeyEvent>;
  keyUp: Emitter<KeyEvent>;
  pointerDown: Emitter<PointerEvent>;
  pointerMove: Emitter<PointerEvent>;
  pointerUp: Emitter<PointerEvent>;
  wheel: Emitter<WheelEvent>;
}>;

export type State = {
  canvas: HTMLCanvasElement | null;
  keysDown: Set<KeyCode>;
  keysPressed: Set<KeyCode>;
  keysReleased: Set<KeyCode>;
  buttonsPressed: number;
  buttonsReleased: number;
  pointer: {
    x: number;
    y: number;
    xDevice: number;
    yDevice: number;
    buttons: number;
    overCanvas: boolean;
  };
  emitters: Emitters;
  listeners: Array<{
    target: EventTarget;
    type: string;
    fn: (e: Event) => void;
  }>;
};

function makeEmitters(): Emitters {
  return Object.freeze({
    keyDown: createEmitter<KeyEvent>(),
    keyUp: createEmitter<KeyEvent>(),
    pointerDown: createEmitter<PointerEvent>(),
    pointerMove: createEmitter<PointerEvent>(),
    pointerUp: createEmitter<PointerEvent>(),
    wheel: createEmitter<WheelEvent>(),
  });
}

function makeInitialState(): State {
  return {
    canvas: null,
    keysDown: new Set<KeyCode>(),
    keysPressed: new Set<KeyCode>(),
    keysReleased: new Set<KeyCode>(),
    buttonsPressed: 0,
    buttonsReleased: 0,
    pointer: {
      x: 0,
      y: 0,
      xDevice: 0,
      yDevice: 0,
      buttons: 0,
      overCanvas: false,
    },
    emitters: makeEmitters(),
    listeners: [],
  };
}

export const state: State = makeInitialState();

// detach() uses this to wipe runtime state while preserving subscribers.
// Tests use _resetForTests below to wipe subscribers too.
export function resetRuntimeState(): void {
  state.canvas = null;
  state.keysDown.clear();
  state.keysPressed.clear();
  state.keysReleased.clear();
  state.buttonsPressed = 0;
  state.buttonsReleased = 0;
  state.pointer.x = 0;
  state.pointer.y = 0;
  state.pointer.xDevice = 0;
  state.pointer.yDevice = 0;
  state.pointer.buttons = 0;
  state.pointer.overCanvas = false;
  state.listeners.length = 0;
}

// Test-only: fully reset the singleton, including emitter subscribers.
// Not exported from index.ts.
export function _resetForTests(): void {
  resetRuntimeState();
  state.emitters.keyDown.clear();
  state.emitters.keyUp.clear();
  state.emitters.pointerDown.clear();
  state.emitters.pointerMove.clear();
  state.emitters.pointerUp.clear();
  state.emitters.wheel.clear();
}
