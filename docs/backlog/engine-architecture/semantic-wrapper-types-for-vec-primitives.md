# Semantic wrapper types over vec primitives

The engine uses `Vec3` and `Vec4` (`Float32Array`) directly for many domain
concepts — colors (`Vec4`), positions (`Vec3`), directions (`Vec3`), velocities
(`Vec3`), tangents, normals, etc. They're structurally identical but
semantically distinct. Consumer call sites mix them freely with no compile-time
or domain-helper distinction.

This entry captures a larger pattern: introduce semantic wrapper namespaces
that return `Vec3` / `Vec4` but expose domain-aware constructors and helpers.

**Sketch:**

```ts
// All return Vec4 / Vec3 — wrappers, not new types.
Color.rgba(r, g, b, a): Vec4
Color.fromHex("#1a2b3c"): Vec4
Color.toLinear(srgb): Vec4
Color.toSrgb(linear): Vec4

Point.xyz(x, y, z): Vec3
Direction.normalized(v): Vec3
Vector.xyz(x, y, z): Vec3
```

**Why deferred:** scope-to-current-need rule. Adding `Color` alone today would
be a single-member stub namespace. The pattern earns its keep when concrete
domain helpers actually exist (color-space conversion, hex parsing, hsv
parsing; point distance / dot product; direction normalization; etc.).

**Trigger to revisit:** first concrete domain-helper need — likely sRGB / linear
color conversion when textures.load lands, OR hex/hsv color literal authoring
in cookbook, OR world-vs-screen point disambiguation when a tooltip / hover
system lands.

**Reference:** `docs/backlog/_AUDIT-2026-05-26.md` §9.5 + the Tranche A
brainstorm discussion (Color.rgba option B vs raw vec4.fromValues option B1).
Spec: `docs/superpowers/specs/2026-05-26-tranche-a-quick-wins-design.md` §1.
