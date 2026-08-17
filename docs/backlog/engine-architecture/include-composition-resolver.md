---
summary: a `// @include "name"` string-syntax resolver over a name→`ShaderSource` registry, for live-edited shader text that has no JS import graph to build a DAG from
---

# Runtime live-editor `// @include` resolver

**The composition spine LANDED as Visual Fidelity Stage 2.5 (2026-06-07):** `ShaderSource`
(`shader.source` tagged + call forms) → `toWgsl()` (DFS, dedup by object identity) →
`shader.create` accepts `ShaderSource | string`. Composition is pure in-memory JS string
work — NOT runtime URL fetch. The earlier framing (a runtime
`new URL(spec, includingUrl)` `// @include` resolver) was **retired**: it is verified-broken
under Bun's `file` loader (build-time content-hash + flatten severs sibling paths, and
include-only `.wgsl` files are never emitted).

The `toWgsl`/dedup core operates on the `ShaderSource` DAG independent of how the DAG was
built, so this item slots in without reshaping it.

**Runtime live-editor resolver** — `// @include "name"` string syntax resolved against a
`name → ShaderSource` registry, building a DAG from live-edited text + the registry and
reusing the dedup core. Live-typed text has no JS import graph, so this is a distinct
consumer from the authoring path.

**Trigger to revisit:** shader-editor work begins.

**Reference:** Stage 2.5 spec (the composition spine above);
`docs/research/2026-05-30-shader-resource-prior-art.md`. The `// @include` deferral is
what `docs/reference/core-modules.md`'s `shader.load` row points at. Siblings from the same
section: `composition-validation-cli.md`, `shadersource-load-url.md`.
