import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "render-target",
  blurb: "frame.renderToTexture as a picture-in-picture from a second camera",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: pip-size", action: "picture-in-picture size" },
  ],
  features: [
    "frame.renderToTexture",
    "RenderToTextureOptions",
    "texture sampling",
  ],
  gaps: [
    "PiP camera angle is fixed; rotation around the scene would need a quat slider",
    "PiP quad is world-space, not screen-space — proper HUD overlay would need a second orthographic pass",
  ],
  order: 70,
} satisfies DemoHelp;
