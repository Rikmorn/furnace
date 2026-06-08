import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "shadows",
  blurb:
    "Shadow mapping — directional + spot casters, depth pass + 3×3 PCF, on a flat receiver",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    {
      input: "toggle: directional / spot",
      action: "switch the casting light type",
    },
    { input: "slider: normalBias", action: "normal-offset bias (fights acne)" },
  ],
  features: [
    "Light.shadow config — per-light opt-in; Light stays per-frame data",
    "engine texture_depth_2d_array indexed by slot (MAX_SHADOW_CASTERS=4)",
    "depth-only pass from the light POV + hardware comparison sampler",
    "3×3 PCF soft edges; slope-scaled + normal-offset bias",
    "shader.lit / shader.texturedLit receive shadows transparently",
  ],
  notes: [
    "The flat ground is an excellent shadow receiver; the casters drop crisp shadows.",
    "Directional = orthographic frustum (consumer-specified extent); spot = perspective from the cone.",
    "Point lights do not cast in Stage 4 (cube-map shadows are deferred).",
  ],
  order: 45,
} satisfies DemoHelp;
