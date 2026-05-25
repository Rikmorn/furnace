import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "blend",
  blurb:
    "straight + premultiplied + additive over a cube and switchable backdrops",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { key: "Space", action: "toggle auto-rotation" },
    { input: "drag", action: "yaw the quads (pauses auto-rotation)" },
    { input: "select: cull", action: "back / front / none (all materials)" },
    {
      input: "toggle: depthWrite",
      action: "translucent quads write depth? on = ordering bug visible",
    },
    {
      input: "select: depthCompare",
      action: "less / less-equal / always / never (all materials)",
    },
    { input: "select: backdrop", action: "strips / solid-black / solid-white" },
    { input: "slider: spread", action: "0 = stacked, 1 = side-by-side" },
  ],
  features: [
    "material.unlit (with UnlitOptions)",
    "UnlitOptions",
    "STRAIGHT_ALPHA_BLEND",
    "PREMULTIPLIED_ALPHA_BLEND",
    "ADDITIVE_BLEND",
    "MaterialDescriptor.cullMode (via UnlitOptions)",
    "MaterialDescriptor.depthWrite (via UnlitOptions)",
    "MaterialDescriptor.depthCompare (via UnlitOptions)",
    "input.attach / detach",
    "input.onPointerDown / Move / Up",
    "input.onKeyDown",
  ],
  order: 60,
} satisfies DemoHelp;
