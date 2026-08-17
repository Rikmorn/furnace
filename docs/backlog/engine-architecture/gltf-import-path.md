---
summary: an external-art import path producing furnace `Geometry`/`Texture`/`Material` handles from `.glb`/`.gltf`, deliberately kept separate from the internal `.fmesh` cache format
---

# glTF import — external-asset import path (distinct from .fmesh)

The `.fmesh` binary format (introduced in Slice 2.1) is an **internal** furnace format:
it is produced by furnace's own region baker from procedurally generated mesh data and is
not intended for external art assets. It has no normals-map / PBR materials / animation /
skin / multi-primitive support — it is a geometry-only cache for a generated region.

A separate **glTF import path** is needed when:
- Artists export assets from Blender / Maya / Substance to bring into a furnace scene.
- The demo wants real art (hero props, character meshes, world decorations) instead of
  procedural geometry.
- PBR material data (base color texture + metallic-roughness + normal map + emissive) is
  part of the asset.

The shape of this work:
- A `geometry.loadGltf(ctx, url)` (or a scene resource kind `"gltf"`) that fetches a
  `.glb` / `.gltf`, parses it (probably via a small dedicated parser or a thin wrapper
  over `@loaders.gl/gltf`), and produces furnace `Geometry` + `Texture` + (eventually)
  `Material` handles.
- Multi-primitive mesh nodes → multiple `Geometry` handles, one per primitive.
- PBR material → deferred until the PBR material pipeline lands (see
  `pbr-material-pipeline.md`).
- Skinned meshes / morph targets → deferred further.
- The Khronos sample ladder is the natural tranche sizer (minimal textured mesh → full
  PBR scene).

**Distinct from `.fmesh`:** glTF is an interchange format for authored art; `.fmesh`
is an internal cache format for generated geometry. They are separate concerns and should
not share an import path — a glTF loader should not produce `.fmesh` files, nor should
the `.fmesh` decoder grow glTF concepts.

**Trigger to revisit:** First demo that needs to import external art (an artist-authored
prop, a hero character mesh, a decorated room element that is not procedurally generated).
Also fires when the PBR material pipeline lands (`pbr-material-pipeline.md`) — that work
needs real art assets to demonstrate correctly.

**Reference:** The Khronos glTF sample models repository. `pbr-material-pipeline.md`
(a likely co-dependency); `assets-module.md` (the broader asset-loading direction).
