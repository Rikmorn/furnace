import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "hello-cube",
  blurb: "smallest possible scene — ctx, camera, one cube on a plane",
  controls: [
    { key: "s", action: "toggle stats overlay" },
    { key: "h", action: "toggle this help" },
    { key: "c", action: "toggle controls panel" },
    { input: "drag", action: "orbit the camera around origin" },
    { input: "select: camera", action: "perspective ↔ orthographic" },
    { input: "select: material", action: "unlit ↔ normalColor" },
  ],
  features: ["gpu", "frame", "camera", "material", "mesh"],
  gaps: [],
  order: 10,
} satisfies DemoHelp;
