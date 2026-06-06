import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "post",
  blurb:
    "HDR post chain — real multi-pass bloom + tonemap + a consumer multi-pass effect, composed per frame",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    {
      input: "select: operator",
      action:
        "tonemap operator — neutral (Khronos PBR Neutral) or reinhard. Changing it RECREATES the tonemap effect (create-time param).",
    },
    {
      input: "slider: exposure",
      action:
        "tonemap exposure — linear pre-tonemap multiplier. Recreates the tonemap effect on release.",
    },
    {
      input: "slider: bloom int.",
      action:
        "bloom intensity — how hot the glow gets. Recreates the bloom effect on release.",
    },
    {
      input: "slider: vig. strength",
      action: "vignette — corner darkening, 0 = off, 1 = corners go to black",
    },
    {
      input: "slider: vig. falloff",
      action:
        "vignette — where the darkened ring starts (0 = at centre, 1 = corners only)",
    },
    {
      input: "toggle: bloom",
      action: "include the built-in dual-filter bloom in the chain",
    },
    {
      input: "toggle: blur (multi-pass)",
      action:
        "include the CONSUMER 2-pass separable blur (authored via post.createPasses)",
    },
    {
      input: "toggle: vignette",
      action: "include the consumer single-pass vignette in the chain",
    },
  ],
  features: [
    "ctx hdr: true → rgba16float working format (values survive >1.0)",
    "post.tonemap({ operator, exposure }) — always the final HDR→LDR effect",
    "post.bloom({ intensity }) — built-in COD/Jimenez dual-filter (multi-pass downsample pyramid)",
    "post.createPasses — CONSUMER multi-pass effect: a 2-pass separable blur (blurH → blurV)",
    "post.create({ shader, binding }) — consumer single-pass vignette",
    "frame.render({ effects: [...] }) chain — toggles compose the mid-chain effects, tonemap pinned last",
    "create-time params (operator/exposure/intensity) → recreate-on-change (leak-free destroy + create)",
  ],
  notes: [
    "Under HDR the chain must always reach the LDR swapchain via a non-empty effects array — so tonemap is ALWAYS the last effect, every frame, regardless of which mid-chain toggles are on. frame.render throws on an empty HDR chain.",
    "Real emissive source: the small bright accent cube uses an unlit material with colour (3,3,3,1). On the old LDR (bgra8unorm) path that would clamp to white; under HDR rgba16float it survives as a genuine >1.0 value, so the bloom prefilter pulls a halo from a TRUE emissive surface — not just a bright-because-lit face.",
    "Post-effect params are fixed at create time in this stage (no runtime setters). operator/exposure/intensity therefore RECREATE the relevant effect on change: the demo post.destroy's the old effect and creates a new one (single-in-flight + one-pending queue, so rapid slider releases coalesce and never accumulate effects).",
    "Order matters when effects share screen space. Bloom works in linear HDR and must precede tonemap; the consumer blur and vignette sit between them. The blur's H pass writes a named intermediate that its V pass reads — that hand-off is the whole point of the multi-pass primitive.",
    "Consumer-owned vs engine-owned: the consumer blur's two direction bindings + the vignette binding (and the two consumer shaders) are freed by the demo in teardown. The built-in bloom/tonemap own their internal @group(1) bindings — post.destroy frees those.",
  ],
  order: 80,
} satisfies DemoHelp;
