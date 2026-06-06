# Effect variants, quality tiers, and fallback/degradation

Surfaced in the Stage 2 (Visual Fidelity epic) brainstorm (2026-06-06) while picking a
default tonemap operator. The user's observation: as the effect/shader library grows,
**"one canonical implementation per effect" stops holding** — variants proliferate, each
balancing quality against wildly varying performance, and we have no story yet for
*selecting* among them, *falling back* when a feature is missing, or *degrading* under a
frame budget. This is a distinct axis from any single effect; capture it before it's
re-derived per effect.

## The established patterns (general knowledge — not verified this session)

- **Quality tiers / presets** — a small enum (low/med/high/ultra) selecting per-effect
  parameters: bloom mip-count, MSAA off/4×, cheap-vs-fitted tonemap, shadow map size, etc.
  Cf. Unity Quality Settings, Unreal scalability `.ini`. Furnace's existing small
  parameterizations (the tonemap operator enum, bloom's mip-count/intensity) are the seeds.
- **Feature-detection fallbacks** — query adapter limits/features, pick a variant that the
  device supports. Furnace **already does this once** (feature-detects the missing
  `getCompilationInfo` on bun-webgpu). A systematic version would centralize "which variant
  for this adapter."
- **Shader permutations / ubershaders** — `#define`-driven variant compilation vs a single
  branchy shader. Couples to the deferred shader preprocessor (`shader-preprocessor.md` /
  Stage 2.5) — permutation generation usually rides the same include/macro machinery.
- **Dynamic degradation** — drop effects or scale resolution when over the frame budget
  (dynamic resolution, effect auto-disable). Needs the frame-timing furnace already collects
  (`stats.gpu.*`) plus a policy.

## Concrete first deferred entries (the seeds)

- **Tonemap operators ACES (Narkowicz) + AgX.** Stage 2 ships **Khronos PBR Neutral
  (default) + Reinhard (baseline)** behind a `ToneMapOperator` enum built so adding an
  operator is a trivial WGSL-fn + enum-arm addition. ACES and AgX are held back here.
  AgX additionally needs its full wrapper verified (log2 range constants) and a
  Rec.2020↔Rec.709 working-space reconciliation before shipping (a real porting risk —
  see the Stage 2 tonemap research). These are the first "same effect, more variants"
  instances.

**Trigger to revisit:** ≥2 viable implementations of the *same* effect competing on
quality/perf and needing a selection mechanism; **or** a target device that forces
degradation/fallback; **or** the tonemap enum wanting ACES/AgX added (smallest first
mover — could be handled inline if it's just two more enum arms, but the *selection /
tier* framing is what this entry guards). Do **not** build the variant/tier/fallback
*system* until one of these is real — the per-effect parameterizations (enums, counts)
are the right *small* shape until then.

**Reference:** `docs/superpowers/specs/2026-06-06-stage-2-aa-hdr-post-design.md` §2
(decision 5), §6 (fences). Related: `shader-preprocessor.md` (permutation machinery),
`render-state-completeness.md` (MSAA off/4× as a tier axis).
