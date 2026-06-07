# Shader composition — deferred follow-ons

**The composition spine LANDED as Visual Fidelity Stage 2.5 (2026-06-07):** `ShaderSource`
(`shader.source` tagged + call forms) → `toWgsl()` (DFS, dedup by object identity) →
`shader.create` accepts `ShaderSource | string`. Composition is pure in-memory JS string
work — NOT runtime URL fetch. The earlier framing in this file (a runtime
`new URL(spec, includingUrl)` `// @include` resolver) was **retired**: it is verified-broken
under Bun's `file` loader (build-time content-hash + flatten severs sibling paths, and
include-only `.wgsl` files are never emitted). Spec:
`docs/superpowers/specs/2026-06-07-stage-2.5-shader-preprocessor-design.md`.

The `toWgsl`/dedup core operates on the `ShaderSource` DAG independent of how the DAG was
built, so the items below slot in without reshaping it.

**Deferred follow-ons (each with its own trigger):**

1. **Runtime live-editor resolver** — `// @include "name"` string syntax resolved against a
   `name → ShaderSource` registry, building a DAG from live-edited text + the registry and
   reusing the dedup core. Live-typed text has no JS import graph, so this is a distinct
   consumer from the authoring path. *Trigger:* shader-editor work begins.

2. **Build-time validation tool / CLI** — `toWgsl()` + a WGSL compile-check (naga-wasm, or a
   `*.gpu.test.ts` using bun-webgpu's validation error scope — available today) so broken
   composition fails the build, not the frame. Composition is already prod-safe (JS imports
   are bundler-inlined; `toWgsl` is in-memory concat, no runtime file I/O) — this item is about
   *validation*, not avoiding I/O. *Trigger:* prod-hardening / unvalidated-composition pain.

3. **`ShaderSource.load(url)`** — lazy runtime fetch of a fragment; a dev/editor convenience
   that must not leak into prod (the prod-safe path is static import + bundler inline). A
   future lint/CLI could flag `.load` in prod builds. *Trigger:* a concrete runtime-fetched-
   composition need.

**Not planned:** node-graph / typed-IO shader editor (Unreal Material Function / Unity Sub
Graph) — a higher layer that *generates* `ShaderSource`; out of the Visual Fidelity epic.

**Reference:** Stage 2.5 spec (above); `docs/research/shader-resource-prior-art.md`.
