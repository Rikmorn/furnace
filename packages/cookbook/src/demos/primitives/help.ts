import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "primitives",
  blurb: "geometry.cube / plane / sphere / cylinder factory primitives",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "select: shape", action: "cube / plane / sphere / cylinder" },
  ],
  features: [
    "geometry.sphere",
    "geometry.cylinder",
    "geometry.cube",
    "geometry.plane",
  ],
  order: 41,
} satisfies DemoHelp;
