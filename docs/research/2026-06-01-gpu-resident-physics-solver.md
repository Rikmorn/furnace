# GPU-resident rigid-body physics — solver & pipeline research

**Date:** 2026-05-31
**Context:** Pre-decision research for Demo 1 (GPU-resident rigid-body physics — bowling / angry-birds style, ~10–100 analytic-primitive bodies, stable stacking + toppling). Feeds the demo epic spec. Sibling to `2026-05-21-shallot.md`; explicitly *not* anchored on shallot (which built the full Bullet-style pipeline).
**Method:** Deep-research harness — 5 search angles, 23 sources fetched, 113 claims extracted, 25 adversarially verified (3-vote), 22 confirmed / 3 refuted. Confidence labels below mirror the verification result; "inference" = sound-by-construction but not primary-source-cited.

## TL;DR recommendation

**Solver = substep-dominated XPBD (max substeps, 1 constraint iteration each), parallelized with graph-colored Gauss-Seidel.** Closed-form analytic narrowphase. Brute-force/uniform-grid broadphase. Defer LBVH, quickhull, character controller, GPU raycast to backlog. Target bowling-style short stacks for v1 (tall stacks are XPBD's documented weak regime).

## Decision 1 — Solver [VERIFIED, high]

- **Small-steps XPBD:** for a fixed per-frame budget, the optimum is to **maximize substeps with exactly one constraint iteration each**, not few substeps with many iterations. More accurate (quadratic positional-error reduction in dt), better energy conservation, less tunneling.
  - Macklin et al., *Small Steps in Physics Simulation* (SCA 2019): "taking as many small steps as the time budget allows while performing a single iteration in each step."
  - Müller et al., *Detailed Rigid Body Simulation with XPBD* (CGF 2020): "the best choice in terms of accuracy… is to choose the maximum number of substeps with one iteration each."
  - Proof of stacking relevance — Fig. 9: a heavy box on a stack of capsules is **stable at 100 substeps/1 iter, collapses at 1 substep/100 iter**, collision detection run **once per frame** in both.
- **GPU parallelization:** XPBD's robustness comes from immediately updating bodies after each projection (non-linear Gauss-Seidel) — inherently serial. The two parallel options:
  - **Jacobi** — trivially parallel, order-independent, slower convergence; XPBD's own 3D GPU results used it (GTX 1070). But introduces *spurious rigid modes* that grow with constraint count.
  - **Graph-colored Gauss-Seidel** — color contacts so no two in a color share a body; solve each color in parallel in one kernel, barrier only between colors. Preserves GS convergence/robustness. **This is the recommended choice** (Fratarcangeli & Pellacini CGF 2015: chose GS "in the same spirit of the original PBD… stable and robust" over FLeX's Jacobi+relaxation).
  - **Adversarial result:** two Jacobi-favoring claims (incl. "Jacobi averaging cancels conflicting rotational corrections so it stacks better") were **refuted 0-3**. Colored-GS-over-Jacobi is robust against its strongest counter-argument.
- **Industry baselines confirm both pillars:** Bullet 3.x OpenCL solver uses graph coloring (~4–10 iters/step, 10–15 batches/iter) + mass-splitting for jitter (Coumans GDC 2013). PhysX 5.4 recommends **TGS** — subdivides timestep into substeps (substeps = position iterations), same substep>iterate principle. Avian's colored-GS solver: >3× faster than its single-thread baseline on Large Pyramid 2D.
- **Why XPBD over classic sequential-impulse:** XPBD is position projection with a compliance term (stiffness independent of iteration count / dt — Macklin MIG 2016). Substantially less machinery than an impulse/LCP solver with restitution+friction LCPs.

### ⚠ Load-bearing caveat — tall stacks [VERIFIED, high]
XPBD-as-published is **not guaranteed stable for tall stacks**. Müller et al. (verbatim): "Updating constraint directions after each projection might cause instabilities when simulating **tall stacks or piles of objects**. Investigating this problem is one of our directions of future work." The arXiv XPBD survey (2311.09327) independently confirms PBRBD/XPBD is "limited in its handling of stable stacks of rigid bodies." PhysX TGS also has reported stack-collapse at high mass ratios needing tuning.
**Implication:** a single-layer bowling arrangement (dynamic toppling) is **in-regime**; multi-layer towers/pyramids are **out-of-regime** and would need mass-splitting (Tonge SIGGRAPH 2012) or extra tuning. Lean v1 toward bowling.

## Decision 2 — Broadphase: defer LBVH [INFERENCE, not cited]

At ~30 bodies, brute-force O(N²) = 900 pairs is trivially cheap on a GPU; a uniform grid / spatial hash covers the next stage. **LBVH is deferrable to a scale stage.** Honest gap: the research did **not** surface a cited crossover body-count; this is engineering inference (sound-by-construction), not source-backed.

## Decision 3 — Narrowphase: defer quickhull [box-box VERIFIED; others not]

Closed-form contact for analytic primitives **fully avoids convex-hull/quickhull construction**.
- **Box-box [verified]:** Separating Axis Test + Sutherland-Hodgman face clipping + contact reduction to **≤4 points** (deepest-penetration point + 3 extremal points on orthogonal in-plane axes). Canonical (Coumans GDC 2013; Gregorius/Valve; Catto/Box2D). Robustness-sensitive case: SAT axis selection + clip-polygon degeneracy at near-parallel faces — which is exactly why the ≤4-point reduction matters.
- **Sphere-sphere / sphere-box / sphere-plane / capsule-* [textbook, not independently verified here]:** distance-based closed-form, the most robust pairs.
- **⚠ Cylinders are the flagged risk:** cylinder-cylinder and cylinder-box are "the least standardized of the analytic primitives and may actually push toward hull-based methods." **Recommendation: collide pin-like shapes as capsules** (swept-sphere, robust closed-form); keep the cylinder as a *render* mesh only (collision ≠ render, already agreed). True cylinder narrowphase → backlog.

**Narrowphase difficulty gradient (a scoping lever):** sphere/capsule/plane (trivial distance-based) → +box/OBB (SAT+clip, verified, moderate) → +cylinder (least standardized, defer).

## Decision 4 — Stacking: essential vs polish [SYNTHESIZED, medium]

- **Essential:** high substep count (1 iter each) — make-or-break; contact persistence reused across substeps (structurally required for the cheap-substep economics); warm-starting + Coulomb friction (XPBD's resting-contact handling is its weak point).
- **Polish / skip for v1:** sleeping/deactivation (perf optimization, not stability); cone-vs-pyramid friction (pyramid is cheaper and adequate); restitution (≈irrelevant for *resting* stacks — matters only for the bounce of the throw itself).
- Note: Bullet's GPU jitter remedy is **mass-splitting**, not warm-starting.

## Decision 5 — Minimal viable pipeline

`integrate → broadphase (brute/grid) → closed-form analytic narrowphase → graph-colored substep-XPBD solve (1 iter/substep) → contact persistence / warm-start`

**Deferrable without compromising the core result:** LBVH broadphase, quickhull, character controller, GPU raycast.

### Compute-substrate implication
Per frame = **1 collision pass + N substeps × M color-passes** of compute dispatch, all reading/writing persistent storage buffers. The compute/storage shader-bridge stage must support many sequential compute dispatches over persistent storage buffers within a single frame — bake into that stage's design.

## Open questions (carry into implementation; not design blockers)

1. Per-pair closed-form algorithms for sphere-*/cylinder pairs not independently verified (only box-box). Sphere/capsule textbook; cylinder is the risk → capsule proxy sidesteps it.
2. Exact O(N²)/grid → LBVH crossover body count on a WebGPU target (inference only).
3. Is warm-starting strictly essential at ~30 bodies with high substeps, or merely beneficial? (Mass-splitting, not warm-starting, is Bullet's GPU-jitter remedy — leaves open whether a high-substep WGSL v1 ships believable stacks without warm-start.)
4. Concrete substep budget (lit: "as many as fit the frame"; ~8–20 at 60 fps practical) and coloring strategy (greedy edge vs spatial-grid) — demo-specific tuning.

## Primary sources

- Macklin, Müller, Chentanez — *XPBD* (MIG 2016): http://mmacklin.com/xpbd.pdf
- Macklin et al. — *Small Steps in Physics Simulation* (SCA 2019): https://mmacklin.com/smallsteps.pdf
- Müller et al. — *Detailed Rigid Body Simulation with XPBD* (CGF 2020): https://matthias-research.github.io/pages/publications/PBDBodies.pdf
- Fratarcangeli & Pellacini — parallel graph-colored GS (CGF 2015): https://dl.acm.org/doi/10.1111/cgf.12570
- Coumans — *GPU Rigid Body Simulation* (GDC 2013): https://www.slideshare.net/ecoumans/gpu-rigid-body-simulation-gdc-2013
- NVIDIA PhysX 5.4 — Rigid Body Dynamics (TGS): https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/RigidBodyDynamics.html
- Gregorius (Valve) — *Robust Contact Creation* (GDC): https://media.steampowered.com/apps/valve/2015/DirkGregorius_Contacts.pdf
- Catto — *Sequential Impulses* (GDC 2006): https://box2d.org/files/ErinCatto_SequentialImpulses_GDC2006.pdf
- Avian colored-GS solver PR #771: https://github.com/Jondolf/avian/pull/771
- XPBD survey (2023): https://arxiv.org/pdf/2311.09327

**Fed:** `docs/reference/adr/0001-physics-two-track-architecture.md` (Evidence line) — the GPU-resident half of the two-track posture. The deferred track it defined is tracked at `docs/backlog/engine-architecture/gpu-resident-physics-track.md`.
