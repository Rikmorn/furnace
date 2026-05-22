export type KeyCode = string;

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

export type PointerButton = 0 | 1 | 2 | 3 | 4;
export type PointerType = "mouse" | "pen" | "touch";

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

export type PointerSnapshot = Readonly<{
  x: number;
  y: number;
  xDevice: number;
  yDevice: number;
  buttons: number;
  overCanvas: boolean;
}>;
