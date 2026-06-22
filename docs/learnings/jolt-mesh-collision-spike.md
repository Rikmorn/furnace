# Jolt mesh-collision spike — voxels are a bridge, mesh-on-Jolt is the endgame

**Date:** 2026-06-22. **Context:** Epic 2 (procgen) collision architecture, after Slice
2.2.1 shipped field-derived **voxel** colliders as a workaround for internal-edge "ghost
collisions" on the generated Surface-Nets render trimesh.

## The question

Slices 2.1→2.2.1 fought one bug class: a swept capsule crossing a shared trimesh edge
gets a corrupted contact normal → forward motion is zeroed → the player stalls/wedges on
generated geometry. Rapier's `trimesh` has no internal-edge filtering, so we worked around
it twice — a custom `CharacterMover` (2.1.1), then ghost-free **voxel** proxies (2.2.1).
Voxels are blocky (an accepted trade). The open architectural question: are voxels a
**temporary bridge** (replaceable) or the **permanent** answer?

The hypothesised endgame matches how shipping smooth-procgen games work (No Man's Sky,
Astroneer, Deep Rock Galactic): field/SDF → marching-cubes/dual-contouring mesh → collide
**that mesh** on an **edge-aware** engine. Jolt has `EnhancedInternalEdgeRemoval` built
for exactly this and is AAA-proven (Horizon Forbidden West, Death Stranding 2). The gating
risk: Jolt is C++ reaching the browser via an Emscripten WASM port (`jolt-physics` on
npm), and furnace's core is **browser-only** — the JS bindings might not expose the
feature, or mesh-on-Jolt might not actually kill the ghost on *our* meshes.

## What was verified (this session)

### 1. The binding is reachable from JS

Read directly against the published package's own type surface
(`jolt-physics@1.0.0`, `dist/types.d.ts`). The whole endgame chain is bound in the latest
release: `BodyCreationSettings.mEnhancedInternalEdgeRemoval` (static mesh body) and
`CharacterBaseSettings.mEnhancedInternalEdgeRemoval` (the character), plus
`MeshShapeSettings`, `CharacterVirtual` + `ExtendedUpdate` (the KCC walk step),
`CapsuleShape`, and the active-edge controls. Only the low-level
`InternalEdgeRemovingCollector` (a custom-query collector) is **absent** — not needed; the
body/character flag is the high-level feature. (Emscripten `.d.ts` is generated from the
`.idl` that compiles the wasm glue, so a binding in the shipped `.d.ts` is a real export,
not a stub.)

### 2. Mesh-on-Jolt walks our generated trimeshes ghost-free

A throwaway headless spike (run via `bun run`, **no GPU/WebGPU** — `CharacterVirtual` does
its own collision queries; no `PhysicsSystem.Step` needed) built a Jolt `MeshShape` from
the dungeon's **actual** generated Surface-Nets trimeshes (`generateRegion` for
chamber/cavern/shaft) and drove a Jolt `CharacterVirtual` capsule (0.6 half-height / 0.3
radius, 55° slope) across them. Findings:

- **Chamber floor — the documented Rapier-stall surface — 10/10 walk lanes crossed**, with
  the edge-removal flag OFF *and* ON, on the default mesh *and* on an all-edges-active mesh
  (`MeshShapeSettings.mActiveEdgeCosThresholdAngle = 1.0` → Jolt's **baseline** active-edge
  smoothing disabled). So the robustness is inherent to `CharacterVirtual`, not a fragile
  mesh-build setting.
- **The decisive tell: `maxJump` (the largest single-frame horizontal move) equalled the
  walk step (0.050 m) in every test** — floor and curved walls, OFF/ON, default/all-active.
  A Rapier-style ghost manifests as a violent deflection (`maxJump ≫ walk`); that never
  happened anywhere. No launches, no wedges, never immobilised on walkable ground.
- **Curved walls (cavern/shaft — the "curved-wall-stuck" case): never wedged or launched.**
  The character either slides smoothly tangentially along the wall or stops cleanly against
  it.

## The surprising nuance (record it — don't blindly enable the flag)

The `mEnhancedInternalEdgeRemoval` flag — the feature the proof was named after — had a
**counterintuitive** effect on curved walls: it **pins** the character at the wall instead
of letting it slide tangentially (cavern: OFF slides ~17.5 m around the bowl, net 2 m, 0
stuck-frames = smooth continuous slide; ON stops dead at 1.7 m, 566 stuck-frames). Neither
is a ghost (clean `maxJump` both ways). For first-person crawler feel we'd likely *prefer*
the sliding — so **we may not want the flag at all**. Crucially, **clean floor traversal
needs no flag** (OFF walks floors fine). The endgame does not depend on the very feature we
set out to verify: Jolt's mesh + `CharacterVirtual` is robust out of the box.

## Cost axis (verified)

- **Bundle:** Jolt wasm ≈ 1.99 MB (non-compat, separate `.wasm`) vs the current
  `@dimforge/rapier3d-compat` ≈ 1.57 MB → **~+0.4 MB (~30%)**, modest. The `wasm-compat`
  build inlines the wasm as base64 in one 3.16 MB JS file (broadest compat / headless);
  production browser would stream the 1.99 MB `.wasm`.
- **Isolation:** single-thread `wasm-compat` needs **no** cross-origin isolation
  (`SharedArrayBuffer`/COOP/COEP) → browser-only friendly. (Multicore needs isolation; see
  `docs/backlog/engine-architecture/jolt-backend-swap.md`.)
- **Memory:** Emscripten/embind requires manual `.destroy()` per object — a heavier wrapper
  than Rapier's cascading `World.free()`, but manageable.

## Conclusion & posture

**Voxels are confirmed a BRIDGE, not the permanent answer.** Mesh-on-Jolt is viable from
JS under the browser-only constraint. Endgame = field → Surface-Nets mesh → collide on Jolt
(the NMS pattern); when built, adopt Jolt's `CharacterVirtual` KCC (replacing the custom
`CharacterMover`) and collide the render mesh directly. The blockiness trade disappears and
the field-streaming memory win is preserved (it is collider-agnostic). So: **keep voxel
feel-tuning minimal now** (it gets replaced), and plan a future "physics backend = Jolt"
epic. The voxel layer is a thin, swappable adapter (`packages/dungeon/src/proxy.ts`,
~85 lines) — building on it now is safe.

## Honest caveats

- The Rapier ghost was **not re-run on the same mesh** this session — the Rapier `trimesh`
  stall is documented history (the reason voxels + the 2.1.1 controller exist), not
  re-verified. A Rapier-vs-Jolt A/B on the identical chamber mesh is the only thing that
  would make this gold-standard; it isn't needed for the decision (we leave Rapier's
  trimesh regardless), but it is the natural first regression test for the Jolt epic.
- The spike used Jolt's **default** `CharacterVirtual` tuning. The wall-pin-with-flag
  behaviour is a tuning detail for that epic, not a viability blocker — Jolt characters on
  curved mesh worlds are a solved, tunable problem in AAA use.

## How to reproduce

Add `jolt-physics@1.0.0` (devDep), `import initJolt from "jolt-physics"` (default =
single-thread `wasm-compat`, self-contained, runs headless under `bun`). Standard Jolt
init: `JoltSettings` + `ObjectLayerPairFilterTable`/`BroadPhaseLayerInterfaceTable`/
`ObjectVsBroadPhaseLayerFilterTable` (NON_MOVING/MOVING layers) → `JoltInterface` →
`GetPhysicsSystem()`. Build the floor as a `TriangleList` soup from
`generateRegion(...).mesh` (positions+indices) → `new MeshShapeSettings(tris, mats)
.Create().Get()` (Jolt `Indexify()`s and welds it, so internal-edge detection sees the
true shared edges). Character: a `CapsuleShapeSettings` wrapped in a
`RotatedTranslatedShapeSettings` offset up by `(halfHeight+radius)` so the character
position is at the feet; `CharacterVirtualSettings` (`mShape`, `mMaxSlopeAngle`,
`mSupportingVolume = Plane(Vec3.sAxisY(), -radius)`, `mEnhancedInternalEdgeRemoval`); each
tick `SetLinearVelocity(...)` then `ExtendedUpdate(dt, gravity, ExtendedUpdateSettings,
DefaultBroadPhaseLayerFilter, DefaultObjectLayerFilter, BodyFilter, ShapeFilter,
GetTempAllocator())`; read `GetPosition()`. The diagnostic that matters is **`maxJump` per
frame** — if it never exceeds the intended walk step, there are no ghost deflections.
