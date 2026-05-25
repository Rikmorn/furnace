import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "input",
  blurb: "kbd / pointer / wheel drive a small interactive scene",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { key: "WASD or arrows", action: "move the cube" },
    { input: "click", action: "cycle cube color" },
    { input: "wheel", action: "zoom camera (dolly)" },
    { input: "mouse move", action: "live pointer readout" },
  ],
  features: [
    "input.attach",
    "input.isKeyDown",
    "input.onKeyDown",
    "input.onKeyUp",
    "input.onPointerDown",
    "input.onPointerMove",
    "input.onPointerUp",
    "input.onWheel",
  ],
  gaps: [
    "Pointer-lock / capture not demonstrated — out of scope for v1",
    "Touch / multi-pointer not demonstrated — desktop-only scope",
  ],
  order: 30,
} satisfies DemoHelp;
