/**
 * Layout-independent key identifier — the DOM `KeyboardEvent.code` value
 * (e.g. `"KeyW"`, `"ArrowLeft"`, `"Space"`). WASD works on AZERTY.
 */
export type KeyCode = string;

/**
 * Engine-normalized keyboard event delivered to {@link onKeyDown} /
 * {@link onKeyUp} subscribers. `code` is the layout-independent identifier;
 * `key` is the produced character (layout-dependent). `timestampMs` is
 * `DOMHighResTimeStamp` from the underlying DOM event.
 */
export type KeyEvent = Readonly<{
  code: KeyCode;
  key: string;
  repeat: boolean;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  timestampMs: number;
}>;

/** Engine-narrowed DOM `MouseEvent.button` — 0 primary, 1 middle, 2 secondary, 3 back, 4 forward. */
export type PointerButton = 0 | 1 | 2 | 3 | 4;

/** Engine-narrowed DOM `PointerEvent.pointerType`. */
export type PointerType = "mouse" | "pen" | "touch";

/**
 * Engine-normalized pointer event delivered to {@link onPointerDown} /
 * {@link onPointerMove} / {@link onPointerUp} subscribers.
 *
 * `x` / `y` are CSS pixels (canvas-local, from `offsetX` / `offsetY`).
 * `xDevice` / `yDevice` are CSS pixels multiplied by the canvas's
 * backing-store DPR — use these for framebuffer-direct reads. See
 * `engine-conventions.md` §"Input" for the CSS-vs-device split.
 *
 * `button` is the button that transitioned on this event and is `null` on
 * `pointermove` (no transition occurred). `buttons` is the held-button
 * bitmask and is valid on every event.
 */
export type PointerEvent = Readonly<{
  x: number;
  y: number;
  xDevice: number;
  yDevice: number;
  button: PointerButton | null;
  buttons: number;
  pointerType: PointerType;
  pointerId: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  timestampMs: number;
}>;

/**
 * Engine-normalized wheel event delivered to {@link onWheel} subscribers.
 *
 * `x` / `y` are CSS pixels (canvas-local); `xDevice` / `yDevice` are scaled
 * by the canvas's backing-store DPR. `deltaX` / `deltaY` / `deltaZ` are
 * passed through unchanged from the underlying DOM `WheelEvent` (units
 * depend on `deltaMode`, which the engine does not normalize).
 */
export type WheelEvent = Readonly<{
  x: number;
  y: number;
  xDevice: number;
  yDevice: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  timestampMs: number;
}>;

/**
 * Frozen snapshot returned by {@link getPointer}. `x` / `y` are CSS pixels,
 * `xDevice` / `yDevice` are device pixels (CSS × backing-store DPR).
 * `overCanvas` reflects the latest `pointerenter` / `pointerleave`.
 */
export type PointerSnapshot = Readonly<{
  x: number;
  y: number;
  xDevice: number;
  yDevice: number;
  buttons: number;
  overCanvas: boolean;
}>;
