import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "shader",
  blurb: "material.create with a procedural striped shader, live tunable",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: stripes", action: "stripe count along U" },
    { input: "slider: hue", action: "base hue (0..1)" },
  ],
  features: [
    "material.create",
    "MaterialDescriptor",
    "WGSL",
    "@group/@binding",
  ],
  gaps: [
    "Uniforms are raw writeBuffer — typed uniform setters are in docs/backlog/engine-architecture/typed-uniform-setters.md",
  ],
  order: 50,
} satisfies DemoHelp;
