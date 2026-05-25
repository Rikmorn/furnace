import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "animation",
  blurb: "frame.loop's dt drives rotation + scale, toggle to a fixed-step loop",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: rate", action: "rotation rate" },
    { input: "slider: scale", action: "uniform scale" },
    { input: "select: loop", action: "variable dt ↔ fixed step (60Hz)" },
  ],
  features: [
    "frame.loop",
    "frame.fixedLoop",
    "transform.quat",
    "mesh.setRotation",
    "mesh.setScale",
  ],
  gaps: [
    "fixedLoop accumulator drift not visualized — would need a perf-heavy scene to surface",
  ],
  order: 20,
} satisfies DemoHelp;
