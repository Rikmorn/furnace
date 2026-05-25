import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "animation",
  blurb:
    "three cubes, one frame.loop. Left: variable dt. Middle: fixed-step, no interpolation. Right: fixed-step with alpha lerp. Drag fixed Hz low to see the difference.",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: rate", action: "rotation rate (rad/s)" },
    {
      input: "slider: fixed Hz",
      action: "tick rate for both fixed-step cubes (5–120 Hz)",
    },
  ],
  features: [
    "frame.loop (variable dt) — left cube advances by info.deltaMs each RAF",
    "fixed-step accumulator — middle/right cubes tick at the selected Hz; matches the pattern frame.fixedLoop packages up",
    "alpha interpolation — right cube lerps between previous and current tick by alpha = accumulator / fixedDt",
    "camera.projectToScreen — floating labels positioned via the new core helper",
    "transform.quat / mesh.setRotation",
  ],
  gaps: [],
  order: 20,
} satisfies DemoHelp;
