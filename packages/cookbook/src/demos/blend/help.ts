import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "blend",
  blurb:
    "straight + premultiplied + additive blend modes on selectable quad / cube primitives",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { key: "Space", action: "toggle auto-rotation" },
    { input: "drag", action: "yaw the surfaces (pauses auto-rotation)" },
    { input: "select: cull", action: "back / front / none (all materials)" },
    {
      input: "toggle: depthWrite",
      action:
        "translucent surfaces write depth? on = exposes the translucent ordering limitation",
    },
    {
      input: "select: depthCompare",
      action: "less / less-equal / always / never (all materials)",
    },
    { input: "select: backdrop", action: "strips / solid-black / solid-white" },
    {
      input: "select: primitive",
      action: "quad / cube — shape of the translucent test surfaces",
    },
    {
      input: "toggle: showReference",
      action: "show/hide the opaque reference plane behind the translucents",
    },
    { input: "slider: spread", action: "0 = stacked, 1 = side-by-side" },
  ],
  features: [
    "material.unlit (with UnlitOptions)",
    "UnlitOptions",
    "material.blend.straightAlpha",
    "material.blend.premultiplied",
    "material.blend.additive",
    "MaterialDescriptor.cullMode (via UnlitOptions)",
    "MaterialDescriptor.depthWrite (via UnlitOptions)",
    "MaterialDescriptor.depthCompare (via UnlitOptions)",
    "input.attach / detach",
    "input.onPointerDown / Move / Up",
    "input.onKeyDown",
    "camera.projectToScreen",
  ],
  notes: [
    "straight α (red): src*α + dst*(1-α). Translucent overlay — alpha scales the source contribution; backdrop shows through proportionally. The 'naive' alpha-blend most beginners reach for.",
    "premultiplied (green): src + dst*(1-α). Same family as straight, but the source RGB is pre-multiplied by alpha at write-time. Composes correctly under chained translucent layers — what production engines (Three.js, Unity, browser compositors) standardize on.",
    "additive (blue): src + dst. Pure addition; never reduces the backdrop. Saturates toward white where it lands on bright dst colors. Standard mode for fire, lasers, lens flares, UI highlights — anything that should look emissive/glowy.",
    "depthWrite for translucents: when on, each translucent surface writes depth — blocking subsequent farther translucents in their overlap regions. This is a fundamental limitation of standard alpha-blending + depth-testing, not a core bug. The demo deliberately submits front-to-back to expose it; the real-engine fix is back-to-front sorting + depthWrite=off, or order-independent transparency techniques (depth peeling, weighted blended OIT).",
  ],
  order: 60,
} satisfies DemoHelp;
