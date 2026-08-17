---
summary: colors, positions, directions and normals all spell as raw `Vec3`/`Vec4` with no domain-aware constructors; wrapper namespaces earn their keep once concrete helpers (sRGB conversion, hex authoring, normalization) actually exist
---

# Semantic wrapper namespaces over the vec primitives (FEATURE; not yet needed)

The engine uses `Vec3` / `Vec4` directly for many domain concepts — colors
(`Vec4`), positions / directions / velocities / normals / tangents (`Vec3`).
Structurally identical, semantically distinct, mixed freely at call sites with no
domain-helper distinction.

Introduce semantic wrapper namespaces that **return** `Vec3` / `Vec4` (wrappers,
not new types) but expose domain-aware constructors and helpers:

```ts
Color.rgba(r, g, b, a): Vec4
Color.fromHex("#1a2b3c"): Vec4
Color.toLinear(srgb): Vec4 / Color.toSrgb(linear): Vec4
Point.xyz(x, y, z): Vec3
Direction.normalized(v): Vec3
```

**Why deferred:** scope-to-current-need. `Color` alone today is a single-member
stub namespace. The pattern earns its keep when concrete domain helpers actually
exist (sRGB/linear conversion, hex/hsv parsing, point distance / dot, direction
normalization).

**Trigger to revisit:** first concrete domain-helper need — likely sRGB/linear
color conversion when richer `textures.load` lands, hex/hsv color authoring in
the cookbook, or world-vs-screen point disambiguation when a hover/tooltip system
lands.

**Reference:** Tranche A brainstorm (Color.rgba option B vs raw `vec4.fromValues`).
This entry is about *authoring/reading* ergonomics only. The adjacent **type-shape**
question — `Vec3` storage against `Vec3Tuple` input, and the rule for which to use where —
has its canonical home in `centralize-vec3tuple-input-type.md`; `indexing-cast-hygiene.md`
is the other half of the same ergonomics pair, and the two were kept apart because their
triggers differ.