import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "blend",
  blurb: "opaque vs PREMULTIPLIED_ALPHA vs ADDITIVE side-by-side",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "select: cull", action: "back / front / none (applies to all)" },
    { input: "toggle: depthWrite", action: "translucent quads write depth?" },
  ],
  features: [
    "material.create (blend)",
    "PREMULTIPLIED_ALPHA_BLEND",
    "ADDITIVE_BLEND",
    "MaterialDescriptor.cullMode",
    "MaterialDescriptor.depthWrite",
    "MaterialDescriptor.depthCompare",
  ],
  gaps: [
    "depthCompare not interactively demoed — set on the blend materials but no toggle",
    "Toggling cull/depthWrite requires page reload — runtime rebuild deferred to keep entry.ts focused",
  ],
  order: 60,
} satisfies DemoHelp;
