# Material uniform setters

**Paired into the "uniform/params session" with `typed-uniform-setters.md`, 2026-05-30.** Deferred out of the D brainstorm (no demo animates a built-in's params per frame — trigger not met). When the `Shader` resource (Tranche D-1, `shader-resource.md`) drew the code-vs-params seam, this stayed on the **params** side — it's `@group(1)` data mutation, not shader code, so it does **not** go in D-1. Design it with `typed-uniform-setters` (the generic schema-driven version across material + post) as one session: per-built-in `setColor` is the friendly end; the generic `setUniform(name, data)` is the open-ended end. Prior-art (2026-05-30): three.js/bevy use typed per-field setters for built-ins; the generic by-name path needs a reflected uniform schema (the heaviest, worst-fit-for-tier option).

`material.unlit({ color })` sets the color at creation; there's no API to change it afterwards. Same for any other built-in material with parameters. Custom materials let the consumer mutate buffers directly (they own the buffers via `MaterialDescriptor.bindings`), but built-ins hide the buffer.

Likely shape: per-built-in setters that the engine plumbs through to its owned buffers. `material.setColor(unlit, [1, 0.5, 0.3, 1])`, `material.setScalar(mat, "halo", 0.4)`. Or a generic `material.setUniform(mat, name, data)` driven by a registered uniform schema per built-in.

Open design questions:
- Per-built-in setters (e.g. `unlit.setColor`) vs generic `material.setUniform`. Per-built-in is friendlier; generic is open-ended.
- Does this push us toward a uniform schema DSL (the thing tranche-4 deliberately didn't design)?
- Mutation timing: write-on-set vs lazy-flush at next `frame.render`?

## Built-in reconciliation deferred from D-1 (added 2026-05-30)

D-1 shipped the `Shader` resource but kept the built-in materials **as-is** to avoid churn (deleting `material.normalColor` would have migrated 7 consumers + 7 test files; regrouping their options fans out to the same demos). So D-1 left the built-ins in a deliberate **half-state**, and E owns finishing them **as one coherent unit** (the param work below is the reason E is the right home — the structural cleanup rides with it):

1. **Expose the built-in shaders.** D-1 created `_unlitShader(ctx)` / `_normalColorShader(ctx)` (engine-owned, shared per-ctx, **internal**). Promote to public `shader.unlit` / `shader.normalColor` so `material.create({ shader: shader.normalColor(ctx) })` composes. (Decide: do they stay engine-owned/shared with `destroy` no-op, or become consumer-owned? See the D-1 brainstorm — engine-owned was the lean.)
2. **Delete `material.normalColor`** (zero-param → pure sugar over `material.create({ shader: shader.normalColor(ctx) })`). Migrate its 7 consumers + 7 test files in the same atomic E commit.
3. **Reconcile the built-in options shapes.** D-1 left `UnlitOptions` / `NormalColorOptions` **flat** (`topology`/`cullMode`/`depthEnabled`/`depthWrite`/`depthCompare`) while `material.create` uses the **grouped** shape (`primitive{}` / `depth` union). This is a bounded temporary asymmetry — E either regroups the built-in options to match, or deletes the factories in favour of `material.create` + `shader.*` + the param setters below. The translation shim is `material/material.ts`'s `_flatRenderState`; delete it when the built-in options are reconciled.
4. **`material.unlit`'s color → a real param path** (the core E work below). Once a typed/ergonomic `@group(1)` setter exists, `material.unlit` can either become thin sugar over `material.create({ shader: shader.unlit(ctx), … })` + the color setter, or be retired entirely.

Net: E should treat 1–4 as a single built-in-reconciliation pass layered on the params work, not piecemeal. See `docs/superpowers/specs/2026-05-30-d1-shader-resource-design.md` §Q2 / "Out of scope".

**Trigger to revisit:** First demo wanting to animate a built-in material's parameters per frame — pulsing colors, fading planes, transition effects. (The D-1 built-in half-state above is also resolved here, regardless of the animation trigger, since it is the natural home for the work.)

**Reference:** Tranche-4 design § Out; D-1 brainstorm 2026-05-30 (`shader-resource.md`, `2026-05-30-d1-shader-resource-design.md`). Pairs with `typed-uniform-setters.md`.
