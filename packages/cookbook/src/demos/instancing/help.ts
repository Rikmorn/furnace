import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "instancing",
  blurb: "one geometry, N tinted copies, a single instanced draw call",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: grid", action: "grid size — instance count is grid²" },
    { input: "toggle: spin", action: "per-instance rotation animation" },
  ],
  features: [
    "mesh.createInstanced",
    "shader.unlitInstanced",
    "RenderOptions.instanced",
  ],
  notes: [
    "GPU instancing draws many copies of one geometry+material in a single draw call. The engine routes per-instance data (a baked model matrix in vertex slot 1, an RGBA tint in slot 2) through instance vertex buffers, then issues one pass.draw(..., instanceCount).",
    "Watch the stats overlay: the whole grid — up to 256 cubes — renders as ONE draw call, regardless of grid size. The non-instanced path would be one mesh + one draw per cube.",
    "Each cube's distinct colour comes from setInstanceTint (a rainbow across x, a brightness ramp across z); its rotation + scale from setInstanceTransform. shader.unlitInstanced multiplies the per-instance tint straight into the material colour, so the gradient reads directly.",
    "setInstanceTransform takes a single uniform scalar scale (per-axis non-uniform scale is unsupported — the instanced lit shader derives normals from mat3(model) with no normal matrix). Buffers are allocated once at full capacity; the grid slider only changes the drawn prefix via setInstanceCount.",
  ],
  order: 45,
} satisfies DemoHelp;
