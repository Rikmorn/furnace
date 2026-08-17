# @furnace/core

The furnace engine library. Headless. Web-platform APIs only. No framework dependencies.

## Install

```bash
npm install @furnace/core
```

## What you get

Per-feature sub-path modules — `@furnace/core/{gpu, frame, geometry, mesh, mesh-blob, material, camera, transform, post, events, stats, input, log, resources, physics, rigid-mesh, rng, registry, shader, binding, field}` — documented signature-by-signature in `docs/reference/core-modules.md`. Concept taxonomy + naming rules: `docs/reference/api-posture.md`. Behavioural contracts (coordinate system, color space, DPR, time, disposal, failure policy): `docs/reference/engine-conventions.md`.

For a working end-to-end example, see the `@furnace/hello-world` package in this repository; for one demo page per feature, `@furnace/cookbook`.

## Consumer portability

`@furnace/core` ships compiled ESM JavaScript and `.d.ts` declarations. Use any modern bundler (Vite, webpack, esbuild, Bun, Rollup) — its public surface uses only web-platform APIs (no Bun APIs, no Node APIs, no `process.*` reads), targeting the browser. `tests/no-bun-leakage.test.ts` is one static guardrail; the full consumer contract lives in `AGENTS.md` §"What we ship to consumers".

The desktop runtime is provided by a separate package, `@furnace/tools`. Install it if you need the native launcher.

## Contributor notes

- **Browser-only is a hard invariant**: no framework deps, no Bun/Node coupling anywhere in `src/`. Future wasm hot-path crates live here; no native binaries (only `@furnace/tools` produces binaries).
- Capability highlights the dungeon consumer leans on: the **`field` module** — the chunked voxel world model (density store, ops + op log — oplog wire v4 carries per-op `origin` attribution, absent = human, and every committing path stamps op + undo entry from one parameter while `undo`/`redo` stay policy-free; generator registry, mesher/skinner, `bakeFieldWorld`, the walkability passes) that is now core's only content model; physics query primitives (`castRay`/`castShape`, `RayHit.body`) + the `voxels` collider (ghost-free static voxel grids; heightfield deliberately absent — broken in the vendored rapier wasm; the dungeon collides through `voxels` exclusively and passes `retainForCollision: false` at every `geometry.create`, so the `trimesh` path and its `retainForCollision`/`getCollisionData` accessors are core capability the dungeon deliberately does NOT use — verified 2026-08-11 by the T5 surface audit); seeded `rng` (sfc32; **`derive(label)` is STATE-INDEPENDENT** — child streams reproduce from seed+label alone, which bake/load re-expansion relies on); first-class GPU instancing (`mesh.createInstanced`, `litInstanced`/`unlitInstanced`, the separate `instanced` render list — uniform per-instance scale only; instanced shadow casting deferred to backlog); the `.fmesh` codec (`encodeMeshBlob`/`decodeMeshBlob` in the engine-tier `mesh-blob` leaf); HDR post (`bloom`/`tonemap`), exponential fog, multi-light Blinn-Phong + opt-in PCF shadows.
- **Two tiers, enforced.** The engine substrate (GPU + math) must never import the world tier (`field`, `registry`) — `tests/architecture.test.ts` fails the build on an upward edge. `@furnace/core/scene`, the third world-tier module, was **deleted in foundations T2 (2026-08-05)**: the field is the content model, and the neutral definer machinery it had contributed (`@furnace/core/registry`) outlived it. Rationale: `docs/reference/engine-architecture.md` §15.
- **The public surface was classified, keep-by-default, at foundations T5 (2026-08-11)** — **418 exported names over 22 modules**, 257 with a workspace consumer and 161 with none, verdicts **150 keep / 10 cookbook-debt / 1 delete**. **Zero consumers is not a strike**: this is a capability library for consumers we do not know, so deletion needs a per-name argument (wrong abstraction tier, orphaned by a deleted subsystem, or a not-for-consumers name on the consumer side of the `_`-internal boundary). The one deletion was the third kind and is a RELOCATION — `resetServicesForTests` moved to a new package-private `src/registry/internal.ts` as `_resetServicesForTests`, unreachable from a consumer because `package.json`'s `exports` map publishes `index.ts` only. The ten cookbook-debt names (the KCC family, contact events, the shader composition fragments) are filed at `docs/backlog/engine-architecture/tier-1-names-with-no-demo-decision.md`, and four false claims the audit found in `docs/reference/core-modules.md` and this README were fixed in the same commit. Re-derive the surface count with the compiler-API block in `docs/reference/editor-architecture.md` §28.5 (**417 at head** — 418 minus that one relocation). The rule the audit runs under is `docs/learnings/seals/README.md` §Writing a seal: an orphaned name is a candidate for JUDGEMENT, never for automatic deletion.
- Public exports carry TSDoc per `docs/reference/tsdoc-conventions.md` (`bun run check:tsdoc`).
- Chronological slice/epic seal history: `docs/learnings/seals/`.
