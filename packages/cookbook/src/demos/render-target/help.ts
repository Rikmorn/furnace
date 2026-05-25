import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "render-target",
  blurb:
    "frame.renderToTexture as a monitor screen: a sampleable GPUTexture rendered as a world-space surface",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { key: "Space", action: "toggle subject auto-rotate" },
    { input: "drag", action: "yaw the main camera around the scene" },
    {
      input: "select: pipAngle",
      action: "overhead / side / front — angle of the offscreen camera",
    },
    {
      input: "select: pipResolution",
      action:
        "256 / 512 / 1024 — recreating the offscreen texture forces a material rebuild",
    },
  ],
  features: [
    "frame.renderToTexture",
    "RenderToTextureOptions",
    "material.create",
    "MaterialDescriptor.bindings (texture + sampler)",
    "material.unlit (cullMode: 'front')",
    "input.attach / detach",
    "input.onPointerDown / Move / Up",
    "input.onKeyDown",
  ],
  notes: [
    "Why render-to-texture? Minimap, security-camera feed, mirror surface, reflection probe, deferred-shading G-buffer, post-effect input. Anything that needs the result of a render as an input to another render.",
    "How the binding works: material.create accepts a `bindings:` array — GPUBindGroupEntry[] mapped to @group(1) in the shader. The monitor shader binds the PiP color texture at @binding(0) and a sampler at @binding(1). The texture *view* is captured at material-create time, which is why changing PiP resolution forces a material rebuild (rebuilt via a single-in-flight queue — rapid clicks coalesce to one pending rebuild).",
    "Two distinct draw lists per pass: the PiP renders [subject, room]; the main renders [room, subject, monitor]. The subject and room both appear in both passes — the (mesh, pipeline, cameraBuffer) cache fix in @furnace/core/frame is what makes this work.",
    "The amber wireframe quad marks the PiP camera's position and orientation. Its normal points along the camera's view direction — switch `pipAngle` to see it jump between presets. Drawn only in the main pass with `depthCompare: \"always\"` so it's never occluded by the room walls.",
  ],
  gaps: [
    "No animation of the PiP camera between presets — angle changes snap instantly.",
    "Single monitor; multiple monitors with different feeds would compose the same way at higher resource cost.",
  ],
  order: 70,
} satisfies DemoHelp;
