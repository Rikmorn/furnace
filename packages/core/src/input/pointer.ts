import { state } from "./state.ts";
import type {
  PointerEvent as InputPointerEvent,
  WheelEvent as InputWheelEvent,
  PointerButton,
  PointerSnapshot,
  PointerType,
} from "./types.ts";

function deviceRatio(): number {
  // Pull DPR straight off the bound canvas. Honors any `pixelRatio` override
  // the consumer passed to `gpu.requestContext` (the canvas's width matches
  // whatever the engine sized it to).
  const c = state.canvas;
  if (!c) return 1;
  if (c.clientWidth === 0) return 1;
  return c.width / c.clientWidth;
}

export function normalizePointer(
  e: PointerEvent,
  type:
    | "pointerdown"
    | "pointermove"
    | "pointerup"
    | "pointerenter"
    | "pointerleave",
): InputPointerEvent {
  const ratio = deviceRatio();
  const x = e.offsetX;
  const y = e.offsetY;
  const buttonOnTransition =
    type === "pointerdown" || type === "pointerup"
      ? // Boundary cast: DOM PointerEvent.button is number; PointerButton is the engine's narrower 0–4 union.
        (e.button as PointerButton)
      : null;
  return Object.freeze({
    x,
    y,
    xDevice: x * ratio,
    yDevice: y * ratio,
    button: buttonOnTransition,
    buttons: e.buttons,
    // Boundary cast: DOM PointerEvent.pointerType is string; PointerType is the engine's "mouse" | "pen" | "touch" union.
    pointerType: e.pointerType as PointerType,
    pointerId: e.pointerId,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    meta: e.metaKey,
    timestampMs: e.timeStamp,
  });
}

export function normalizeWheel(e: WheelEvent): InputWheelEvent {
  const ratio = deviceRatio();
  const x = e.offsetX;
  const y = e.offsetY;
  return Object.freeze({
    x,
    y,
    xDevice: x * ratio,
    yDevice: y * ratio,
    deltaX: e.deltaX,
    deltaY: e.deltaY,
    deltaZ: e.deltaZ,
    timestampMs: e.timeStamp,
  });
}

function syncPointerStateFromEvent(e: PointerEvent): void {
  const ratio = deviceRatio();
  state.pointer.x = e.offsetX;
  state.pointer.y = e.offsetY;
  state.pointer.xDevice = e.offsetX * ratio;
  state.pointer.yDevice = e.offsetY * ratio;
  state.pointer.buttons = e.buttons;
}

export function handlePointerDownDomEvent(e: PointerEvent): void {
  syncPointerStateFromEvent(e);
  state.emitters.pointerDown.emit(normalizePointer(e, "pointerdown"));
}

export function handlePointerMoveDomEvent(e: PointerEvent): void {
  syncPointerStateFromEvent(e);
  state.emitters.pointerMove.emit(normalizePointer(e, "pointermove"));
}

export function handlePointerUpDomEvent(e: PointerEvent): void {
  syncPointerStateFromEvent(e);
  state.emitters.pointerUp.emit(normalizePointer(e, "pointerup"));
}

export function handlePointerEnterDomEvent(e: PointerEvent): void {
  state.pointer.overCanvas = true;
  syncPointerStateFromEvent(e);
}

export function handlePointerLeaveDomEvent(e: PointerEvent): void {
  state.pointer.overCanvas = false;
  syncPointerStateFromEvent(e);
}

export function handleWheelDomEvent(e: WheelEvent): void {
  state.emitters.wheel.emit(normalizeWheel(e));
}

export function onPointerDown(cb: (e: InputPointerEvent) => void): () => void {
  return state.emitters.pointerDown.on(cb);
}

export function onPointerMove(cb: (e: InputPointerEvent) => void): () => void {
  return state.emitters.pointerMove.on(cb);
}

export function onPointerUp(cb: (e: InputPointerEvent) => void): () => void {
  return state.emitters.pointerUp.on(cb);
}

export function onWheel(cb: (e: InputWheelEvent) => void): () => void {
  return state.emitters.wheel.on(cb);
}

export function isPointerButtonDown(button: PointerButton): boolean {
  return (state.pointer.buttons & (1 << button)) !== 0;
}

export function getPointer(): PointerSnapshot {
  return Object.freeze({
    x: state.pointer.x,
    y: state.pointer.y,
    xDevice: state.pointer.xDevice,
    yDevice: state.pointer.yDevice,
    buttons: state.pointer.buttons,
    overCanvas: state.pointer.overCanvas,
  });
}
