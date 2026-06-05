import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "textures",
  blurb:
    "author your own textured shader against the public @group(1) contract; compare nearest / linear / AF×16",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    {
      input: "select: sampler",
      action:
        "swap the active sampler preset — nearest (blocky), linear (smooth), or linear+AF×16 (sharp at grazing angle)",
    },
  ],
  features: [
    "texture.create (raw data + mipmaps)",
    "checkerboard procedural generator",
    "shader.load { textureBinding: true }",
    "MaterialDescriptor.texture (sampler + texture handle)",
    "sampler filtering: nearest / linear / mipmapFilter",
    "anisotropic filtering (maxAnisotropy: 16)",
    "mesh.setMaterial (preset swap — no GPU rebuild per frame)",
  ],
  notes: [
    "You authored the textured shader yourself. textured.wgsl declares the public @group(1) sampler@0 / texture@1 contract and calls textureSample. The built-in shader.texturedLit is a convenience fork of the same contract with added lighting. Fork textured.wgsl to add normal maps, parallax, emissive — the contract stays the same.",
    "Sampler is baked at material.create time, not per-frame. Each preset is a separate Material built from the same shader + texture handle with different SamplerParams. mesh.setMaterial swaps which Material the mesh draws with — no GPU pipeline rebuild happens during the swap.",
    "The AF win is clearest at a grazing angle. The plane is tilted 70° forward so the far edge recedes sharply. Switch nearest→linear→linear+AF16 and watch the checkerboard sharpen as it recedes. At head-on angles the difference between linear and AF16 is invisible; the grazing view makes it the whole story.",
    "mipmaps: true on the checkerboard texture feeds the mipmap sampler filter. Without mipmaps, mipmapFilter: 'linear' still works but the GPU can only pick the base mip — you get shimmering instead of smooth minification. The mipmap chain is what AF and mipmapFilter: 'linear' are working against.",
    "maxAnisotropy > 1 requires all three filters linear. Furnace enforces this setup-loud (throws FurnaceError). The AF16 preset sets all three filters before setting maxAnisotropy — violate any of them and setup throws immediately, not at draw time.",
  ],
  gaps: [
    "No public Sampler handle — samplers are engine-internal, built from SamplerParams and cached in the sampler-cache. A future escape-hatch surface (shader.createSampler or similar) would let consumers cache a handle and pass it directly; deferred in docs/backlog/.",
    "addressMode repeat/clamp pair is not exposed as a preset here — UVs are tiled >1 so repeat is already the only visible mode. A clamp vs repeat comparison demo would need a different UV range layout.",
  ],
  order: 55,
} satisfies DemoHelp;
