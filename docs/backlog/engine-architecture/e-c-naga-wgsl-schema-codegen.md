# E-C — naga WGSL→TS schema codegen + build-time staleness gate

**Deferred 2026-05-31 with a trigger (user's call at E-B close).** Tranche E-B shipped the entire *runtime* JS↔WGSL bridge (`@furnace/core/binding`: `Binding<L>`, the WGSL layout calculator, `set`/`setUniform`, lazy-flush; `Shader<L>`/`Material<L>/Effect<L>`). E-C is the *tooling* layer that was always the third sub-tranche of E. Supersedes the codegen/reflection-future thread of the now-deleted `typed-uniform-setters.md` + `material-uniform-setters.md` (both resolved by E-A + E-B).

## Context — what E-B left open

E-B's `L` (the `@group(1)` schema, e.g. `{ stripes: "f32", hue: "f32", softness: "f32" }`) is **hand-written** by the consumer alongside the WGSL struct. It gives compile-time `L` **and** runtime-correct layout with **zero deps and zero parser** — but at a **dual-spelling cost**: the TS `L` and the WGSL `struct` can silently drift (rename a field in the `.wgsl`, forget the schema, and the binding writes to the wrong offset with no error). E-B accepted this; the layout calculator at least guarantees the *bytes* are WGSL-correct *for the schema as written* — it cannot know the schema disagrees with the shader.

## What E-C is

A **build-time** generator + gate in `@furnace/tools` (the harness — consistent with furnace = library + harness; keeps `@furnace/core` zero-runtime-dep):
- **Codegen:** parse the WGSL with **naga** (Rust; naga parses but has **no TS backend** — the TS emitter is ours to write) and emit the `L` schema (or assert it) from the `@group(1)` struct. Kills dual-spelling: the WGSL becomes the single source of truth.
- **Staleness gate:** a build-time check that fails if a hand-written `L` disagrees with its shader's actual `@group(1)` layout. Turns `L` from a *hopeful annotation* into a *verified contract*.

Rejected alternatives (decided in the E brainstorm, see overarching design): TypeGPU (authors shaders in TS — furnace keeps WGSL as source); vendoring a pure-JS reflector into `@furnace/core` as a runtime dep (`wgsl_reflect`/`webgpu-utils` are viable MIT zero-runtime-dep options, but that's a *core posture* change, not the harness-tooling path E chose).

## Trigger to revisit

Either of:
- **Dual-spelling drift actually bites** — a real bug where `L` and the WGSL `@group(1)` struct disagree and a binding writes wrong offsets (the failure E-C prevents), **or**
- **First consumer asks for generated types** / explicitly wants the WGSL to be the SSOT for `L`.

Until then, hand-written `L` + the runtime calculator is sufficient (E-B shipped the whole runtime bridge regardless).

## Why deferred, not done

Low immediate appetite at E-B close; it's a Rust/tooling build in a different package (`crates/` in `@furnace/tools`) — a context-switch from the `@furnace/core` bridge work, and the bridge ships fully without it. The overarching E design explicitly recommended backlog-with-trigger here.

## Reference

- Overarching E design: E5 = the codegen decision; E4 = reflection-deferred-not-precluded; "the chokepoint" = `slot.layout.fields` is the additive seam all populators feed.
- Research (committed): `docs/research/uniform-params-prior-art.md` §3 (layout-source options matrix), §3.1 (pure-JS reflection is viable — the backlog's "needs heavy wasm parser" was FALSE), §7 (keeping the reflection door open).
- `@furnace/tools` architecture: `docs/reference/packaging-and-distribution.md`.
