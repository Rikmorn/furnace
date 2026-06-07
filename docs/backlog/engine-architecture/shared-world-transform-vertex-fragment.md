# Extract a shared world-transform vertex `shader.source` fragment

The world-transform vertex prologue —

```wgsl
let world = object.model * vec4<f32>(v.position, 1.0);
out.pos = camera.viewProjection * world;
out.worldPos = world.xyz;
out.worldNormal = (object.normalMatrix * vec4<f32>(v.normal, 0.0)).xyz;
```

is now duplicated across **three** engine built-ins (see
`packages/core/src/shader/builtins.ts`):

- `LIT_SRC` — the full `{ worldPos, worldNormal }` prologue (verbatim above).
- `TEXTURED_LIT_SRC` — the same prologue plus `out.uv = v.uv`.
- `NORMAL_COLOR_SRC` — a **partial / near-miss**: it fuses
  `camera.viewProjection * object.model` into one expression (no intermediate
  `world`), has **no `worldPos` varying** at all, and emits only
  `out.normal = (object.normalMatrix * vec4(v.normal, 0)).xyz`.

That third occurrence fires the clean-code "extract on the third" trigger. The
Phase-1 precedent already exists: `packages/core/src/shader/preamble.ts` centralises
the binding structs (`_cameraBinding`, `_objectBinding`, `_vsIn`) as composable
`shader.source` fragments, and `lighting.ts` does the same for the *fragment*-side
`fr_shade` toolkit. A shared **vertex** fragment emitting `world` / `worldPos` /
`worldNormal` would close the gap on the vertex side.

This is **not an inline fix** — it needs a deliberate design decision, because
`NORMAL_COLOR_SRC` is a near-miss, not an identical match:

- Where does the fragment boundary sit — does it own the `VsOut` struct, or just
  the body lines (each shader keeps its own struct so it can add `uv`)?
- How does `normalColor` opt into a *subset* (it wants `worldNormal` but not
  `worldPos`, and currently fuses the matrices)? Either it conforms to the shared
  prologue (gaining an unused `worldPos`) or the fragment is parameterised.

So it's a backlog item, not a same-commit extraction.

**Trigger to revisit:** a deliberate shader-fragment hygiene pass, OR when adding
a 4th lit built-in (which would make the duplication a 4-way copy).

**Reference:** `packages/core/src/shader/builtins.ts` (`LIT_SRC`,
`TEXTURED_LIT_SRC`, `NORMAL_COLOR_SRC`); the Phase-1 precedent in
`packages/core/src/shader/preamble.ts` (binding-struct fragments) and
`packages/core/src/shader/lighting.ts` (the fragment-side `fr_shade` toolkit).
