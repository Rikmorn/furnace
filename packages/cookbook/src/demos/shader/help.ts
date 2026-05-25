import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "shader",
  blurb:
    "ship custom shaders — two materials, one scene, one with time-driven uniforms",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "slider: stripes", action: "striped cube — stripe count along U" },
    { input: "slider: hue", action: "striped cube — base hue (0..1)" },
    {
      input: "slider: softness",
      action:
        "striped cube — band edge softness (0 = hard step, 0.2 = nearly gradient)",
    },
    {
      input: "slider: plasmaScale",
      action: "plasma backdrop — pattern zoom (smaller = bigger blobs)",
    },
    {
      input: "slider: plasmaPhase",
      action: "plasma backdrop — hue cycle offset",
    },
  ],
  features: [
    "material.create",
    "MaterialDescriptor (vertex/fragment/bindings)",
    "multiple custom materials in one scene",
    "time-driven uniform (plasma)",
  ],
  notes: [
    "Two custom materials, one scene. The engine doesn't care how many material.create calls you make — composition is just calling it again with different WGSL and bindings. Look at the symmetry between the striped and plasma setup paths in entry.ts.",
    "Time is just a uniform. The plasma shader has no built-in concept of animation; entry.ts accumulates a state.time field per frame and writes it into the plasma uniform buffer. Anything you want animated in a shader follows the same pattern.",
    "Anti-aliasing in procedural shaders: drag softness to 0 to see the hard step() output and the visible aliasing artifacts at high stripe counts. The smoothstep fix is one of the most common 'first thing that goes wrong' lessons in real-world shader code.",
  ],
  gaps: [
    "Uniforms are raw writeBuffer — typed uniform setters are in docs/backlog/engine-architecture/typed-uniform-setters.md. With two materials now, the per-frame writeBuffer boilerplate is starting to feel real.",
    "Both material.create calls pass the same WGSL string to vertex: and fragment: — see docs/backlog/engine-architecture/material-shader-source-shape.md. Every material in the codebase is single-source with two entry points; the two-field API doesn't pay for itself.",
    "hsv2rgb is copy-pasted between striped.wgsl and plasma.wgsl because WGSL has no #include — see docs/backlog/engine-architecture/shader-preprocessor.md.",
  ],
  order: 50,
} satisfies DemoHelp;
