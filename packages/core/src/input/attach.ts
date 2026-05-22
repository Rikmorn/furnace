import { FurnaceInputError } from "./errors.ts";
import {
  handleBlur,
  handleKeyDownDomEvent,
  handleKeyUpDomEvent,
} from "./keyboard.ts";
import {
  handlePointerDownDomEvent,
  handlePointerEnterDomEvent,
  handlePointerLeaveDomEvent,
  handlePointerMoveDomEvent,
  handlePointerUpDomEvent,
  handleWheelDomEvent,
} from "./pointer.ts";
import { resetRuntimeState, state } from "./state.ts";

type ListenerSpec = {
  target: EventTarget;
  type: string;
  fn: (e: Event) => void;
};

function registerListener(spec: ListenerSpec): void {
  spec.target.addEventListener(spec.type, spec.fn);
  state.listeners.push(spec);
}

export function attach(canvas: HTMLCanvasElement): void {
  if (state.canvas !== null) {
    throw new FurnaceInputError("input already attached; call detach() first");
  }
  state.canvas = canvas;

  // Keyboard + window lifecycle bind to globalThis so they fire regardless of
  // which element has focus. Pointer + wheel bind to the canvas for canvas-
  // local coords and to prevent firing when the cursor leaves the surface.
  registerListener({
    target: globalThis,
    type: "keydown",
    fn: (e) => handleKeyDownDomEvent(e as KeyboardEvent),
  });
  registerListener({
    target: globalThis,
    type: "keyup",
    fn: (e) => handleKeyUpDomEvent(e as KeyboardEvent),
  });
  registerListener({
    target: globalThis,
    type: "blur",
    fn: () => handleBlur(),
  });

  registerListener({
    target: canvas,
    type: "pointerdown",
    fn: (e) => handlePointerDownDomEvent(e as PointerEvent),
  });
  registerListener({
    target: canvas,
    type: "pointermove",
    fn: (e) => handlePointerMoveDomEvent(e as PointerEvent),
  });
  registerListener({
    target: canvas,
    type: "pointerup",
    fn: (e) => handlePointerUpDomEvent(e as PointerEvent),
  });
  registerListener({
    target: canvas,
    type: "pointerenter",
    fn: (e) => handlePointerEnterDomEvent(e as PointerEvent),
  });
  registerListener({
    target: canvas,
    type: "pointerleave",
    fn: (e) => handlePointerLeaveDomEvent(e as PointerEvent),
  });
  registerListener({
    target: canvas,
    type: "wheel",
    fn: (e) => handleWheelDomEvent(e as WheelEvent),
  });
}

export function detach(): void {
  if (state.canvas === null) return; // no-op
  for (const spec of state.listeners) {
    spec.target.removeEventListener(spec.type, spec.fn);
  }
  resetRuntimeState();
  // resetRuntimeState clears state.listeners and canvas; emitters intentionally
  // preserved so subscribers survive across detach/attach cycles.
}

export function isAttached(): boolean {
  return state.canvas !== null;
}
