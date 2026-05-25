import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "post",
  blurb: "bloom via the effects pipeline, live knobs + bypass toggle",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: threshold", action: "luminance threshold" },
    { input: "slider: intensity", action: "glow intensity" },
    { input: "slider: radius", action: "blur radius (UV units)" },
    { input: "toggle: bypass", action: "skip bloom entirely" },
  ],
  features: ["post.create", "post.destroy", "frame.render({ effects })"],
  gaps: [
    "Single-pass — multi-pass downsample bloom in docs/backlog/engine-architecture/post-multi-pass-effects.md",
    "bgra8unorm intermediates clamp values to [0,1] — HDR in docs/backlog/engine-architecture/post-hdr-intermediate.md",
  ],
  order: 80,
} satisfies DemoHelp;
