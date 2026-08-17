# Precedent research: the "One Field" model (five lanes, 2026-07-14)

> Pre-charter research for the One Field phase (post-3.3). Five parallel web-research
> lanes, each instructed to hunt for DISCONFIRMING evidence — deviations from shipped
> systems' load-bearing mechanisms and documented migrations away from patterns we were
> about to adopt. Companion to `docs/research/2026-07-13-one-field-direction.md`.
> Verification labels per lane: claims marked verified were read from the cited source
> in-session; the rest are search-excerpt or general-knowledge grade.

## Headline verdicts

1. **The composition is the novelty, not the parts.** Every component ships somewhere:
   op-lists-as-the-document (Dreams), one-field + parametric generators + hand sculpt
   (Unreal Voxel Plugin), brush-first palette UX (Axiom), hand-edits surviving procedural
   regeneration (UE Landscape Edit Layers), staged region-scoped cave generation
   (WorldPainter), live capsule-true walkability overlay (WalkManifold). Nobody ships the
   whole. Per-slice gates carry the integration risk.
2. **Pure static walkable-column analysis is REFUTED** for low-false-negative wedge
   detection (three independent grounds: sub-cell resolution blindness; no two-contact
   wedge concept in the column model — a lip below step height beside a steep face passes
   Recast's filters BY DESIGN; solver-artifact hazards invisible to any geometric
   predicate). The validated design is the **hybrid**: column flags + swept probes
   executing the real controller code (productized as UE/Unity nav-link validation;
   fidelity principle from The Witness's Walk Monster: "test the code, not the data").
   Solver artifacts (internal-edge ghosting) are owned by collider-bake edge
   classification (Jolt active edges / Rapier `FIX_INTERNAL_EDGES`), never by walkability
   analysis.
3. **Op-log + per-region snapshots as the authoring format is SOUND** — provided the
   runtime never replays. Dreams is the scale proof (50k–120k ops/object, edit list IS
   the persisted format, evaluated cache rebuilt on load). Valheim is the verified
   failure case and it failed on what our design already excludes: one networked object
   per terrain op + full replay per rebuild + zero compaction (patch 0.150.3, 2021,
   migrated to per-zone consolidated state; migration reportedly lossy in edge cases —
   hence our `replay == snapshot` property-test-before-discard rule).
4. **Generator-as-reconfigurable-entity is sound-with-conditions.** No shipped system
   replays arbitrary downstream edits over regenerated output on an UNSTABLE domain (CAD's
   topological-naming problem is the 30-year cautionary tale). The systems where layered
   edits DO survive regeneration (UE Landscape Edit Layers, Dreams, Townscaper) share one
   property: edits keyed to a stable coordinate domain the generator cannot rename. A
   voxel field is that domain by construction. The residual failure is semantic drift
   (an op replaying where its context moved) — a flag-and-show UX problem, not a
   correctness crash.
5. **Large generators are never drag-strokes.** Shipped tools converge on: immediate
   brushes bake per stroke; area-scale generators are region-scoped, staged, previewed,
   re-rollable, explicitly committed (Roblox Generate, WorldPainter cave layers, Voxel
   Plugin stamps). Reasons: output can't be judged mid-stroke; evaluation cost breaks
   stroke feedback; undo deltas are huge.
6. **Mega-scale storage is a solved shape; the pressure is elsewhere.** 16³–32³ chunks,
   palette + quantized density ≈ ~48 KiB per dirty 32³ chunk, uniform-chunk elision is a
   named shipped pattern (godot_voxel), 100 m working set ≈ 12 MB of voxel data. Real
   pressure: GPU mesh memory (compressed vertex formats), collider rebuild (3–5× meshing
   cost — debounce to stroke-end), GPU upload scheduling. f32 world coords degrade past
   ~4 km first-person (Godot's table) → chunk-local integer coords + origin rebasing are
   non-optional at mega scale.

## Conditions absorbed into the charter

- Ops keyed to world-space voxel coordinates, never generator-output identities.
- Every op declares bounded spatial influence (Dreams banned non-local edits — cullable
  evaluation and region snapshots depend on it).
- Per-region snapshots, adaptive replay-tail budget, semantic compaction,
  `replay(ops) == snapshot` property-tested before discarding compacted ops.
- Undo streamed, chunk-keyed, disk-spillable (FAWE's existence is the lesson); one undo
  entry per generator commit.
- Freeze (keep recipe) ≠ bake (sever), both day one; bake-down fatigue is universal and
  institutionalized (SideFX prescribes live-while-authoring, baked-before-runtime);
  severing-is-one-way is the #1 documented complaint — freeze is the default affordance.
- Determinism as contract: stored seeds, hashed sub-seeds, no ambient RNG, deterministic
  iteration, same-input-twice regression tests (UE PCG ships exactly this test API).
- Regeneration stability goal: small param change → small diff (Townscaper's editable-WFC
  posture).
- Strict linear layer-stack replay; downstream generators re-cook; nothing fancier (the
  N-generators × M-hand-layers general case has NO shipped precedent).
- Generators never silently reclaim hand edits (No Man's Sky edit-budget GC and
  Enshrouded persistence-radius resets are the player-facing disasters); drifted/orphaned
  ops flag loudly.
- Interaction budgets: cursor < 16 ms; visible surface response 25–100 ms (HCI anchors:
  Jota et al. CHI 2013; Ng/Annett et al. 2014); dirty-set coalescing; 1-voxel-apron chunk
  seams (fast-surface-nets pattern); ~8 ms main-thread finish/upload budget norm.
- Analyzer: runs over the runtime collider (not the source field); cells well under
  capsule radius; thresholds strictly tighter than controller capability; borderline
  flags; fallback ladder flags→probes→exhaustive local flood-fill before any physics
  swap. Live-loop existence proof: WalkManifold (~0.1–0.3 ms local reconstruction).
- LLM surface: small composable op language is a validated LLM target (Voyager, Roblox
  LLM→scene-graph JSON, "Talking-to-Build" 2025); requirements: compositional ops,
  read-back channel, dry-run preview before commit.

## Measured baseline (this repo, 2026-07-14)

Current `packages/dungeon/src/surface-nets.ts` (naive: field-function sampling, growing
arrays), Bun 1.3.14 / JSC, Apple silicon, 50 iters: 32³ cells @0.25 m ≈ 21–32 ms
(typical→surface-heavy), 16³ ≈ 3–5 ms, all-solid 32³ ≈ 6 ms (pure function-call
overhead — the class an array-backed chunk mesher removes). Native anchor:
fast-surface-nets ~20 M tris/s/core → sub-ms per chunk; Unity Burst MC 16³ ≈ 0.2–0.8 ms.
Consequences: 16³ mesh unit; F1's array-backed rewrite has a measured baseline and an
in-browser re-measure gate.

## Key sources (subset; full trails in the session research reports)

- Recast filters (source) — github.com/recastnavigation `RecastFilter.cpp`; Mononen,
  "Recast Settings Uncovered" (digestingduck 2009).
- EA SEED, "Improving Playtesting Coverage via Curiosity Driven RL" (arXiv:2103.13798) —
  navmeshes explicitly rejected as stuck-bug ground truth.
- Muratori, "Walk Monster" (caseymuratori.com/blog_0005) + "Killing the Walk Monster"
  (blog_0032); WalkManifold (github.com/Amarcolina/WalkManifold).
- Jolt active edges (jrouwe.github.io/JoltPhysics); Rapier `TrimeshFlags::FIX_INTERNAL_EDGES`.
- Alex Evans, "Learning From Failure" SIGGRAPH 2015 (advances.realtimerendering.com) —
  Dreams edit-list persistence, restricted-op requirement, hierarchical evaluator.
- Valheim terrain migration: BetterTerrain README (github.com/74oshua/BetterTerrain);
  patch 0.150.3 coverage (gamespot/mmorpg.com, April 2021).
- FreeCAD topological naming problem (FreeCAD documentation wiki; ondsel.com).
- UE Landscape Edit Layers + Blueprint Brushes; UE PCG generation modes + determinism
  test API (dev.epicgames.com).
- SideFX: Houdini Engine studio workflow, lock/stash/File Cache (sidefx.com).
- BorisTheBrave, "Editable WFC" (boristhebrave.com 2022) — Townscaper's model.
- Voxel Plugin docs (docs.voxelplugin.com) — stamps vs sculpt cost dichotomy.
- Axiom editor docs (axiomdocs.moulberry.com) — brush chassis, masks, script brushes.
- WorldPainter Caves/Tunnels layer (worldpainter.net) — deferred generator-as-brush.
- WorldEdit history model + FAWE disk-spooled undo (enginehub.org; IntellectualSites).
- No Man's Sky terrain-edit budget GC (nomanssky.fandom.com + Steam threads); Enshrouded
  terrain persistence resets (community reports).
- godot_voxel performance + smooth-terrain docs (voxel-tools.readthedocs.io) — chunk
  sizes, uniform elision, collider 3–5×, 8 ms budget, upload stalls.
- fast-surface-nets-rs (github.com/bonsairobo) — apron/3-of-6-faces seam pattern,
  throughput; bonsairobo Surface Nets deep-dive (medium).
- Minecraft paletted chunk format (minecraft.wiki); frozen-chunk worldgen policy.
- Godot large-world-coordinates precision table (godot-docs 4.2).
- Transferable ArrayBuffers (developer.chrome.com); wasm 4 GiB (v8.dev); WebGPU limits
  (MDN).
- Event-sourcing snapshot/compaction guidance (kurrent.io; eventsourcing.dev).
- Jota et al., "How Fast Is Fast Enough" (CHI 2013); Ng, Annett et al. (2014) — direct
  manipulation latency thresholds.

**Fed:** the precedent grounding for the One Field recharter in `docs/reference/dungeon-architecture.md` (the five-lane precedent sweep), sealed at `docs/learnings/seals/2026-07-15-epic3-f0-f1-the-medium.md`.
