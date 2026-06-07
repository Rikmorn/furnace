import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "lighting",
  blurb:
    "Multi-light Blinn-Phong — directional / point / spot lights over the Scene UBO, with visible specular",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    {
      input: "toggle: directional",
      action: "enable the warm key directional light",
    },
    {
      input: "toggle: point",
      action: "enable the orbiting point light (inverse-square falloff)",
    },
    {
      input: "toggle: spot",
      action: "enable the spot light (cone, inner/outer angle)",
    },
    {
      input: "slider: shininess",
      action: "per-material specular exponent on the lit sphere",
    },
  ],
  features: [
    "frame.render({ lights, ambient }) — per-frame light data (no handle / lifecycle)",
    "Light union: directional | point | spot (range, cone angles type-enforced)",
    "shader.lit — multi-light Blinn-Phong + per-material { color, specular }",
    "Scene UBO @group(0) @binding(1) — engine-managed, clamped to 16 lights",
    "specular highlights track the camera (half-vector); shininess via the binding",
  ],
  notes: [
    "Lights are plain data recomputed per frame — the point light orbits by writing a new position each frame, no setter or handle.",
    "The sphere uses shader.lit with a per-material specular; the ground plane shows attenuation falloff and the spot cone edge.",
    "Intensities are HDR-calibrated (no 1/π): a white surface under one key peaks ≈1.0; specular is additive and may exceed 1.0.",
  ],
  order: 35,
} satisfies DemoHelp;
