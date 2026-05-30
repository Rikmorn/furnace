# Material uniform setters

**Paired into the "uniform/params session" with `typed-uniform-setters.md`, 2026-05-30.** Deferred out of the D brainstorm (no demo animates a built-in's params per frame — trigger not met). When the `Shader` resource (Tranche D-1, `shader-resource.md`) drew the code-vs-params seam, this stayed on the **params** side — it's `@group(1)` data mutation, not shader code, so it does **not** go in D-1. Design it with `typed-uniform-setters` (the generic schema-driven version across material + post) as one session: per-built-in `setColor` is the friendly end; the generic `setUniform(name, data)` is the open-ended end. Prior-art (2026-05-30): three.js/bevy use typed per-field setters for built-ins; the generic by-name path needs a reflected uniform schema (the heaviest, worst-fit-for-tier option).

`material.unlit({ color })` sets the color at creation; there's no API to change it afterwards. Same for any other built-in material with parameters. Custom materials let the consumer mutate buffers directly (they own the buffers via `MaterialDescriptor.bindings`), but built-ins hide the buffer.

Likely shape: per-built-in setters that the engine plumbs through to its owned buffers. `material.setColor(unlit, [1, 0.5, 0.3, 1])`, `material.setScalar(mat, "halo", 0.4)`. Or a generic `material.setUniform(mat, name, data)` driven by a registered uniform schema per built-in.

Open design questions:
- Per-built-in setters (e.g. `unlit.setColor`) vs generic `material.setUniform`. Per-built-in is friendlier; generic is open-ended.
- Does this push us toward a uniform schema DSL (the thing tranche-4 deliberately didn't design)?
- Mutation timing: write-on-set vs lazy-flush at next `frame.render`?

**Trigger to revisit:** First demo wanting to animate a built-in material's parameters per frame — pulsing colors, fading planes, transition effects.

**Reference:** Tranche-4 design § Out.
