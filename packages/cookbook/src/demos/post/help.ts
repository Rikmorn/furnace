import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "post",
  blurb: "compose effects — bloom + vignette via a chain you control per frame",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    {
      input: "slider: threshold",
      action:
        "bloom — physics knob: luminance level a pixel must cross to glow",
    },
    {
      input: "slider: radius",
      action: "bloom — physics knob: blur kernel spacing (UV units)",
    },
    {
      input: "slider: intensity",
      action: "bloom — tuning knob: how hot the halo gets",
    },
    {
      input: "slider: haloMaskStart",
      action:
        "bloom — tuning knob: pixels above this absolute luminance get the halo masked off",
    },
    {
      input: "slider: vignetteStrength",
      action: "vignette — corner darkening, 0 = off, 1 = corners go to black",
    },
    {
      input: "slider: vignetteFalloff",
      action:
        "vignette — where the darkened ring starts (0 = at centre, 1 = corners only)",
    },
    { input: "toggle: bloom", action: "include bloom in the effects chain" },
    {
      input: "toggle: vignette",
      action: "include vignette in the effects chain",
    },
    {
      input: "toggle: swapOrder",
      action:
        "vignette before bloom (changes how the halo interacts with the dim corners)",
    },
  ],
  features: [
    "post.create({ shader, binding })",
    "post.destroy",
    "shader.create({ layout }) + binding.create for @group(1) params",
    "frame.render({ effects: [...] }) chain",
    "chain ordering matters",
  ],
  notes: [
    "Bloom is half physics, half tuning. Threshold and radius are physics-ish (luminance + kernel geometry). Intensity and haloMaskStart are art direction — there's no derivation, you tune until it looks right.",
    "Order matters when effects share screen space. Vignette-before-bloom dims the corners before bloom's bright-pass threshold sees them, so the halo never extracts much there. Vignette-after-bloom lets the halo fully form, then paints darkness over it.",
  ],
  gaps: [
    "Single-pass — multi-pass downsample bloom in docs/backlog/engine-architecture/post-multi-pass-effects.md",
    "bgra8unorm intermediates clamp to [0,1] — see docs/backlog/engine-architecture/post-hdr-intermediate.md. You can watch this gap on screen: the +Y face of the normalColor cube blooms identically to a hypothetical bright-emissive surface, because single-pass bloom can only see luminance — it can't tell 'bright because lit' from 'bright because emissive'.",
  ],
  order: 80,
} satisfies DemoHelp;
